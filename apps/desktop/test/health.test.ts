import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildConfig } from '../src/config';
import { testConnection } from '../src/health';

function fakeResponse(options: {
  status: number;
  body?: unknown;
  acao?: string | null;
}): Response {
  return {
    ok: options.status >= 200 && options.status < 300,
    status: options.status,
    headers: { get: (name: string) => (name === 'access-control-allow-origin' ? (options.acao ?? null) : null) },
    json: async () => options.body,
  } as unknown as Response;
}

describe('testConnection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const config = buildConfig({ scheme: 'http', host: '192.168.1.50' });

  it('reports "connected" when API/Gestión/Facturación all respond healthy', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes(':3001')) {
        return fakeResponse({ status: 200, body: { status: 'ok' }, acao: 'http://192.168.1.50:3000' });
      }
      return fakeResponse({ status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await testConnection(config);
    expect(result.overall).toBe('connected');
    expect(result.api.status).toBe('ok');
    expect(result.gestion.status).toBe('ok');
    expect(result.facturacion.status).toBe('ok');
    expect(result.corsAdvisory).toBe('ok');
  });

  it('reports "unreachable" overall when the API itself cannot be reached, regardless of the frontends', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes(':3001')) throw new Error('ECONNREFUSED');
      return fakeResponse({ status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await testConnection(config);
    expect(result.overall).toBe('unreachable');
    expect(result.api.status).toBe('unreachable');
    expect(result.corsAdvisory).toBe('unknown');
  });

  it('reports "degraded" overall when the API is up but Redis is down (body.status === "degraded")', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes(':3001')) {
        return fakeResponse({ status: 200, body: { status: 'degraded' }, acao: 'http://192.168.1.50:3000' });
      }
      return fakeResponse({ status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await testConnection(config);
    expect(result.overall).toBe('degraded');
    expect(result.api.status).toBe('degraded');
  });

  it('reports "error" (503, Postgres down) as the API status, and "degraded" overall — not "unreachable"', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes(':3001')) {
        return fakeResponse({ status: 503, body: { status: 'error' }, acao: 'http://192.168.1.50:3000' });
      }
      return fakeResponse({ status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await testConnection(config);
    expect(result.api.status).toBe('error');
    expect(result.overall).toBe('degraded');
  });

  it('reports "degraded" overall when the API is fine but Gestión is unreachable', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes(':3001')) {
        return fakeResponse({ status: 200, body: { status: 'ok' }, acao: 'http://192.168.1.50:3000' });
      }
      if (url.includes(':3000')) throw new Error('ECONNREFUSED');
      return fakeResponse({ status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await testConnection(config);
    expect(result.overall).toBe('degraded');
    expect(result.gestion.status).toBe('unreachable');
    expect(result.facturacion.status).toBe('ok');
  });

  it('treats a frontend redirect (e.g. to /login) as "ok" — auth state is not availability', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes(':3001')) {
        return fakeResponse({ status: 200, body: { status: 'ok' }, acao: 'http://192.168.1.50:3000' });
      }
      return fakeResponse({ status: 307 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await testConnection(config);
    expect(result.gestion.status).toBe('ok');
    expect(result.facturacion.status).toBe('ok');
  });

  it('marks corsAdvisory "missing" when the API does not reflect the Gestión origin', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes(':3001')) {
        return fakeResponse({ status: 200, body: { status: 'ok' }, acao: null });
      }
      return fakeResponse({ status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await testConnection(config);
    expect(result.corsAdvisory).toBe('missing');
  });
});
