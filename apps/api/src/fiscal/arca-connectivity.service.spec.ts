import { ArcaConnectivityService } from './arca-connectivity.service';

const SOAP = 'http://schemas.xmlsoap.org/soap/envelope/';
const FEV1 = 'http://ar.gov.afip.dif.FEV1/';
const body =
  '<AppServer>OK</AppServer><DbServer>OK</DbServer><AuthServer>OK</AuthServer>';
const xml = (content = body) =>
  `<s:Envelope xmlns:s="${SOAP}"><s:Body><FEDummyResponse xmlns="${FEV1}"><FEDummyResult>${content}</FEDummyResult></FEDummyResponse></s:Body></s:Envelope>`;
describe('Public homologation connectivity', () => {
  const service = new ArcaConnectivityService();
  let network: jest.SpiedFunction<typeof fetch>;
  beforeEach(() => {
    network = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  it('uses only the public fixed test endpoint, sends no credentials, and never authorizes', async () => {
    network.mockResolvedValue(new Response(xml()));
    const result = await service.check();
    expect(result).toMatchObject({
      status: 'AVAILABLE',
      environment: 'HOMOLOGATION',
      authorizationAvailable: false,
      services: { application: 'OK', database: 'OK', authentication: 'OK' },
    });
    const [url, options] = network.mock.calls[0];
    expect(url).toBe('https://wswhomo.afip.gov.ar/wsfev1/service.asmx');
    expect(options).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: { SOAPAction: '"http://ar.gov.afip.dif.FEV1/FEDummy"' },
    });
    expect(options?.body).not.toMatch(/Cuit|Token|Sign|Auth|CAE/);
  });
  it('accepts a default SOAP namespace and prefixed result namespace', async () => {
    network.mockResolvedValue(
      new Response(
        `<Envelope xmlns="${SOAP}"><Body><f:FEDummyResponse xmlns:f="${FEV1}"><f:FEDummyResult><f:AppServer>OK</f:AppServer><f:DbServer>OK</f:DbServer><f:AuthServer>OK</f:AuthServer></f:FEDummyResult></f:FEDummyResponse></Body></Envelope>`,
      ),
    );
    expect((await service.check()).status).toBe('AVAILABLE');
  });
  it('distinguishes a valid degraded service from a transport failure', async () => {
    network.mockResolvedValue(
      new Response(xml(body.replace('<DbServer>OK', '<DbServer>FAIL'))),
    );
    expect(await service.check()).toMatchObject({
      status: 'DEGRADED',
      services: { database: 'UNAVAILABLE' },
      authorizationAvailable: false,
    });
  });
  it.each([
    '',
    '<html>OK</html>',
    xml().slice(0, -10),
    xml().replace(FEV1, 'urn:fake'),
    xml(body + '<AppServer>OK</AppServer>'),
    xml(body.replace('<DbServer>OK</DbServer>', '')),
    xml(body.replace('<DbServer>OK', '<DbServer>unexpected-secret')),
    xml()
      .replace('<FEDummyResponse', '<Fault')
      .replace('</FEDummyResponse>', '</Fault>'),
    '<!DOCTYPE x [<!ENTITY x "OK">]>' + xml(),
    xml(body.replace('OK', '&unknown;')),
    xml().replace('<s:Body>', '<s:Body>unexpected'),
    xml().replace('</s:Body>', '</s:Body><s:Body/>'),
  ])(
    'rejects malformed/ambiguous upstream content without reflecting it: %s',
    async (response) => {
      network.mockResolvedValue(new Response(response));
      expect(await service.check()).toMatchObject({
        status: 'UNAVAILABLE',
        services: null,
        authorizationAvailable: false,
      });
      expect(JSON.stringify(await service.check())).not.toContain(
        'unexpected-secret',
      );
    },
  );
  it.each([302, 500])(
    'rejects HTTP %i without attempting a second URL',
    async (status) => {
      network.mockResolvedValue(
        new Response('private upstream detail', { status }),
      );
      expect((await service.check()).status).toBe('UNAVAILABLE');
      expect(network).toHaveBeenCalledTimes(1);
    },
  );
  it('bounds response size even without content-length', async () => {
    network.mockResolvedValue(new Response(' '.repeat(32769)));
    expect((await service.check()).status).toBe('UNAVAILABLE');
  });
  it('normalizes network failures and times out stalled requests', async () => {
    network.mockRejectedValueOnce(new Error('private detail'));
    expect((await service.check()).message).not.toContain('private detail');
    jest.useFakeTimers();
    network.mockImplementation(() => new Promise(() => {}));
    const pending = service.check();
    await jest.advanceTimersByTimeAsync(5000);
    expect((await pending).status).toBe('UNAVAILABLE');
    expect(network.mock.calls[1][1]?.signal?.aborted).toBe(true);
  });
  it('also limits time while reading the body', async () => {
    jest.useFakeTimers();
    network.mockResolvedValue(
      new Response(
        new ReadableStream({
          start() {
            /* stalled body */
          },
        }),
      ),
    );
    const pending = service.check();
    await jest.advanceTimersByTimeAsync(5000);
    expect((await pending).status).toBe('UNAVAILABLE');
  });
});
