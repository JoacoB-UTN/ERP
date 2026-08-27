'use client';

import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import type {
  CreatePurchaseOrderInput,
  UpdatePurchaseOrderInput,
  PurchaseOrderListQuery,
  PurchaseOrderListResponse,
  PurchaseOrderDetailResponse,
} from '@erp/shared';
import type { ApiFetchOptions } from './api-client';

interface PurchaseOrdersClientConfig {
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

/**
 * Purchase Order hooks — Gestión's /compras/ordenes. See docs/purchases.md.
 * Confirming a PO never touches inventory, so — unlike Sales' confirm —
 * these mutations never invalidate the `inventory` query prefix.
 */
export function createPurchaseOrdersClient(config: PurchaseOrdersClientConfig) {
  const { apiFetch, useActiveCompanyId } = config;

  function invalidatePurchaseOrders(
    queryClient: ReturnType<typeof useQueryClient>,
    companyId: string | null,
    id?: string,
  ) {
    void queryClient.invalidateQueries({ queryKey: ['company', companyId, 'purchase-orders'] });
    if (id) {
      void queryClient.invalidateQueries({ queryKey: ['company', companyId, 'purchase-orders', 'detail', id] });
    }
  }

  function usePurchaseOrders(filters: Partial<PurchaseOrderListQuery>) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'purchase-orders', 'list', filters],
      queryFn: () =>
        apiFetch<PurchaseOrderListResponse>(
          `/purchase-orders${buildQueryString({
            search: filters.search,
            status: filters.status,
            supplierId: filters.supplierId,
            branchId: filters.branchId,
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

  function usePurchaseOrder(id: string | null) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'purchase-orders', 'detail', id],
      queryFn: () => apiFetch<PurchaseOrderDetailResponse>(`/purchase-orders/${id}`),
      enabled: !!companyId && !!id,
    });
  }

  function useCreatePurchaseOrder() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: (input: CreatePurchaseOrderInput) =>
        apiFetch<PurchaseOrderDetailResponse>('/purchase-orders', { json: input }),
      onSuccess: () => invalidatePurchaseOrders(queryClient, companyId),
    });
  }

  function useUpdatePurchaseOrder() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: ({ id, input }: { id: string; input: UpdatePurchaseOrderInput }) =>
        apiFetch<PurchaseOrderDetailResponse>(`/purchase-orders/${id}`, { method: 'PATCH', json: input }),
      onSuccess: (_data, variables) => invalidatePurchaseOrders(queryClient, companyId, variables.id),
    });
  }

  function useConfirmPurchaseOrder() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: (id: string) =>
        apiFetch<PurchaseOrderDetailResponse>(`/purchase-orders/${id}/confirm`, { method: 'POST' }),
      onSuccess: (_data, id) => invalidatePurchaseOrders(queryClient, companyId, id),
    });
  }

  function useCancelPurchaseOrder() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: (id: string) =>
        apiFetch<PurchaseOrderDetailResponse>(`/purchase-orders/${id}/cancel`, { method: 'POST' }),
      onSuccess: (_data, id) => invalidatePurchaseOrders(queryClient, companyId, id),
    });
  }

  return {
    usePurchaseOrders,
    usePurchaseOrder,
    useCreatePurchaseOrder,
    useUpdatePurchaseOrder,
    useConfirmPurchaseOrder,
    useCancelPurchaseOrder,
  };
}
