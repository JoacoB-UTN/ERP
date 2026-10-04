import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import * as forge from 'node-forge';
import {
  ArcaCredentialsService,
  type ArcaCredentials,
} from './arca-credentials.service';
import {
  child,
  escapeXml,
  parseXml,
  soapRequest,
  type XmlNode,
} from './arca-soap';

export interface ArcaTicket {
  token: string;
  sign: string;
  expiresAt: string;
}
const NS = 'http://wsaa.view.sua.dvadac.desein.afip.gov';
const MARGIN = 5 * 60_000;
const TTL = 12 * 60 * 60_000;

@Injectable()
export class ArcaWsaaService {
  private readonly cache = new Map<string, ArcaTicket>();
  private readonly inflight = new Map<string, Promise<ArcaTicket>>();
  private readonly failures = new Map<string, number>();
  constructor(private readonly credentials: ArcaCredentialsService) {}

  async getTicket(companyId: string, cuit: string): Promise<ArcaTicket> {
    let credentials: ArcaCredentials;
    try {
      credentials = await this.credentials.load(companyId, cuit);
    } catch {
      throw this.unavailable();
    }
    const key = `${companyId}:${cuit}:${credentials.fingerprint}`;
    const now = Date.now();
    for (const [entry, ticket] of this.cache) {
      if (
        (entry.startsWith(`${companyId}:`) && entry !== key) ||
        Date.parse(ticket.expiresAt) <= now + MARGIN
      )
        this.cache.delete(entry);
    }
    for (const [entry, until] of this.failures)
      if (until <= now) this.failures.delete(entry);
    const cached = this.cache.get(key);
    if (cached) return { ...cached };
    if (this.failures.has(key)) throw this.unavailable();
    const pending = this.inflight.get(key);
    if (pending) return { ...(await pending) };
    if (this.inflight.size >= 256) throw this.unavailable();
    const request = this.authenticate(credentials)
      .then((ticket) => {
        // Bound process-local secret retention. Eviction never writes credentials to disk.
        if (this.cache.size >= 256)
          this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(key, ticket);
        return ticket;
      })
      .catch(() => {
        if (this.failures.size >= 256)
          this.failures.delete(this.failures.keys().next().value!);
        this.failures.set(key, Date.now() + 60_000);
        throw this.unavailable();
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, request);
    return { ...(await request) };
  }

  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException(
      'No se pudo autenticar con ARCA en homologación. Revisá la configuración del certificado y la hora del servidor.',
    );
  }

  private async authenticate(
    credentials: ArcaCredentials,
  ): Promise<ArcaTicket> {
    const now = Date.now();
    const tra = `<?xml version="1.0" encoding="UTF-8"?><loginTicketRequest version="1.0"><header><uniqueId>${randomInt(0, 0x1_0000_0000)}</uniqueId><generationTime>${new Date(now - MARGIN).toISOString()}</generationTime><expirationTime>${new Date(now + MARGIN).toISOString()}</expirationTime></header><service>wsfe</service></loginTicketRequest>`;
    const cms = forge.pkcs7.createSignedData();
    cms.content = forge.util.createBuffer(tra, 'utf8');
    cms.addCertificate(credentials.certificatePem);
    cms.addSigner({
      key: credentials.privateKeyPem,
      certificate: credentials.certificatePem,
      digestAlgorithm: forge.pki.oids.sha256,
      authenticatedAttributes: [
        { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
        { type: forge.pki.oids.messageDigest },
        {
          type: forge.pki.oids.signingTime,
          value: new Date(now).toISOString(),
        },
      ],
    });
    cms.sign({ detached: false });
    const encoded = forge.util.encode64(
      forge.asn1.toDer(cms.toAsn1()).getBytes(),
    );
    const body = await soapRequest(
      'WSAA',
      '',
      `<loginCms xmlns="${NS}"><in0>${escapeXml(encoded)}</in0></loginCms>`,
    );
    const response = child(body, 'loginCmsResponse', NS);
    const returned = child(response, 'loginCmsReturn', NS);
    if (
      body.children.length !== 1 ||
      response.children.length !== 1 ||
      returned.children.length
    )
      throw new Error();
    const ticket = parseXml(returned.text);
    if (
      ticket.name !== 'loginTicketResponse' ||
      ticket.namespace !== '' ||
      ticket.children.length !== 2
    )
      throw new Error();
    const header = child(ticket, 'header', '');
    const auth = child(ticket, 'credentials', '');
    const value = (node: XmlNode, name: string): string => {
      const field = child(node, name, '');
      if (field.children.length || !field.text.trim()) throw new Error();
      return field.text.trim();
    };
    const unique = value(header, 'uniqueId');
    if (!/^\d{1,10}$/.test(unique) || Number(unique) > 0xffff_ffff)
      throw new Error();
    const date = (name: string): number => {
      const text = value(header, name);
      if (
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
          text,
        )
      )
        throw new Error();
      const result = Date.parse(text);
      if (!Number.isFinite(result)) throw new Error();
      return result;
    };
    const generated = date('generationTime');
    const expires = date('expirationTime');
    const received = Date.now();
    if (
      generated > received + MARGIN ||
      generated < received - TTL ||
      expires <= received + MARGIN ||
      expires <= generated ||
      expires - generated > TTL + MARGIN ||
      expires > Date.parse(credentials.validUntil)
    )
      throw new Error();
    const token = value(auth, 'token');
    const sign = value(auth, 'sign');
    if (
      auth.children.length !== 2 ||
      token.length > 65_536 ||
      sign.length > 16_384
    )
      throw new Error();
    return { token, sign, expiresAt: new Date(expires).toISOString() };
  }
}
