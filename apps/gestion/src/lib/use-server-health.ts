'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchHealth } from './api';

export type ServerHealthStatus = 'checking' | 'connected' | 'degraded' | 'disconnected';

/**
 * Lightweight polling wrapper over the existing, unauthenticated `GET /health`
 * endpoint — no backend change. Powers the session control's connection dot
 * (see docs/desktop-lan-architecture.md's "Failure behavior"). `fetchHealth`
 * never throws — a network failure resolves as `status: 'error'`, which this
 * hook reports as 'disconnected'.
 *
 * `query.isPending` is only true before the *first* result (success or
 * failure) has resolved — that window is reported as 'checking', not
 * 'disconnected', so a normal page load never flashes a false "Sin conexión"
 * before the first health check has actually had a chance to answer. Once a
 * first result exists, background refetches (every 20s, or on window focus)
 * update `status` in place without ever reverting to 'checking' — the last
 * known real status stays on screen while a new check is in flight.
 */
export function useServerHealth() {
  const query = useQuery({
    queryKey: ['server-health'],
    queryFn: fetchHealth,
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  const probe = query.data;
  const status: ServerHealthStatus = query.isPending
    ? 'checking'
    : !probe?.reachable
      ? 'disconnected'
      : probe.response.status === 'ok'
        ? 'connected'
        : probe.response.status === 'degraded'
          ? 'degraded'
          : 'disconnected';

  return {
    status,
    /** The full outcome, for the system-status panel. `undefined` before the first check resolves. */
    probe,
    /** True only before the FIRST result — never during a background refetch. */
    isFirstCheck: query.isPending,
    /** True whenever a check is in flight, including the first one. */
    isChecking: query.isFetching,
    /**
     * When the last check actually completed, as epoch ms; `0` before any has.
     * Taken from the query rather than a timestamp of our own so it can only
     * move when a real check resolved — `fetchHealth` never throws, so an
     * unreachable server still counts as a completed check.
     */
    lastCheckedAt: query.dataUpdatedAt,
    /**
     * Re-runs the SAME query. TanStack de-duplicates against the in-flight
     * request, so the "Actualizar ahora" button cannot start a second one,
     * and there is no second interval anywhere.
     */
    refresh: () => void query.refetch(),
  };
}
