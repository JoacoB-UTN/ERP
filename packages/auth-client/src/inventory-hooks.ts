'use client';

import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import type {
  StockListQuery,
  StockListResponse,
  ProductStockResponse,
  VariantStockResponse,
  InventoryLookupQuery,
  InventoryLookupResponse,
  MovementListQuery,
  MovementListResponse,
  MovementDetailResponse,
  CreateInitialBalanceInput,
  InitialBalanceResponse,
  CreateStockAdjustmentInput,
  UpdateStockAdjustmentInput,
  StockAdjustmentListQuery,
  StockAdjustmentListResponse,
  StockAdjustmentDetailResponse,
} from '@erp/shared';
import type { ApiFetchOptions } from './api-client';

interface InventoryClientConfig {
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
 * Inventory ledger hooks — stock, movements, initial balances, and
 * adjustments. See docs/inventory.md and CLAUDE.md: StockMovement is the
 * only authoritative source of physical inventory, InventoryBalance is a
 * rebuildable projection. Query keys are scoped by companyId (and, where
 * relevant, embedded warehouseId/filters) so switching companies never
 * shows stale stock — see CLAUDE.md's company-isolation rule.
 */
export function createInventoryClient(config: InventoryClientConfig) {
  const { apiFetch, useActiveCompanyId } = config;

  /**
   * Confirming/creating adjustments and initial balances can move stock for
   * any product/warehouse — rather than tracking which specific
   * product/variant/warehouse queries are stale, invalidate the whole
   * inventory prefix for the company. Simpler and safe; inventory reads are
   * cheap relative to the cost of a stale Físico/Disponible number.
   */
  function invalidateInventory(queryClient: ReturnType<typeof useQueryClient>, companyId: string | null) {
    void queryClient.invalidateQueries({ queryKey: ['company', companyId, 'inventory'] });
  }

  // ---------- Stock ----------

  function useStock(filters: Partial<StockListQuery>) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'inventory', 'stock', filters],
      queryFn: () =>
        apiFetch<StockListResponse>(
          `/inventory/stock${buildQueryString({
            search: filters.search,
            warehouseId: filters.warehouseId,
            productId: filters.productId,
            categoryId: filters.categoryId,
            brandId: filters.brandId,
            status: filters.status,
            belowMinimum: filters.belowMinimum,
            page: filters.page,
            pageSize: filters.pageSize,
          })}`,
        ),
      enabled: !!companyId,
      placeholderData: keepPreviousData,
    });
  }

  function useProductStock(productId: string | null) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'inventory', 'product-stock', productId],
      queryFn: () => apiFetch<ProductStockResponse>(`/inventory/products/${productId}`),
      enabled: !!companyId && !!productId,
    });
  }

  function useVariantStock(variantId: string | null) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'inventory', 'variant-stock', variantId],
      queryFn: () => apiFetch<VariantStockResponse>(`/inventory/variants/${variantId}`),
      enabled: !!companyId && !!variantId,
    });
  }

  /** Inventory-aware operational lookup for a future Facturación/POS selector — see docs/inventory.md. */
  function useInventoryLookup(query: InventoryLookupQuery, options?: { enabled?: boolean }) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'inventory', 'lookup', query],
      queryFn: () =>
        apiFetch<InventoryLookupResponse>(
          `/inventory/lookup${buildQueryString({
            search: query.search,
            barcode: query.barcode,
            warehouseId: query.warehouseId,
            limit: query.limit,
          })}`,
        ),
      enabled: !!companyId && (options?.enabled ?? true),
    });
  }

  // ---------- Movements ----------

  function useMovements(filters: Partial<MovementListQuery>) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'inventory', 'movements', 'list', filters],
      queryFn: () =>
        apiFetch<MovementListResponse>(
          `/inventory/movements${buildQueryString({
            dateFrom: filters.dateFrom ? new Date(filters.dateFrom).toISOString() : undefined,
            dateTo: filters.dateTo ? new Date(filters.dateTo).toISOString() : undefined,
            warehouseId: filters.warehouseId,
            productId: filters.productId,
            variantId: filters.variantId,
            movementType: filters.movementType,
            referenceType: filters.referenceType,
            search: filters.search,
            page: filters.page,
            pageSize: filters.pageSize,
          })}`,
        ),
      enabled: !!companyId,
      placeholderData: keepPreviousData,
    });
  }

  function useMovement(id: string | null) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'inventory', 'movements', 'detail', id],
      queryFn: () => apiFetch<MovementDetailResponse>(`/inventory/movements/${id}`),
      enabled: !!companyId && !!id,
    });
  }

  // ---------- Initial balance ----------

  function useCreateInitialBalance() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: (input: CreateInitialBalanceInput) =>
        apiFetch<InitialBalanceResponse>('/inventory/initial-balance', { json: input }),
      onSuccess: () => invalidateInventory(queryClient, companyId),
    });
  }

  // ---------- Stock adjustments ----------

  function useStockAdjustments(filters: Partial<StockAdjustmentListQuery>) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'inventory', 'adjustments', 'list', filters],
      queryFn: () =>
        apiFetch<StockAdjustmentListResponse>(
          `/inventory/adjustments${buildQueryString({
            warehouseId: filters.warehouseId,
            status: filters.status,
            page: filters.page,
            pageSize: filters.pageSize,
          })}`,
        ),
      enabled: !!companyId,
      placeholderData: keepPreviousData,
    });
  }

  function useStockAdjustment(id: string | null) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'inventory', 'adjustments', 'detail', id],
      queryFn: () => apiFetch<StockAdjustmentDetailResponse>(`/inventory/adjustments/${id}`),
      enabled: !!companyId && !!id,
    });
  }

  function useCreateStockAdjustment() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: (input: CreateStockAdjustmentInput) =>
        apiFetch<StockAdjustmentDetailResponse>('/inventory/adjustments', { json: input }),
      onSuccess: () => invalidateInventory(queryClient, companyId),
    });
  }

  function useUpdateStockAdjustment() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: ({ id, input }: { id: string; input: UpdateStockAdjustmentInput }) =>
        apiFetch<StockAdjustmentDetailResponse>(`/inventory/adjustments/${id}`, {
          method: 'PATCH',
          json: input,
        }),
      onSuccess: () => invalidateInventory(queryClient, companyId),
    });
  }

  function useConfirmStockAdjustment() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: (id: string) =>
        apiFetch<StockAdjustmentDetailResponse>(`/inventory/adjustments/${id}/confirm`, { method: 'POST' }),
      onSuccess: () => invalidateInventory(queryClient, companyId),
    });
  }

  function useCancelStockAdjustment() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: (id: string) =>
        apiFetch<StockAdjustmentDetailResponse>(`/inventory/adjustments/${id}/cancel`, { method: 'POST' }),
      onSuccess: () => invalidateInventory(queryClient, companyId),
    });
  }

  return {
    useStock,
    useProductStock,
    useVariantStock,
    useInventoryLookup,
    useMovements,
    useMovement,
    useCreateInitialBalance,
    useStockAdjustments,
    useStockAdjustment,
    useCreateStockAdjustment,
    useUpdateStockAdjustment,
    useConfirmStockAdjustment,
    useCancelStockAdjustment,
  };
}
