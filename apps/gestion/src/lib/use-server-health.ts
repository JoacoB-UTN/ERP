'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchHealth } from './api';

export type ServerHealthStatus = 'checking' | 'connected' | 'degraded' | 'disconnected';

/**
 * Lightweight polling wrapper over the existing, unauthenticated
 * `GET /health` endpoint — no backend change. Powers the shell's
 * connection-status indicator (see docs/desktop-lan-architecture.md's
 * "Failure behavior" table and docs/desktop-ui-direction.md's status bar).
 * `fetchHealth` never throws — a network failure resolves as
 * `status: 'error'`, which this hook reports as 'disconnected'.
 *
 * `query.isPending` is only true before the *first* result (success or
 * failure) has resolved — that window is reported as 'checking', not
 * 'disconnected', so a normal page load never flashes a false "Sin
 * conexión" before the first health check has actually had a chance to
 * answer. Once a first result exists, background refetches (every 20s,
 * or on window focus) update `status` in place without ever reverting to
 * 'checking' — the last known real status stays on screen while a new
 * check is in flight.
 */
export function useServerHealth() {
  const query = useQuery({
    queryKey: ['server-health'],
    queryFn: fetchHealth,
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  const status: ServerHealthStatus = query.isPending
    ? 'checking'
    : query.data?.status === 'ok'
      ? 'connected'
      : query.data?.status === 'degraded'
        ? 'degraded'
        : 'disconnected';

  return { status };
}
