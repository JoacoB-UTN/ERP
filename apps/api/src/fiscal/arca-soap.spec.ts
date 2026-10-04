import { child, escapeXml, parseXml, soapRequest } from './arca-soap';
const SOAP = 'http://schemas.xmlsoap.org/soap/envelope/';
const xml = `<s:Envelope xmlns:s="${SOAP}"><s:Body><Response xmlns="urn:test">OK</Response></s:Body></s:Envelope>`;
describe('Authenticated SOAP transport boundary', () => {
  let network: jest.SpiedFunction<typeof fetch>;
  beforeEach(() => {
    network = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  it('escapes XML credentials and requires unique namespaced fields', () => {
    expect(escapeXml('<a>&"\'')).toBe('&lt;a&gt;&amp;&quot;&apos;');
    expect(child(parseXml('<r><n>one</n></r>'), 'n', '').text).toBe('one');
    expect(() => child(parseXml('<r><n/><n/></r>'), 'n')).toThrow();
  });
  it('uses a fixed host, refuses redirects, emits expected SOAPAction and never retries', async () => {
    network.mockResolvedValue(new Response(xml));
    expect(
      (await soapRequest('WSFE', 'FECompConsultar', '<Request/>')).name,
    ).toBe('Body');
    expect(network.mock.calls[0][0]).toBe(
      'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
    );
    expect(network.mock.calls[0][1]).toMatchObject({
      redirect: 'error',
      headers: { SOAPAction: '"http://ar.gov.afip.dif.FEV1/FECompConsultar"' },
    });
    network.mockRejectedValue(new Error('secret-ticket'));
    await expect(soapRequest('WSAA', '', '<secret/>')).rejects.toThrow(
      'No se pudo verificar',
    );
    expect(network).toHaveBeenCalledTimes(2);
  });
  it.each([
    '<broken secret-ticket',
    '<!DOCTYPE r><r/>',
    xml.replace(SOAP, 'urn:wrong'),
    xml.replace('Response', 'Fault'),
    xml.replace('<s:Body>', '<s:Body>text'),
    xml.replace('</s:Body>', '</s:Body><s:Body/>'),
  ])('sanitizes invalid envelopes', async (data) => {
    network.mockResolvedValue(new Response(data));
    await expect(soapRequest('WSAA', '', '<request/>')).rejects.toThrow(
      'No se pudo verificar',
    );
  });
  it('rejects malformed, oversized, or overnested XML without echoing values', () => {
    for (const xml of [
      '<root>secret-ticket',
      ' '.repeat(262145),
      '<r>'.repeat(41) + '</r>'.repeat(41),
    ]) {
      try {
        parseXml(xml);
        throw new Error('Should reject');
      } catch (error) {
        expect((error as Error).message).toBe(
          'No se pudo verificar la respuesta de ARCA.',
        );
      }
    }
  });
  it('caps streamed response size', async () => {
    network.mockResolvedValue(new Response(' '.repeat(262145)));
    await expect(soapRequest('WSAA', '', '<request/>')).rejects.toThrow();
  });
  it('deadline covers the body and cancels its reader', async () => {
    jest.useFakeTimers();
    const cancel = jest.fn();
    network.mockResolvedValue(new Response(new ReadableStream({ cancel })));
    const result = soapRequest('WSAA', '', '<request/>').catch(
      (e: unknown) => e,
    );
    await jest.advanceTimersByTimeAsync(12000);
    expect(await result).toBeInstanceOf(Error);
    expect(cancel).toHaveBeenCalled();
  });
  it('rejects unsupported operation before network access', async () => {
    await expect(
      soapRequest('WSFE', 'http://other.invalid', '<r/>'),
    ).rejects.toThrow();
    expect(network).not.toHaveBeenCalled();
  });
});
