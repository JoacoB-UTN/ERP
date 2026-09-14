import { describe, it, expect, vi, afterEach } from 'vitest';
import type { HealthResponse } from '@erp/shared';
import { fetchHealth } from './api';

/**
 * `fetchHealth` is where the distinction the whole status panel rests on is
 * actually made: did the server answer, or did we fail to ask? The panel's own
 * tests take a `HealthProbe` as a given — these are the ones that check the
 * probe is built correctly in the first place.
 *
 * `fetch` is stubbed; nothing here opens a connection.
 */

function respondWith(body: unknown, init: { ok: boolean; status: number }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: init.ok,
      status: init.status,
      json: async () => body,
    })),
  );
}

/** A response whose body is not JSON — `res.json()` rejects, as it does in a browser. */
function respondWithInvalidJson() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON at position 0');
      },
    })),
  );
}

const healthy: HealthResponse = {
  status: 'ok',
  services: { database: 'ok', redis: 'ok' },
  currentAccountsBackfill: 'complete',
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fetchHealth', () => {
  it('keeps the response of a healthy 200', async () => {
    respondWith(healthy, { ok: true, status: 200 });
    const probe = await fetchHealth();
    expect(probe.reachable).toBe(true);
    expect(probe.response).toEqual(healthy);
  });

  it('treats a 503 as a real answer and keeps what it said', async () => {
    // This is how the API reports its own trouble. Discarding it would turn
    // "the database is down" into "the server is unreachable", which is a
    // different problem with a different fix.
    const body: HealthResponse = {
      status: 'error',
      services: { database: 'error', redis: 'ok' },
      currentAccountsBackfill: 'complete',
    };
    respondWith(body, { ok: false, status: 503 });
    const probe = await fetchHealth();
    expect(probe.reachable).toBe(true);
    expect(probe.response).toEqual(body);
    expect(probe.response?.services.database).toBe('error');
  });

  it('keeps a degraded 503 too', async () => {
    const body: HealthResponse = {
      status: 'degraded',
      services: { database: 'ok', redis: 'error' },
currentAccountsBackfill: 'complete',
    };
    respondWith(body, { ok: false, status: 503 });
    const probe = await fetchHealth();
    expect(probe.reachable).toBe(true);
    expect(probe.response?.status).toBe('degraded');
  });

  it('reports a rejected request as unreachable, with nothing known', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const probe = await fetchHealth();
    expect(probe.reachable).toBe(false);
    expect(probe.response).toBeNull();
  });

  it('does not pass a 502 off as an answer from the ERP', async () => {
    // A gateway error page is the proxy talking, not the API. Parsing it as a
    // HealthResponse would invent a diagnosis from someone else's HTML.
    respondWith('<html>502 Bad Gateway</html>', { ok: false, status: 502 });
    const probe = await fetchHealth();
    expect(probe.reachable).toBe(false);
    expect(probe.response).toBeNull();
  });

  it('degrades safely when the body is not valid JSON', async () => {
    respondWithInvalidJson();
    // The assertion is as much that this resolves at all: an unhandled
    // rejection here would take down the query, and with it the panel.
    await expect(fetchHealth()).resolves.toEqual({ reachable: false, response: null });
  });

  it('never throws, whatever happens', async () => {
    for (const setup of [
      () => respondWith(healthy, { ok: true, status: 200 }),
      () => respondWith(null, { ok: false, status: 500 }),
      () => respondWithInvalidJson(),
      () =>
        vi.stubGlobal(
          'fetch',
          vi.fn(async () => {
            throw new Error('boom');
          }),
        ),
    ]) {
      setup();
      await expect(fetchHealth()).resolves.toBeDefined();
      vi.unstubAllGlobals();
    }
  });

  it('asks for a fresh answer rather than a cached one', async () => {
    respondWith(healthy, { ok: true, status: 200 });
    await fetchHealth();
    const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(call[0])).toMatch(/\/health$/);
    expect(call[1]).toMatchObject({ cache: 'no-store' });
  });
});
