import { Injectable } from '@nestjs/common';
import { SaxesParser } from 'saxes';
import type { FiscalConnectivityResponse } from '@erp/shared';

const ENDPOINT = 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx';
const SOAP = 'http://schemas.xmlsoap.org/soap/envelope/';
const FEV1 = 'http://ar.gov.afip.dif.FEV1/';
const REQUEST = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="${SOAP}"><soap:Body><FEDummy xmlns="${FEV1}" /></soap:Body></soap:Envelope>`;
const MAX_BYTES = 32768;
interface XmlNode {
  local: string;
  uri: string;
  text: string;
  children: XmlNode[];
}

function parseServices(
  xml: string,
): NonNullable<FiscalConnectivityResponse['services']> {
  const parser = new SaxesParser({ xmlns: true });
  const stack: XmlNode[] = [];
  let root: XmlNode | undefined;
  parser.on('doctype', () => {
    throw new Error('DTD forbidden');
  });
  parser.on('opentag', (tag) => {
    if (stack.length >= 32) throw new Error('XML too deep');
    const node = { local: tag.local, uri: tag.uri, text: '', children: [] };
    if (stack.length) stack[stack.length - 1].children.push(node);
    else root = node;
    stack.push(node);
  });
  parser.on('text', (text) => {
    if (stack.length) stack[stack.length - 1].text += text;
  });
  parser.on('cdata', (text) => {
    if (stack.length) stack[stack.length - 1].text += text;
  });
  parser.on('closetag', () => {
    stack.pop();
  });
  parser.write(xml).close();
  const requireNode = (
    node: XmlNode | undefined,
    local: string,
    uri: string,
  ): XmlNode => {
    if (!node || node.local !== local || node.uri !== uri)
      throw new Error('Unexpected XML node');
    return node;
  };
  const envelope = requireNode(root, 'Envelope', SOAP);
  if (
    envelope.text.trim() ||
    envelope.children.some(
      (node) => node.uri !== SOAP || !['Header', 'Body'].includes(node.local),
    )
  )
    throw new Error('Unexpected envelope');
  if (envelope.children.filter((node) => node.local === 'Header').length > 1)
    throw new Error('Duplicate header');
  const bodies = envelope.children.filter((node) => node.local === 'Body');
  if (bodies.length !== 1) throw new Error('Missing or duplicate body');
  const single = (parent: XmlNode, local: string) => {
    if (parent.text.trim() || parent.children.length !== 1)
      throw new Error('Unexpected content');
    return requireNode(parent.children[0], local, FEV1);
  };
  const result = single(single(bodies[0], 'FEDummyResponse'), 'FEDummyResult');
  if (result.text.trim() || result.children.length !== 3)
    throw new Error('Incomplete result');
  const status = (name: string): 'OK' | 'UNAVAILABLE' => {
    const matches = result.children.filter((node) => node.local === name);
    if (matches.length !== 1) throw new Error('Duplicate or missing service');
    const node = requireNode(matches[0], name, FEV1);
    const value = node.text.trim();
    if (node.children.length || !['OK', 'FAIL'].includes(value))
      throw new Error('Invalid status');
    return value === 'OK' ? 'OK' : 'UNAVAILABLE';
  };
  return {
    application: status('AppServer'),
    database: status('DbServer'),
    authentication: status('AuthServer'),
  };
}

async function readBounded(
  response: Response,
  signal: AbortSignal,
): Promise<string> {
  if (!response.ok || response.redirected || !response.body)
    throw new Error('Unavailable response');
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      const bytes: unknown = part.value;
      if (!(bytes instanceof Uint8Array)) throw new Error('Invalid body chunk');
      size += bytes.byteLength;
      if (size > MAX_BYTES) throw new Error('Response too large');
      chunks.push(bytes);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(
      Buffer.concat(chunks),
    );
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
    reader.releaseLock();
  }
}

@Injectable()
export class ArcaConnectivityService {
  async check(): Promise<FiscalConnectivityResponse> {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error('Timed out'));
        }, 5000);
      });
      const request = async () => {
        const response = await fetch(ENDPOINT, {
          method: 'POST',
          redirect: 'error',
          signal: controller.signal,
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            SOAPAction: `"${FEV1}FEDummy"`,
          },
          body: REQUEST,
        });
        return parseServices(await readBounded(response, controller.signal));
      };
      const services = await Promise.race([request(), deadline]);
      const available = Object.values(services).every(
        (status) => status === 'OK',
      );
      return {
        environment: 'HOMOLOGATION',
        checkedAt: new Date().toISOString(),
        status: available ? 'AVAILABLE' : 'DEGRADED',
        services,
        authorizationAvailable: false,
        message: available
          ? 'El servicio público de homologación responde. Esto no valida certificados ni habilita la emisión.'
          : 'ARCA informa disponibilidad parcial. Esta consulta no valida certificados ni habilita la emisión.',
      };
    } catch {
      return {
        environment: 'HOMOLOGATION',
        checkedAt: new Date().toISOString(),
        status: 'UNAVAILABLE',
        services: null,
        authorizationAvailable: false,
        message:
          'No se pudo comprobar la disponibilidad de ARCA. Reintentá más tarde. Esto no verifica credenciales ni habilita la emisión.',
      };
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  }
}
