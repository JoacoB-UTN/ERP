'use client';

import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import type {
  CreateSaleInput,
  UpdateSaleInput,
  ConfirmSaleTenderInput,
  SalesListQuery,
  SalesListResponse,
  SalesDetailResponse,
} from '@erp/shared';
import type { ApiFetchOptions } from './api-client';

interface SalesClientConfig {
  apiFetch: <T>(path: string, options?: ApiFetchOptions) => Promise<T>;
  useActiveCompanyId: () => string | null;
}

function buildQueryString(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

/**
 * The demo Sales Core — see docs/sales.md. Confirming a sale also moves
 * inventory (StockMovement), so a successful confirm invalidates both the
 * sales and inventory query prefixes for the active company.
 */
export function createSalesClient(config: SalesClientConfig) {
  const { apiFetch, useActiveCompanyId } = config;

  function invalidateSales(queryClient: ReturnType<typeof useQueryClient>, companyId: string | null) {
    void queryClient.invalidateQueries({ queryKey: ['company', companyId, 'sales'] });
  }

  function invalidateInventory(queryClient: ReturnType<typeof useQueryClient>, companyId: string | null) {
    void queryClient.invalidateQueries({ queryKey: ['company', companyId, 'inventory'] });
  }

  function useSales(filters: Partial<SalesListQuery>) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'sales', 'list', filters],
      queryFn: () =>
        apiFetch<SalesListResponse>(
          `/sales${buildQueryString({
            search: filters.search,
            status: filters.status,
            customerId: filters.customerId,
            warehouseId: filters.warehouseId,
            dateFrom: filters.dateFrom ? new Date(filters.dateFrom).toISOString() : undefined,
            dateTo: filters.dateTo ? new Date(filters.dateTo).toISOString() : undefined,
            page: filters.page,
            pageSize: filters.pageSize,
          })}`,
        ),
      enabled: !!companyId,
      placeholderData: keepPreviousData,
    });
  }

  function useSale(id: string | null) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'sales', 'detail', id],
      queryFn: () => apiFetch<SalesDetailResponse>(`/sales/${id}`),
      enabled: !!companyId && !!id,
    });
  }

  function useCreateSale() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: (input: CreateSaleInput) => apiFetch<SalesDetailResponse>('/sales', { json: input }),
      onSuccess: () => invalidateSales(queryClient, companyId),
    });
  }

  function useUpdateSale() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: ({ id, input }: { id: string; input: UpdateSaleInput }) =>
        apiFetch<SalesDetailResponse>(`/sales/${id}`, { method: 'PATCH', json: input }),
      onSuccess: () => invalidateSales(queryClient, companyId),
    });
  }

  /**
   * `tender` is optional — a plain Facturación/Gestión confirm omits it;
   * POS checkout always supplies one (see docs/pos.md).
   */
  function useConfirmSale() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: ({ id, tender }: { id: string; tender?: ConfirmSaleTenderInput }) =>
        apiFetch<SalesDetailResponse>(`/sales/${id}/confirm`, {
          method: 'POST',
          json: tender ? { tender } : undefined,
        }),
      onSuccess: () => {
        invalidateSales(queryClient, companyId);
        invalidateInventory(queryClient, companyId);
      },
    });
  }

  function useCancelSale() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: (id: string) => apiFetch<SalesDetailResponse>(`/sales/${id}/cancel`, { method: 'POST' }),
      onSuccess: () => invalidateSales(queryClient, companyId),
    });
  }

  return {
    useSales,
    useSale,
    useCreateSale,
    useUpdateSale,
    useConfirmSale,
    useCancelSale,
  };
}
