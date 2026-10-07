import { SaxesParser } from 'saxes';

export interface XmlNode {
  name: string;
  namespace: string;
  text: string;
  children: XmlNode[];
}
const SOAP = 'http://schemas.xmlsoap.org/soap/envelope/';
const FEV1 = 'http://ar.gov.afip.dif.FEV1/';
const URLS = {
  WSAA: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
  WSFE: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
} as const;
const METHODS = new Set([
  'FEParamGetPtosVenta',
  'FEParamGetCondicionIvaReceptor',
  'FEParamGetTiposIva',
  'FEParamGetTiposDoc',
  'FECompUltimoAutorizado',
  'FECAESolicitar',
  'FECompConsultar',
]);
const invalid = () => new Error('No se pudo verificar la respuesta de ARCA.');
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
export function parseXml(xml: string): XmlNode {
  try {
    if (Buffer.byteLength(xml, 'utf8') > 262144) throw invalid();
    const parser = new SaxesParser({ xmlns: true });
    const stack: XmlNode[] = [];
    let root: XmlNode | undefined;
    parser.on('doctype', () => {
      throw invalid();
    });
    parser.on('opentag', (tag) => {
      if (stack.length >= 40) throw invalid();
      const node: XmlNode = {
        name: tag.local,
        namespace: tag.uri,
        text: '',
        children: [],
      };
      if (stack.length) stack[stack.length - 1].children.push(node);
      else root = node;
      stack.push(node);
    });
    const text = (value: string) => {
      if (stack.length) stack[stack.length - 1].text += value;
    };
    parser.on('text', text);
    parser.on('cdata', text);
    parser.on('closetag', () => {
      stack.pop();
    });
    parser.write(xml).close();
    if (!root) throw invalid();
    return root;
  } catch {
    throw invalid();
  }
}
export function children(
  node: XmlNode,
  name: string,
  namespace?: string,
): XmlNode[] {
  return node.children.filter(
    (item) =>
      item.name === name &&
      (namespace === undefined || item.namespace === namespace),
  );
}
export function child(
  node: XmlNode,
  name: string,
  namespace?: string,
): XmlNode {
  const matches = children(node, name, namespace);
  if (matches.length !== 1) throw invalid();
  return matches[0];
}
export async function soapRequest(
  endpoint: 'WSAA' | 'WSFE',
  action: string,
  body: string,
): Promise<XmlNode> {
  if (
    !(endpoint in URLS) ||
    (endpoint === 'WSFE' && !METHODS.has(action)) ||
    (endpoint === 'WSAA' && action !== '')
  )
    throw invalid();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(invalid());
      }, 12000);
    });
    const run = async () => {
      const response = await fetch(URLS[endpoint], {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: endpoint === 'WSFE' ? `"${FEV1}${action}"` : '""',
        },
        body: `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="${SOAP}"><soap:Body>${body}</soap:Body></soap:Envelope>`,
      });
      if (!response.ok || response.redirected || !response.body) {
        void response.body?.cancel().catch(() => undefined);
        throw invalid();
      }
      const reader = response.body.getReader();
      const cancel = () => {
        void reader.cancel().catch(() => undefined);
      };
      controller.signal.addEventListener('abort', cancel, { once: true });
      if (controller.signal.aborted) cancel();
      const parts: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          const bytes: unknown = part.value;
          if (!(bytes instanceof Uint8Array)) throw invalid();
          length += bytes.byteLength;
          if (length > 262144) throw invalid();
          parts.push(bytes);
        }
      } finally {
        controller.signal.removeEventListener('abort', cancel);
        cancel();
        reader.releaseLock();
      }
      const root = parseXml(
        new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts)),
      );
      if (
        root.name !== 'Envelope' ||
        root.namespace !== SOAP ||
        root.text.trim() ||
        root.children.some(
          (node) =>
            node.namespace !== SOAP || !['Header', 'Body'].includes(node.name),
        ) ||
        children(root, 'Header', SOAP).length > 1
      )
        throw invalid();
      const result = child(root, 'Body', SOAP);
      if (
        result.text.trim() ||
        result.children.length !== 1 ||
        result.children[0].name === 'Fault'
      )
        throw invalid();
      return result;
    };
    return await Promise.race([run(), deadline]);
  } catch {
    throw invalid();
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
