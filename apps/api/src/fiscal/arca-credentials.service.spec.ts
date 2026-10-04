import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  realpath,
  chmod,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as forge from 'node-forge';
import { ArcaCredentialsService } from './arca-credentials.service';

const COMPANY = 'a1111111-1111-4111-8111-111111111111';
const CUIT = '20123456786';
describe('ArcaCredentialsService', () => {
  let root: string;
  let key: string;
  let certificate: string;
  let keys: forge.pki.rsa.KeyPair;
  const original = process.env.ERP_ARCA_CREDENTIALS_DIR;
  const service = new ArcaCredentialsService();
  function cert(
    start = Date.now() - 60_000,
    end = Date.now() + 86_400_000,
    cuit = CUIT,
  ) {
    const value = forge.pki.createCertificate();
    value.publicKey = keys.publicKey;
    value.serialNumber = '01';
    value.validity.notBefore = new Date(start);
    value.validity.notAfter = new Date(end);
    const attrs = [
      { name: 'commonName', value: 'Ephemeral test' },
      { type: '2.5.4.5', value: `CUIT ${cuit}` },
    ];
    value.setSubject(attrs);
    value.setIssuer(attrs);
    value.sign(keys.privateKey, forge.md.sha256.create());
    return forge.pki.certificateToPem(value);
  }
  beforeAll(() => {
    keys = forge.pki.rsa.generateKeyPair(2048);
  });
  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'arca-test-')));
    process.env.ERP_ARCA_CREDENTIALS_DIR = root;
    await mkdir(join(root, COMPANY));
    key = join(root, COMPANY, 'private-key.pem');
    certificate = join(root, COMPANY, 'certificate.pem');
    await writeFile(key, forge.pki.privateKeyToPem(keys.privateKey), {
      mode: 0o600,
    });
    await writeFile(certificate, cert());
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  afterAll(() => {
    if (original === undefined) delete process.env.ERP_ARCA_CREDENTIALS_DIR;
    else process.env.ERP_ARCA_CREDENTIALS_DIR = original;
  });
  it('loads matching valid company credentials and fingerprint', async () => {
    const loaded = await service.load(COMPANY, CUIT);
    expect(loaded.privateKeyPem).toContain('PRIVATE KEY');
    expect(loaded.fingerprint).toMatch(/^[0-9A-F:]+$/);
    expect(Date.parse(loaded.validUntil)).toBeGreaterThan(Date.now());
  });
  it.each(['../other', '', 'company'])(
    'rejects unsafe company %s',
    async (id) => {
      await expect(service.load(id, CUIT)).rejects.toThrow('credenciales');
    },
  );
  it('rejects nonabsolute provisioning root', async () => {
    process.env.ERP_ARCA_CREDENTIALS_DIR = './keys';
    await expect(service.load(COMPANY, CUIT)).rejects.toThrow('credenciales');
  });
  it('rejects CUIT mismatch without returning certificate data', async () => {
    await expect(service.load(COMPANY, '30712345678')).rejects.toThrow(
      'credenciales',
    );
  });
  it.each(['expired', 'future'])('rejects %s certificate', async (kind) => {
    await writeFile(
      certificate,
      kind === 'expired'
        ? cert(Date.now() - 120_000, Date.now() - 60_000)
        : cert(Date.now() + 60_000),
    );
    await expect(service.load(COMPANY, CUIT)).rejects.toThrow('credenciales');
  });
  it('rejects mismatched key', async () => {
    await writeFile(
      key,
      forge.pki.privateKeyToPem(forge.pki.rsa.generateKeyPair(2048).privateKey),
    );
    await expect(service.load(COMPANY, CUIT)).rejects.toThrow('credenciales');
  });
  it('rejects weak RSA certificate', async () => {
    const strong = keys;
    try {
      keys = forge.pki.rsa.generateKeyPair(1024);
      await writeFile(certificate, cert());
      await writeFile(key, forge.pki.privateKeyToPem(keys.privateKey));
    } finally {
      keys = strong;
    }
    await expect(service.load(COMPANY, CUIT)).rejects.toThrow('credenciales');
  });
  (process.platform === 'win32' ? it.skip : it)(
    'rejects group-readable key',
    async () => {
      await chmod(key, 0o640);
      await expect(service.load(COMPANY, CUIT)).rejects.toThrow('credenciales');
    },
  );
  it('rejects oversized and malformed PEM', async () => {
    await writeFile(key, 's'.repeat(32_769));
    await expect(service.load(COMPANY, CUIT)).rejects.toThrow('credenciales');
    await writeFile(key, 'private secret malformed');
    await expect(service.load(COMPANY, CUIT)).rejects.toThrow('credenciales');
  });
  it('rejects key symlink', async () => {
    await rm(key);
    await symlink(certificate, key);
    await expect(service.load(COMPANY, CUIT)).rejects.toThrow('credenciales');
  });
  it('rejects company-directory symlink', async () => {
    await rm(join(root, COMPANY), { recursive: true });
    await symlink(root, join(root, COMPANY));
    await expect(service.load(COMPANY, CUIT)).rejects.toThrow('credenciales');
  });
  (process.platform === 'win32' ? it.skip : it).each([
    ['root', 0o777],
    ['root', 0o775],
    ['company', 0o777],
    ['company', 0o775],
  ])(
    'rejects writable credential directory %s mode %s',
    async (directory, mode) => {
      await chmod(directory === 'root' ? root : join(root, COMPANY), mode);
      await expect(service.load(COMPANY, CUIT)).rejects.toThrow('credenciales');
    },
  );
  describe('explicit company representation', () => {
    const ISSUER = '30712345671';
    const OTHER = '30987654321';
    const representation = () => join(root, COMPANY, 'representation.json');
    async function provision(
      value: unknown = { issuerCuit: ISSUER, certificateCuit: CUIT },
    ) {
      await writeFile(representation(), JSON.stringify(value), { mode: 0o600 });
    }
    it('accepts an explicit relation and retains certificate identity', async () => {
      await provision();
      await expect(service.load(COMPANY, ISSUER)).resolves.toHaveProperty(
        'fingerprint',
      );
    });
    it('rejects a different valid issuer without representation', async () => {
      await expect(service.load(COMPANY, ISSUER)).rejects.toThrow(
        'credenciales',
      );
    });
    it('accepts an explicit valid same-CUIT relation', async () => {
      await provision({ issuerCuit: CUIT, certificateCuit: CUIT });
      await expect(service.load(COMPANY, CUIT)).resolves.toHaveProperty(
        'fingerprint',
      );
    });
    it.each([
      { issuerCuit: OTHER, certificateCuit: CUIT },
      { issuerCuit: ISSUER, certificateCuit: OTHER },
      { issuerCuit: CUIT, certificateCuit: ISSUER },
      { issuerCuit: '30712345670', certificateCuit: CUIT },
      { issuerCuit: ISSUER, certificateCuit: '20123456780' },
      { issuerCuit: '30-71234567-1', certificateCuit: CUIT },
      { issuerCuit: 30712345671, certificateCuit: CUIT },
      { issuerCuit: ISSUER, certificateCuit: CUIT, allowAny: true },
      { issuerCuit: ISSUER },
      null,
      [],
    ])('rejects invalid or mismatched declaration %#', async (value) => {
      await provision(value);
      await expect(service.load(COMPANY, ISSUER)).rejects.toThrow(
        'credenciales',
      );
    });
    it('does not ignore malformed existing JSON even for same CUIT', async () => {
      await writeFile(representation(), '{');
      await expect(service.load(COMPANY, CUIT)).rejects.toThrow('credenciales');
    });
    it('rejects oversized declarations', async () => {
      await writeFile(representation(), ' '.repeat(32_769));
      await expect(service.load(COMPANY, CUIT)).rejects.toThrow('credenciales');
    });
    it('rejects symlinks including dangling links', async () => {
      const target = join(root, 'relation.json');
      await writeFile(
        target,
        JSON.stringify({ issuerCuit: ISSUER, certificateCuit: CUIT }),
      );
      await symlink(target, representation());
      await expect(service.load(COMPANY, ISSUER)).rejects.toThrow(
        'credenciales',
      );
      await rm(target);
      await expect(service.load(COMPANY, CUIT)).rejects.toThrow('credenciales');
    });
    it('rejects a directory at declaration path', async () => {
      await mkdir(representation());
      await expect(service.load(COMPANY, CUIT)).rejects.toThrow('credenciales');
    });
    (process.platform === 'win32' ? it.skip : it)(
      'rejects declarations writable by another user',
      async () => {
        await provision();
        await chmod(representation(), 0o666);
        await expect(service.load(COMPANY, ISSUER)).rejects.toThrow(
          'credenciales',
        );
      },
    );
    it('revokes represented access on next load after deletion or mutation', async () => {
      await provision();
      await service.load(COMPANY, ISSUER);
      await rm(representation());
      await expect(service.load(COMPANY, ISSUER)).rejects.toThrow(
        'credenciales',
      );
      await provision();
      await service.load(COMPANY, ISSUER);
      await provision({ issuerCuit: OTHER, certificateCuit: CUIT });
      await expect(service.load(COMPANY, ISSUER)).rejects.toThrow(
        'credenciales',
      );
    });
    it('does not use another company directory declaration', async () => {
      await provision();
      const companyB = 'b1111111-1111-4111-8111-111111111111';
      await mkdir(join(root, companyB));
      await writeFile(join(root, companyB, 'certificate.pem'), cert());
      await writeFile(
        join(root, companyB, 'private-key.pem'),
        forge.pki.privateKeyToPem(keys.privateKey),
        { mode: 0o600 },
      );
      await expect(service.load(companyB, ISSUER)).rejects.toThrow(
        'credenciales',
      );
      await writeFile(
        join(root, companyB, 'representation.json'),
        JSON.stringify({ issuerCuit: ISSUER, certificateCuit: CUIT }),
      );
      await expect(service.load(companyB, OTHER)).rejects.toThrow(
        'credenciales',
      );
    });
    it('rejects invalid certificate CUIT checksum despite matching declaration', async () => {
      await writeFile(certificate, cert(undefined, undefined, '20123456780'));
      await provision({ issuerCuit: ISSUER, certificateCuit: '20123456780' });
      await expect(service.load(COMPANY, ISSUER)).rejects.toThrow(
        'credenciales',
      );
    });
  });
});
