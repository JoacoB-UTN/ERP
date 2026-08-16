'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import type { BranchesResponse, BranchSummary, CompaniesResponse, CompanySummary } from '@erp/shared';
import type { ApiError, ApiFetchOptions } from './api-client';
import type { CompanyContextStore } from './company-context-store';

export const CONTEXT_COMPANIES_QUERY_KEY = ['context', 'companies'] as const;

interface CompanyContextClientConfig {
  apiFetch: <T>(path: string, options?: ApiFetchOptions) => Promise<T>;
  store: CompanyContextStore;
}

/**
 * Builds the company/branch-context hooks shared by every app. Deliberately
 * plain TanStack Query + a tiny external store (see company-context-store.ts)
 * instead of a bigger state framework — see CLAUDE.md ("do not create a
 * giant global state framework unless genuinely necessary").
 */
export function createCompanyContextClient(config: CompanyContextClientConfig) {
  const { apiFetch, store } = config;

  function useCompanies(options?: Partial<UseQueryOptions<CompaniesResponse, ApiError>>) {
    return useQuery({
      queryKey: CONTEXT_COMPANIES_QUERY_KEY,
      queryFn: () => apiFetch<CompaniesResponse>('/context/companies'),
      staleTime: 60_000,
      ...options,
    });
  }

  /** Raw reactive read of the persisted selection — most components should use useActiveCompany() instead. */
  function useActiveCompanyId(): string | null {
    return useSyncExternalStore(
      store.subscribe,
      () => store.getActiveCompanyId(),
      () => null,
    );
  }

  function useActiveBranchId(): string | null {
    return useSyncExternalStore(
      store.subscribe,
      () => store.getActiveBranchId(),
      () => null,
    );
  }

  /**
   * The company-selection state machine described in CLAUDE.md /
   * docs/multi-company-architecture.md: load accessible companies → if the
   * remembered company is still in that list, keep it; if exactly one
   * company exists, auto-select it; otherwise ask the caller to show a
   * selector (companies.length > 1) or a "no companies" state
   * (companies.length === 0). Never trusts stale localStorage — every
   * remembered id is re-validated against the freshly-loaded list.
   */
  function useActiveCompany() {
    const companiesQuery = useCompanies();
    const queryClient = useQueryClient();
    const storedId = useActiveCompanyId();
    const companies = companiesQuery.data?.companies ?? [];

    const resolvedId = useMemo(() => {
      if (!companiesQuery.isSuccess) return storedId;
      if (storedId && companies.some((c) => c.id === storedId)) return storedId;
      if (companies.length === 1) return companies[0].id;
      return null;
    }, [companiesQuery.isSuccess, storedId, companies]);

    // Persist the resolved id (auto-select, or clearing a stale one) once
    // rendering settles — setActiveCompany below is what callers use for
    // an explicit user-driven switch.
    useEffect(() => {
      if (companiesQuery.isSuccess && resolvedId !== storedId) {
        store.setActiveCompanyId(resolvedId);
      }
    }, [companiesQuery.isSuccess, resolvedId, storedId]);

    const activeCompany: CompanySummary | null = companies.find((c) => c.id === resolvedId) ?? null;

    function setActiveCompany(companyId: string | null) {
      store.setActiveCompanyId(companyId);
      // Company-scoped queries must key off the active company (see
      // CLAUDE.md: `['company', companyId, ...]`) — clearing every such
      // query on switch is what guarantees the previous company's data
      // never lingers on screen while the new context loads.
      void queryClient.removeQueries({
        predicate: (q) => q.queryKey[0] === 'company',
      });
    }

    return {
      isLoading: companiesQuery.isLoading,
      isError: companiesQuery.isError,
      companies,
      activeCompanyId: resolvedId,
      activeCompany,
      needsSelection: companiesQuery.isSuccess && companies.length > 1 && !resolvedId,
      hasNoCompanies: companiesQuery.isSuccess && companies.length === 0,
      setActiveCompany,
    };
  }

  function useBranches(
    companyId: string | null,
    options?: Partial<UseQueryOptions<BranchesResponse, ApiError>>,
  ) {
    return useQuery({
      queryKey: ['context', 'branches', companyId],
      queryFn: () => apiFetch<BranchesResponse>(`/context/companies/${companyId}/branches`),
      enabled: !!companyId,
      staleTime: 60_000,
      ...options,
    });
  }

  /** Same restore/validate/auto-select logic as useActiveCompany(), scoped to the active company's branches. */
  function useActiveBranch(companyId: string | null) {
    const branchesQuery = useBranches(companyId);
    const storedId = useActiveBranchId();
    const branches = branchesQuery.data?.branches ?? [];

    const resolvedId = useMemo(() => {
      if (!companyId) return null;
      if (!branchesQuery.isSuccess) return storedId;
      if (storedId && branches.some((b) => b.id === storedId)) return storedId;
      if (branches.length === 1) return branches[0].id;
      return null;
    }, [companyId, branchesQuery.isSuccess, storedId, branches]);

    useEffect(() => {
      if (companyId && branchesQuery.isSuccess && resolvedId !== storedId) {
        store.setActiveBranchId(resolvedId);
      }
    }, [companyId, branchesQuery.isSuccess, resolvedId, storedId]);

    const activeBranch: BranchSummary | null = branches.find((b) => b.id === resolvedId) ?? null;

    return {
      isLoading: branchesQuery.isLoading,
      isError: branchesQuery.isError,
      branches,
      activeBranchId: resolvedId,
      activeBranch,
      needsSelection: branchesQuery.isSuccess && branches.length > 1 && !resolvedId,
      hasNoBranches: branchesQuery.isSuccess && branches.length === 0,
      setActiveBranch: (branchId: string | null) => store.setActiveBranchId(branchId),
    };
  }

  return {
    useCompanies,
    useActiveCompanyId,
    useActiveCompany,
    useBranches,
    useActiveBranchId,
    useActiveBranch,
  };
}
