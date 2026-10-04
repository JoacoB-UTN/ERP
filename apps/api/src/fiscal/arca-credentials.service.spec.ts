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
});
