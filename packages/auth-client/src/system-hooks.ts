'use client';

import { useQuery } from '@tanstack/react-query';
import type { BackupStatusResponse } from '@erp/shared';
import type { ApiFetchOptions } from './api-client';

interface SystemClientConfig {
  apiFetch: <T>(path: string, options?: ApiFetchOptions) => Promise<T>;
  useActiveCompanyId: () => string | null;
}

/**
 * Server operations status — backup health today.
 *
 * The data itself is instance-wide, not company-owned (a backup covers every
 * company on the server). The query is still keyed by the active company
 * because the PERMISSION that gates it is granted per company: a user who can
 * see backup status in one company may not in another, and an unkeyed cache
 * would carry the first company's answer across a company switch.
 *
 * Read-only by design — there is no mutation hook here because the API exposes
 * no way to take, download or restore a backup. See docs/backups.md.
 */
export function createSystemClient(config: SystemClientConfig) {
  const { apiFetch, useActiveCompanyId } = config;

  function useBackupStatus() {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'system', 'backups', 'status'],
      queryFn: () => apiFetch<BackupStatusResponse>('/system/backups/status'),
      enabled: !!companyId,
      // Backups run nightly; the manifest changes rarely. Refetching on every
      // focus would be pure noise, but a stale-for-an-hour answer to "am I
      // protected?" is not acceptable either.
      staleTime: 60_000,
      refetchInterval: 5 * 60_000,
    });
  }

  return { useBackupStatus };
}
