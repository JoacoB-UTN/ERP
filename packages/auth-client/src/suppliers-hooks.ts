'use client';

import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import type {
  CreateSupplierInput,
  UpdateSupplierInput,
  SupplierListQuery,
  SupplierLookupQuery,
  SupplierListResponse,
  SupplierLookupResponse,
  SupplierDetailResponse,
} from '@erp/shared';
import type { ApiFetchOptions } from './api-client';

interface SuppliersClientConfig {
  apiFetch: <T>(path: string, options?: ApiFetchOptions) => Promise<T>;
  useActiveCompanyId: () => string | null;
}

function buildQueryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

/** Supplier master-data hooks — Gestión's /compras/proveedores. See docs/purchases.md. */
export function createSuppliersClient(config: SuppliersClientConfig) {
  const { apiFetch, useActiveCompanyId } = config;

  function invalidateSupplier(queryClient: ReturnType<typeof useQueryClient>, companyId: string | null, id?: string) {
    void queryClient.invalidateQueries({ queryKey: ['company', companyId, 'suppliers', 'list'] });
    void queryClient.invalidateQueries({ queryKey: ['company', companyId, 'suppliers', 'lookup'] });
    if (id) {
      void queryClient.invalidateQueries({ queryKey: ['company', companyId, 'suppliers', 'detail', id] });
    }
  }

  function useSuppliers(filters: Partial<SupplierListQuery>) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'suppliers', 'list', filters],
      queryFn: () =>
        apiFetch<SupplierListResponse>(
          `/suppliers${buildQueryString({
            search: filters.search,
            status: filters.status,
            sortBy: filters.sortBy,
            sortDir: filters.sortDir,
            page: filters.page,
            pageSize: filters.pageSize,
          })}`,
        ),
      enabled: !!companyId,
      placeholderData: keepPreviousData,
    });
  }

  function useSupplier(id: string | null) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'suppliers', 'detail', id],
      queryFn: () => apiFetch<SupplierDetailResponse>(`/suppliers/${id}`),
      enabled: !!companyId && !!id,
    });
  }

  /** ACTIVE-only search for Purchase Order/Receipt supplier pickers. */
  function useSupplierLookup(query: SupplierLookupQuery, options?: { enabled?: boolean }) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'suppliers', 'lookup', query],
      queryFn: () =>
        apiFetch<SupplierLookupResponse>(
          `/suppliers/lookup${buildQueryString({ search: query.search, limit: query.limit })}`,
        ),
      enabled: !!companyId && (options?.enabled ?? true),
    });
  }

  function useCreateSupplier() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: (input: CreateSupplierInput) =>
        apiFetch<SupplierDetailResponse>('/suppliers', { json: input }),
      onSuccess: () => invalidateSupplier(queryClient, companyId),
    });
  }

  function useUpdateSupplier() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: ({ id, input }: { id: string; input: UpdateSupplierInput }) =>
        apiFetch<SupplierDetailResponse>(`/suppliers/${id}`, { method: 'PATCH', json: input }),
      onSuccess: (_data, variables) => invalidateSupplier(queryClient, companyId, variables.id),
    });
  }

  function useDeactivateSupplier() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: (id: string) =>
        apiFetch<SupplierDetailResponse>(`/suppliers/${id}/deactivate`, { method: 'POST' }),
      onSuccess: (_data, id) => invalidateSupplier(queryClient, companyId, id),
    });
  }

  function useReactivateSupplier() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: (id: string) =>
        apiFetch<SupplierDetailResponse>(`/suppliers/${id}/reactivate`, { method: 'POST' }),
      onSuccess: (_data, id) => invalidateSupplier(queryClient, companyId, id),
    });
  }

  return {
    useSuppliers,
    useSupplier,
    useSupplierLookup,
    useCreateSupplier,
    useUpdateSupplier,
    useDeactivateSupplier,
    useReactivateSupplier,
  };
}
