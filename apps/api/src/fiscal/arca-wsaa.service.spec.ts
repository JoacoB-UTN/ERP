import * as forge from 'node-forge';
import { verify } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ArcaCredentialsService,
  type ArcaCredentials,
} from './arca-credentials.service';
import { ArcaWsaaService } from './arca-wsaa.service';
import { escapeXml, parseXml, soapRequest } from './arca-soap';
jest.mock('./arca-soap', () => ({
  ...jest.requireActual<typeof import('./arca-soap')>('./arca-soap'),
  soapRequest: jest.fn(),
}));
const NS = 'http://wsaa.view.sua.dvadac.desein.afip.gov';
describe('ArcaWsaaService', () => {
  let credentials: ArcaCredentials;
  let loader: jest.Mock;
  let service: ArcaWsaaService;
  const soap = jest.mocked(soapRequest);
  function response(
    change: (xml: string) => string = (xml) => xml,
    namespace = NS,
  ) {
    const xml = change(
      `<loginTicketResponse version="1.0"><header><source>cn=wsaahomo</source><destination>cn=test</destination><uniqueId>123</uniqueId><generationTime>${new Date(Date.now() - 1000).toISOString()}</generationTime><expirationTime>${new Date(Date.now() + 12 * 3600_000 - 1000).toISOString()}</expirationTime></header><credentials><token>opaque-token</token><sign>opaque-sign</sign></credentials></loginTicketResponse>`,
    );
    return parseXml(
      `<Body><loginCmsResponse xmlns="${namespace}"><loginCmsReturn>${escapeXml(xml)}</loginCmsReturn></loginCmsResponse></Body>`,
    );
  }
  beforeAll(() => {
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date(Date.now() - 60_000);
    cert.validity.notAfter = new Date(Date.now() + 7 * 86400_000);
    cert.setSubject([{ name: 'commonName', value: 'Ephemeral' }]);
    cert.setIssuer(cert.subject.attributes);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    credentials = {
      certificatePem: forge.pki.certificateToPem(cert),
      privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
      fingerprint: 'test-fingerprint',
      validUntil: cert.validity.notAfter.toISOString(),
    };
  });
  beforeEach(() => {
    jest.clearAllMocks();
    loader = jest.fn().mockResolvedValue(credentials);
    service = new ArcaWsaaService({
      load: loader,
    } as unknown as ArcaCredentialsService);
    soap.mockResolvedValue(response());
  });
  it('signs an encapsulated wsfe TRA with RSA/SHA256, independently verifies signature', async () => {
    expect(await service.getTicket('company', '20123456786')).toMatchObject({
      token: 'opaque-token',
      sign: 'opaque-sign',
    });
    const [endpoint, action, request] = soap.mock.calls[0];
    expect(endpoint).toBe('WSAA');
    expect(action).toBe('');
    const encoded = parseXml(request).children[0].text;
    const asn = forge.asn1.fromDer(forge.util.decode64(encoded));
    const signedData = (asn.value as forge.asn1.Asn1[])[1];
    const sequence = (signedData.value as forge.asn1.Asn1[])[0];
    const nodes = sequence.value as forge.asn1.Asn1[];
    const contentInfo = nodes[2].value as forge.asn1.Asn1[];
    const content = (contentInfo[1].value as forge.asn1.Asn1[])[0]
      .value as string;
    expect(content).toContain('<service>wsfe</service>');
    expect(content).toContain('<loginTicketRequest');
    const signers = nodes[nodes.length - 1].value as forge.asn1.Asn1[];
    const signer = signers[0].value as forge.asn1.Asn1[];
    const attributes = signer[3];
    const signedSet = forge.asn1.create(
      forge.asn1.Class.UNIVERSAL,
      forge.asn1.Type.SET,
      true,
      attributes.value,
    );
    const signature = signer[5].value as string;
    expect(
      verify(
        'sha256',
        Buffer.from(forge.asn1.toDer(signedSet).getBytes(), 'binary'),
        credentials.certificatePem,
        Buffer.from(signature, 'binary'),
      ),
    ).toBe(true);
  });
  it('coalesces concurrent requests and returns safe cache copies', async () => {
    const tickets = await Promise.all([
      service.getTicket('a', '1'),
      service.getTicket('a', '1'),
    ]);
    expect(soap).toHaveBeenCalledTimes(1);
    tickets[0].token = 'mutated';
    expect((await service.getTicket('a', '1')).token).toBe('opaque-token');
  });
  it('isolates company, issuer and certificate rotation', async () => {
    await service.getTicket('a', '1');
    await service.getTicket('b', '1');
    await service.getTicket('a', '2');
    loader.mockResolvedValue({ ...credentials, fingerprint: 'rotated' });
    await service.getTicket('a', '1');
    expect(soap).toHaveBeenCalledTimes(4);
  });
  it('never serves a cached ticket if credentials were removed', async () => {
    await service.getTicket('a', '1');
    loader.mockRejectedValue(new Error('missing'));
    await expect(service.getTicket('a', '1')).rejects.toThrow(
      'No se pudo autenticar',
    );
    expect(soap).toHaveBeenCalledTimes(1);
  });
  it('rechecks real representation files before using cached tickets', async () => {
    const company = 'a1111111-1111-4111-8111-111111111111';
    const issuerCuit = '30123456781';
    const certificateCuit = '20123456786';
    const root = await realpath(
      await mkdtemp(join(tmpdir(), 'arca-representation-')),
    );
    const originalRoot = process.env.ERP_ARCA_CREDENTIALS_DIR;
    process.env.ERP_ARCA_CREDENTIALS_DIR = root;
    try {
      const folder = join(root, company);
      await mkdir(folder);
      const cert = forge.pki.certificateFromPem(credentials.certificatePem);
      cert.setSubject([{ type: '2.5.4.5', value: `CUIT ${certificateCuit}` }]);
      cert.sign(
        forge.pki.privateKeyFromPem(credentials.privateKeyPem),
        forge.md.sha256.create(),
      );
      await writeFile(
        join(folder, 'certificate.pem'),
        forge.pki.certificateToPem(cert),
      );
      await writeFile(
        join(folder, 'private-key.pem'),
        credentials.privateKeyPem,
        { mode: 0o600 },
      );
      const representation = join(folder, 'representation.json');
      await writeFile(
        representation,
        JSON.stringify({ issuerCuit, certificateCuit }),
        { mode: 0o600 },
      );
      const realService = new ArcaWsaaService(new ArcaCredentialsService());
      await realService.getTicket(company, issuerCuit);
      await realService.getTicket(company, issuerCuit);
      expect(soap).toHaveBeenCalledTimes(1);
      await rm(representation);
      await expect(realService.getTicket(company, issuerCuit)).rejects.toThrow(
        'No se pudo autenticar',
      );
      await writeFile(
        representation,
        JSON.stringify({ issuerCuit: certificateCuit, certificateCuit }),
      );
      await expect(realService.getTicket(company, issuerCuit)).rejects.toThrow(
        'No se pudo autenticar',
      );
      expect(soap).toHaveBeenCalledTimes(1);
    } finally {
      if (originalRoot === undefined)
        delete process.env.ERP_ARCA_CREDENTIALS_DIR;
      else process.env.ERP_ARCA_CREDENTIALS_DIR = originalRoot;
      await rm(root, { recursive: true, force: true });
    }
  });
  it.each([
    (xml: string) => xml.replace('<token>opaque-token</token>', '<token/>'),
    (xml: string) =>
      xml.replace('</credentials>', '<sign>duplicate</sign></credentials>'),
    (xml: string) =>
      xml.replace('<uniqueId>123</uniqueId>', '<uniqueId>-1</uniqueId>'),
    (xml: string) =>
      xml.replace(
        /<expirationTime>.*?<\/expirationTime>/,
        '<expirationTime>2000-01-01T00:00:00Z</expirationTime>',
      ),
    (xml: string) =>
      xml.replace(
        /<generationTime>.*?<\/generationTime>/,
        '<generationTime>2099-01-01T00:00:00Z</generationTime>',
      ),
    (xml: string) =>
      xml.replace(
        /<expirationTime>.*?<\/expirationTime>/,
        '<expirationTime>2099-01-01T00:00:00Z</expirationTime>',
      ),
    (xml: string) =>
      xml.replace(
        /<generationTime>.*?<\/generationTime>/,
        '<generationTime>2026-01-01</generationTime>',
      ),
    (xml: string) => xml.replace('<token>', '<token><nested/>'),
  ])('rejects invalid ticket without exposing response', async (change) => {
    soap.mockResolvedValue(response(change));
    await expect(service.getTicket('a', '1')).rejects.toThrow(
      'No se pudo autenticar',
    );
  });
  it('rejects incorrect response namespace', async () => {
    soap.mockResolvedValue(response(undefined, 'urn:evil'));
    await expect(service.getTicket('a', '1')).rejects.toThrow(
      'No se pudo autenticar',
    );
  });
  it('sanitizes failures and suppresses immediate retry', async () => {
    soap.mockRejectedValue(new Error('secret-key-and-token'));
    await expect(service.getTicket('a', '1')).rejects.toThrow(
      'No se pudo autenticar',
    );
    await expect(service.getTicket('a', '1')).rejects.toThrow(
      'No se pudo autenticar',
    );
    expect(soap).toHaveBeenCalledTimes(1);
  });
  it('refreshes tickets inside five-minute expiration margin', async () => {
    await service.getTicket('a', '1');
    const realNow = Date.now();
    const now = jest
      .spyOn(Date, 'now')
      .mockReturnValue(realNow + 12 * 3600_000 - 4 * 60_000);
    try {
      soap.mockResolvedValue(response());
      await service.getTicket('a', '1');
      expect(soap).toHaveBeenCalledTimes(2);
    } finally {
      now.mockRestore();
    }
  });
});
