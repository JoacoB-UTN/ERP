'use client';

import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import type {
  CreatePurchaseReceiptInput,
  UpdatePurchaseReceiptInput,
  PurchaseReceiptListQuery,
  PurchaseReceiptListResponse,
  PurchaseReceiptDetailResponse,
} from '@erp/shared';
import type { ApiFetchOptions } from './api-client';

interface PurchaseReceiptsClientConfig {
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
 * Goods Receipt hooks — Gestión's /compras/recepciones. See
 * docs/purchases.md. Confirming/cancelling a receipt DOES move inventory
 * (the only Purchases document that does), so these two mutations also
 * invalidate the `inventory` prefix — same pattern as Sales' confirm.
 */
export function createPurchaseReceiptsClient(config: PurchaseReceiptsClientConfig) {
  const { apiFetch, useActiveCompanyId } = config;

  function invalidateReceipts(
    queryClient: ReturnType<typeof useQueryClient>,
    companyId: string | null,
    id?: string,
  ) {
    void queryClient.invalidateQueries({ queryKey: ['company', companyId, 'purchase-receipts'] });
    if (id) {
      void queryClient.invalidateQueries({ queryKey: ['company', companyId, 'purchase-receipts', 'detail', id] });
    }
  }
  function invalidateInventory(queryClient: ReturnType<typeof useQueryClient>, companyId: string | null) {
    void queryClient.invalidateQueries({ queryKey: ['company', companyId, 'inventory'] });
  }
  /** A receipt's stock effect also changes its originating order's received/pending quantities. */
  function invalidatePurchaseOrders(queryClient: ReturnType<typeof useQueryClient>, companyId: string | null) {
    void queryClient.invalidateQueries({ queryKey: ['company', companyId, 'purchase-orders'] });
  }

  function usePurchaseReceipts(filters: Partial<PurchaseReceiptListQuery>) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'purchase-receipts', 'list', filters],
      queryFn: () =>
        apiFetch<PurchaseReceiptListResponse>(
          `/purchase-receipts${buildQueryString({
            search: filters.search,
            status: filters.status,
            supplierId: filters.supplierId,
            warehouseId: filters.warehouseId,
            purchaseOrderId: filters.purchaseOrderId,
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

  function usePurchaseReceipt(id: string | null) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'purchase-receipts', 'detail', id],
      queryFn: () => apiFetch<PurchaseReceiptDetailResponse>(`/purchase-receipts/${id}`),
      enabled: !!companyId && !!id,
    });
  }

  function useCreatePurchaseReceipt() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: (input: CreatePurchaseReceiptInput) =>
        apiFetch<PurchaseReceiptDetailResponse>('/purchase-receipts', { json: input }),
      onSuccess: () => invalidateReceipts(queryClient, companyId),
    });
  }

  function useUpdatePurchaseReceipt() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: ({ id, input }: { id: string; input: UpdatePurchaseReceiptInput }) =>
        apiFetch<PurchaseReceiptDetailResponse>(`/purchase-receipts/${id}`, { method: 'PATCH', json: input }),
      onSuccess: (_data, variables) => invalidateReceipts(queryClient, companyId, variables.id),
    });
  }

  function useConfirmPurchaseReceipt() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: (id: string) =>
        apiFetch<PurchaseReceiptDetailResponse>(`/purchase-receipts/${id}/confirm`, { method: 'POST' }),
      onSuccess: (_data, id) => {
        invalidateReceipts(queryClient, companyId, id);
        invalidateInventory(queryClient, companyId);
        invalidatePurchaseOrders(queryClient, companyId);
      },
    });
  }

  function useCancelPurchaseReceipt() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: (id: string) =>
        apiFetch<PurchaseReceiptDetailResponse>(`/purchase-receipts/${id}/cancel`, { method: 'POST' }),
      onSuccess: (_data, id) => {
        invalidateReceipts(queryClient, companyId, id);
        invalidateInventory(queryClient, companyId);
        invalidatePurchaseOrders(queryClient, companyId);
      },
    });
  }

  return {
    usePurchaseReceipts,
    usePurchaseReceipt,
    useCreatePurchaseReceipt,
    useUpdatePurchaseReceipt,
    useConfirmPurchaseReceipt,
    useCancelPurchaseReceipt,
  };
}
