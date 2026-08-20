'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchHealth } from './api';

/**
 * Lightweight polling wrapper over the existing, unauthenticated
 * `GET /health` endpoint — no backend change. Powers the shell's
 * connection-status indicator (see docs/desktop-lan-architecture.md's
 * "Failure behavior" table and docs/desktop-ui-direction.md's status bar).
 * `fetchHealth` never throws — a network failure resolves as
 * `status: 'error'`, which this hook reports as 'disconnected'.
 */
export function useServerHealth() {
  const query = useQuery({
    queryKey: ['server-health'],
    queryFn: fetchHealth,
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  const status: 'connected' | 'degraded' | 'disconnected' =
    query.data?.status === 'ok' ? 'connected' : query.data?.status === 'degraded' ? 'degraded' : 'disconnected';

  return { status, isLoading: query.isPending };
}
