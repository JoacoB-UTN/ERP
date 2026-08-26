import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildConfig } from '../src/config';
import { testConnection } from '../src/health';

const GESTION_ORIGIN = 'http://192.168.1.50:3000';
const FACTURACION_ORIGIN = 'http://192.168.1.50:3002';

function fakeResponse(options: { status: number; body?: unknown; acao?: string | null }): Response {
  return {
    ok: options.status >= 200 && options.status < 300,
    status: options.status,
    headers: { get: (name: string) => (name === 'access-control-allow-origin' ? (options.acao ?? null) : null) },
    json: async () => options.body,
  } as unknown as Response;
}

/** Reads the `Origin` request header out of whatever `fetch` was called with, the way the real `checkOriginReflected` request carries it. */
function requestOrigin(init: RequestInit | undefined): string | undefined {
  const headers = init?.headers as Record<string, string> | undefined;
  return headers?.Origin;
}

describe('testConnection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const config = buildConfig({ scheme: 'http', host: '192.168.1.50' });

  it('reports "connected" and corsAdvisory "ok" when both workspace origins are exactly reflected', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes(':3001')) {
        const origin = requestOrigin(init);
        if (origin) {
          // One of the two per-origin CORS reflection checks.
          return fakeResponse({ status: 200, acao: origin });
        }
        // The plain health-status check carries no Origin header.
        return fakeResponse({ status: 200, body: { status: 'ok' } });
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

  it('accepts an exact Gestión origin reflection on its own check', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const origin = requestOrigin(init);
      if (origin === GESTION_ORIGIN) return fakeResponse({ status: 200, acao: GESTION_ORIGIN });
      if (origin === FACTURACION_ORIGIN) return fakeResponse({ status: 200, acao: FACTURACION_ORIGIN });
      if (url.includes(':3001')) return fakeResponse({ status: 200, body: { status: 'ok' } });
      return fakeResponse({ status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await testConnection(config);
    expect(result.corsAdvisory).toBe('ok');
    // Proves the request was actually sent with the exact Gestión origin.
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(':3001'),
      expect.objectContaining({ headers: { Origin: GESTION_ORIGIN } }),
    );
  });

  it('accepts an exact Facturación origin reflection on its own check', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const origin = requestOrigin(init);
      if (origin === GESTION_ORIGIN) return fakeResponse({ status: 200, acao: GESTION_ORIGIN });
      if (origin === FACTURACION_ORIGIN) return fakeResponse({ status: 200, acao: FACTURACION_ORIGIN });
      if (url.includes(':3001')) return fakeResponse({ status: 200, body: { status: 'ok' } });
      return fakeResponse({ status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await testConnection(config);
    expect(result.corsAdvisory).toBe('ok');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(':3001'),
      expect.objectContaining({ headers: { Origin: FACTURACION_ORIGIN } }),
    );
  });

  it('marks corsAdvisory "missing" when only one of the two workspace origins is reflected', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const origin = requestOrigin(init);
      if (origin === GESTION_ORIGIN) return fakeResponse({ status: 200, acao: GESTION_ORIGIN });
      if (origin === FACTURACION_ORIGIN) return fakeResponse({ status: 200, acao: null }); // not reflected
      if (url.includes(':3001')) return fakeResponse({ status: 200, body: { status: 'ok' } });
      return fakeResponse({ status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await testConnection(config);
    expect(result.corsAdvisory).toBe('missing');
  });

  it('marks corsAdvisory "missing" — NOT "ok" — when the API reflects a wildcard "*" instead of the exact origin', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const origin = requestOrigin(init);
      if (origin === GESTION_ORIGIN || origin === FACTURACION_ORIGIN) {
        // A non-credentialed-safe wildcard — must never count as a pass
        // for this credentialed (cookie-based) application.
        return fakeResponse({ status: 200, acao: '*' });
      }
      if (url.includes(':3001')) return fakeResponse({ status: 200, body: { status: 'ok' } });
      return fakeResponse({ status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await testConnection(config);
    expect(result.corsAdvisory).toBe('missing');
    expect(result.corsAdvisory).not.toBe('ok');
  });

  it('marks corsAdvisory "unknown" when the API itself is unreachable', async () => {
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
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const origin = requestOrigin(init);
      if (origin) return fakeResponse({ status: 200, acao: origin });
      if (url.includes(':3001')) return fakeResponse({ status: 200, body: { status: 'degraded' } });
      return fakeResponse({ status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await testConnection(config);
    expect(result.overall).toBe('degraded');
    expect(result.api.status).toBe('degraded');
  });

  it('reports "error" (503, Postgres down) as the API status, and "degraded" overall — not "unreachable"', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const origin = requestOrigin(init);
      if (origin) return fakeResponse({ status: 200, acao: origin });
      if (url.includes(':3001')) return fakeResponse({ status: 503, body: { status: 'error' } });
      return fakeResponse({ status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await testConnection(config);
    expect(result.api.status).toBe('error');
    expect(result.overall).toBe('degraded');
  });

  it('reports "degraded" overall when the API is fine but Gestión is unreachable', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const origin = requestOrigin(init);
      if (origin) return fakeResponse({ status: 200, acao: origin });
      if (url.includes(':3001')) return fakeResponse({ status: 200, body: { status: 'ok' } });
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
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const origin = requestOrigin(init);
      if (origin) return fakeResponse({ status: 200, acao: origin });
      if (url.includes(':3001')) return fakeResponse({ status: 200, body: { status: 'ok' } });
      return fakeResponse({ status: 307 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await testConnection(config);
    expect(result.gestion.status).toBe('ok');
    expect(result.facturacion.status).toBe('ok');
  });
});
