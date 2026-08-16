'use client';

import { useMemo } from 'react';
import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import type { EffectivePermissionsResponse } from '@erp/shared';
import type { ApiError, ApiFetchOptions } from './api-client';

interface PermissionsClientConfig {
  apiFetch: <T>(path: string, options?: ApiFetchOptions) => Promise<T>;
  /** Reactive read of the active company — re-running the query on switch is what section 70 of CLAUDE.md calls "refresh after company switch." */
  useActiveCompanyId: () => string | null;
}

/**
 * usePermissions()/can()/canAny()/canAll() — the shared frontend
 * authorization primitives required by CLAUDE.md, so no component
 * reinvents permission-checking logic. Query key is
 * ["company", companyId, "permissions"] (see docs/authorization.md and
 * CLAUDE.md's cache-isolation rule) — switching the active company both
 * changes the key (new fetch) AND is covered by useActiveCompany's
 * existing `removeQueries({queryKey[0] === 'company'})` on explicit
 * switches, so stale permissions from a previous company can never leak.
 *
 * This is UX only. The backend remains authoritative — see CLAUDE.md
 * ("frontend permission checks improve UX... never replace backend
 * authorization with UI hiding").
 */
export function createPermissionsClient(config: PermissionsClientConfig) {
  const { apiFetch, useActiveCompanyId } = config;

  function usePermissionsQuery(options?: Partial<UseQueryOptions<EffectivePermissionsResponse, ApiError>>) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'permissions'],
      queryFn: () => apiFetch<EffectivePermissionsResponse>('/context/permissions'),
      enabled: !!companyId,
      staleTime: 30_000,
      ...options,
    });
  }

  function usePermissions() {
    const query = usePermissionsQuery();
    const permissionSet = useMemo(() => new Set(query.data?.permissions ?? []), [query.data]);

    return {
      isLoading: query.isLoading,
      isError: query.isError,
      permissions: query.data?.permissions ?? [],
      can: (permission: string) => permissionSet.has(permission),
      canAny: (permissions: string[]) => permissions.some((p) => permissionSet.has(p)),
      canAll: (permissions: string[]) => permissions.every((p) => permissionSet.has(p)),
    };
  }

  return { usePermissions, usePermissionsQuery };
}
