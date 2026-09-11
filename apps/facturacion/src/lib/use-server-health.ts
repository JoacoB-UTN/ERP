'use client';

import { useQuery } from '@tanstack/react-query';
import type { HealthResponse } from '@erp/shared';
import { DEFAULT_RUNTIME_PORTS, getBrowserOrigin, resolveServiceUrl } from '@erp/shared';

/** Same runtime-host resolution as the auth client — see workspace-urls.ts. */
const API_URL = resolveServiceUrl({
  explicitOverride: process.env.NEXT_PUBLIC_API_URL,
  port: DEFAULT_RUNTIME_PORTS.api,
  path: '/api/v1',
  currentOrigin: getBrowserOrigin(),
});

/**
 * Never throws — a network failure is itself a meaningful "the API is
 * unreachable" status for the indicator to render, not an error to crash on.
 */
async function fetchHealth(): Promise<HealthResponse> {
  try {
    const res = await fetch(`${API_URL}/health`, { cache: 'no-store' });
    if (!res.ok && res.status !== 503) {
      throw new Error(`Unexpected status ${res.status}`);
    }
    return (await res.json()) as HealthResponse;
  } catch {
    return { status: 'error', services: { database: 'error', redis: 'error' } };
  }
}

export type ServerHealthStatus = 'checking' | 'connected' | 'degraded' | 'disconnected';

/**
 * Lightweight polling wrapper over the existing, unauthenticated `GET /health`
 * endpoint — no backend change. Powers the session control's connection dot
 * (see docs/desktop-lan-architecture.md's "Failure behavior").
 *
 * `query.isPending` is only true before the *first* result has resolved — that
 * window is reported as 'checking', not 'disconnected', so a normal page load
 * never flashes a false "Sin conexión". Once a first result exists, background
 * refetches update `status` in place without reverting to 'checking'.
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
