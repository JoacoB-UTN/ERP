'use client';

import { useQuery } from '@tanstack/react-query';
import type {
  BackupStatusResponse,
  SystemDiagnosticsResponse,
} from '@erp/shared';
import type { ApiFetchOptions } from './api-client';

interface SystemClientConfig {
  apiFetch: <T>(path: string, options?: ApiFetchOptions) => Promise<T>;
  useActiveCompanyId: () => string | null;
}

/**
 * Server operations status: backup health and machine diagnostics.
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

  /**
   * Deep diagnostics for the machine the server runs on.
   *
   * Keyed by company for the same reason as backups: the data is
   * instance-wide, but the permission that gates it is granted per company.
   *
   * Polled faster than backups and refetched on focus, because unlike a
   * nightly manifest these numbers move continuously — an operator who
   * switches back to this tab while watching a sick machine should not be
   * reading a five-minute-old uptime.
   */
  function useSystemDiagnostics() {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'system', 'diagnostics'],
      queryFn: () => apiFetch<SystemDiagnosticsResponse>('/system/diagnostics'),
      enabled: !!companyId,
      staleTime: 15_000,
      refetchInterval: 30_000,
      refetchOnWindowFocus: true,
    });
  }

  return { useBackupStatus, useSystemDiagnostics };
}
