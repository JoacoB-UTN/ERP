import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { HealthProbe } from './api';
import { useServerHealth } from './use-server-health';

/**
 * The real hook, not a stand-in for it. What the panel depends on and cannot
 * check for itself is here: that a background refetch keeps the previous
 * result instead of reverting to "nothing known yet", that `lastCheckedAt`
 * only moves when a check actually completed, and that "Actualizar ahora"
 * reuses the one query rather than starting a parallel life of its own.
 *
 * `fetchHealth` is stubbed — it has its own tests in `api.test.ts`. Timing is
 * controlled with deferred promises and a frozen clock, never with sleeps.
 */

const mocks = vi.hoisted(() => ({ fetchHealth: vi.fn() }));
vi.mock('./api', () => ({ fetchHealth: mocks.fetchHealth }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const ok: HealthProbe = {
  reachable: true,
  response: {
    status: 'ok',
    services: { database: 'ok', redis: 'ok' },
    currentAccountsBackfill: 'complete',
  },
};
const degraded: HealthProbe = {
  reachable: true,
  response: {
    status: 'degraded',
    services: { database: 'ok', redis: 'error' },
    currentAccountsBackfill: 'complete',
  },
};
const unreachable: HealthProbe = { reachable: false, response: null };

let client: QueryClient;
let now: number;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mocks.fetchHealth.mockReset();
  // A fresh cache per test: nothing carries over between them.
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Frozen, hand-advanced clock so "lastCheckedAt moved" is a fact and not a
  // race against the millisecond the test happens to run in.
  now = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

describe('useServerHealth', () => {
  it('is "checking" until the first result arrives', async () => {
    const first = deferred<HealthProbe>();
    mocks.fetchHealth.mockReturnValue(first.promise);

    const { result } = renderHook(() => useServerHealth(), { wrapper });

    expect(result.current.isFirstCheck).toBe(true);
    expect(result.current.status).toBe('checking');
    expect(result.current.probe).toBeUndefined();
    expect(result.current.lastCheckedAt).toBe(0);

    await act(async () => {
      first.resolve(ok);
      await first.promise;
    });
    await waitFor(() => expect(result.current.isFirstCheck).toBe(false));
  });

  it('reports a healthy server and records when it was checked', async () => {
    mocks.fetchHealth.mockResolvedValue(ok);
    const { result } = renderHook(() => useServerHealth(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe('connected'));
    expect(result.current.probe).toEqual(ok);
    expect(result.current.isFirstCheck).toBe(false);
    expect(result.current.lastCheckedAt).toBe(now);
  });

  it('reports an unreachable API as disconnected, with an unreachable probe', async () => {
    mocks.fetchHealth.mockResolvedValue(unreachable);
    const { result } = renderHook(() => useServerHealth(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe('disconnected'));
    expect(result.current.probe).toEqual({ reachable: false, response: null });
  });

  it('reports a degraded server as degraded', async () => {
    mocks.fetchHealth.mockResolvedValue(degraded);
    const { result } = renderHook(() => useServerHealth(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe('degraded'));
    expect(result.current.probe).toEqual(degraded);
  });

  it('reports a database failure as disconnected while keeping the real answer', async () => {
    const dbDown: HealthProbe = {
      reachable: true,
      response: {
        status: 'error',
        services: { database: 'error', redis: 'ok' },
        currentAccountsBackfill: 'complete',
      },
    };
    mocks.fetchHealth.mockResolvedValue(dbDown);
    const { result } = renderHook(() => useServerHealth(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe('disconnected'));
    // The top-bar dot has only four states, so this shares one with
    // "unreachable" — but the probe still carries what really happened, which
    // is what lets the panel word the two differently.
    expect(result.current.probe).toEqual(dbDown);
  });

  it('holds the previous result while a refetch is in flight', async () => {
    mocks.fetchHealth.mockResolvedValueOnce(ok);
    const { result } = renderHook(() => useServerHealth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('connected'));
    const firstCheckedAt = result.current.lastCheckedAt;

    const second = deferred<HealthProbe>();
    mocks.fetchHealth.mockReturnValueOnce(second.promise);
    act(() => result.current.refresh());

    await waitFor(() => expect(result.current.isChecking).toBe(true));
    // The whole point: a refetch is not a reset.
    expect(result.current.isFirstCheck).toBe(false);
    expect(result.current.status).toBe('connected');
    expect(result.current.probe).toEqual(ok);
    expect(result.current.lastCheckedAt).toBe(firstCheckedAt);

    now += 5_000;
    await act(async () => {
      second.resolve(degraded);
      await second.promise;
    });

    await waitFor(() => expect(result.current.status).toBe('degraded'));
    expect(result.current.probe).toEqual(degraded);
    expect(result.current.lastCheckedAt).toBeGreaterThan(firstCheckedAt);
    expect(result.current.isChecking).toBe(false);
  });

  it('refresh() reuses the one query instead of starting another', async () => {
    mocks.fetchHealth.mockResolvedValue(ok);
    const { result } = renderHook(() => useServerHealth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('connected'));

    await act(async () => {
      result.current.refresh();
    });
    await waitFor(() => expect(mocks.fetchHealth).toHaveBeenCalledTimes(2));

    // One entry in the cache, under the same key: no second query and
    // therefore no second polling interval anywhere.
    const queries = client.getQueryCache().getAll();
    expect(queries).toHaveLength(1);
    expect(queries[0].queryKey).toEqual(['server-health']);
  });
});
