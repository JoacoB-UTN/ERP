'use client';

import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import type {
  CurrenciesResponse,
  CreatePriceListInput,
  UpdatePriceListInput,
  PriceListsResponse,
  PriceListDetailResponse,
  PriceListItemsQuery,
  PriceListItemsResponse,
  SetPriceInput,
  SetPriceResponse,
  SetPricesBatchInput,
  SetPricesBatchResponse,
  BulkAdjustInput,
  BulkAdjustPreviewResponse,
  BulkAdjustResponse,
  PriceHistoryQuery,
  PriceHistoryResponse,
  PriceLookupQuery,
  PriceLookupResponse,
  PriceLookupBatchInput,
  PriceLookupBatchResponse,
  ProductPricesResponse,
  PriceListHistoryQuery,
  AuditEntityHistoryResponse,
} from '@erp/shared';
import type { ApiFetchOptions } from './api-client';

interface PricingClientConfig {
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
 * Pricing hooks — PriceList administration, price editing/bulk-adjust, price
 * history, and the operational lookup Facturación will consume. See
 * docs/pricing.md and CLAUDE.md: Products never own an authoritative sale
 * price, PriceListItem does, and only through PricingService. Query keys are
 * scoped by companyId, same isolation rule as every other module.
 *
 * A DERIVED list's resolved prices depend on its base list's current FIXED
 * prices, and changing the default list can affect which list Facturación
 * auto-selects — so, like inventory-hooks.ts, every mutation here
 * invalidates the whole `['company', companyId, 'pricing']` prefix rather
 * than trying to track which specific lists/items became stale.
 */
export function createPricingClient(config: PricingClientConfig) {
  const { apiFetch, useActiveCompanyId } = config;

  function invalidatePricing(queryClient: ReturnType<typeof useQueryClient>, companyId: string | null) {
    void queryClient.invalidateQueries({ queryKey: ['company', companyId, 'pricing'] });
  }

  // ---------- Currencies ----------

  function useCurrencies() {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'pricing', 'currencies'],
      queryFn: () => apiFetch<CurrenciesResponse>('/pricing/currencies'),
      enabled: !!companyId,
    });
  }

  // ---------- Price lists ----------

  function usePriceLists() {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'pricing', 'lists', 'list'],
      queryFn: () => apiFetch<PriceListsResponse>('/pricing/lists'),
      enabled: !!companyId,
    });
  }

  function usePriceList(id: string | null) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'pricing', 'lists', 'detail', id],
      queryFn: () => apiFetch<PriceListDetailResponse>(`/pricing/lists/${id}`),
      enabled: !!companyId && !!id,
    });
  }

  function useCreatePriceList() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: (input: CreatePriceListInput) =>
        apiFetch<PriceListDetailResponse>('/pricing/lists', { json: input }),
      onSuccess: () => invalidatePricing(queryClient, companyId),
    });
  }

  function useUpdatePriceList() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: ({ id, input }: { id: string; input: UpdatePriceListInput }) =>
        apiFetch<PriceListDetailResponse>(`/pricing/lists/${id}`, { method: 'PATCH', json: input }),
      onSuccess: () => invalidatePricing(queryClient, companyId),
    });
  }

  function useDeactivatePriceList() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: (id: string) =>
        apiFetch<PriceListDetailResponse>(`/pricing/lists/${id}/deactivate`, { method: 'POST' }),
      onSuccess: () => invalidatePricing(queryClient, companyId),
    });
  }

  function useReactivatePriceList() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: (id: string) =>
        apiFetch<PriceListDetailResponse>(`/pricing/lists/${id}/reactivate`, { method: 'POST' }),
      onSuccess: () => invalidatePricing(queryClient, companyId),
    });
  }

  /** Administrative history (created/updated/deactivated/default changed/...) — distinct from usePriceHistory's per-variant commercial price evolution below. */
  function usePriceListHistory(id: string | null, query: Partial<PriceListHistoryQuery>) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'pricing', 'lists', 'detail', id, 'history', query],
      queryFn: () =>
        apiFetch<AuditEntityHistoryResponse>(
          `/pricing/lists/${id}/history${buildQueryString({ page: query.page, pageSize: query.pageSize })}`,
        ),
      enabled: !!companyId && !!id,
      placeholderData: keepPreviousData,
    });
  }

  // ---------- Price list items (catalog + current price, joined at read time) ----------

  function usePriceListItems(priceListId: string | null, filters: Partial<PriceListItemsQuery>) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'pricing', 'lists', priceListId, 'items', filters],
      queryFn: () =>
        apiFetch<PriceListItemsResponse>(
          `/pricing/lists/${priceListId}/items${buildQueryString({
            search: filters.search,
            categoryId: filters.categoryId,
            brandId: filters.brandId,
            status: filters.status,
            hasPrice: filters.hasPrice,
            page: filters.page,
            pageSize: filters.pageSize,
          })}`,
        ),
      enabled: !!companyId && !!priceListId,
      placeholderData: keepPreviousData,
    });
  }

  // ---------- Setting prices (FIXED lists only) ----------

  function useSetPrice() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: ({
        priceListId,
        variantId,
        input,
      }: {
        priceListId: string;
        variantId: string;
        input: SetPriceInput;
      }) =>
        apiFetch<SetPriceResponse>(`/pricing/lists/${priceListId}/products/${variantId}`, {
          method: 'PUT',
          json: input,
        }),
      onSuccess: () => invalidatePricing(queryClient, companyId),
    });
  }

  function useSetPrices() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: ({ priceListId, input }: { priceListId: string; input: SetPricesBatchInput }) =>
        apiFetch<SetPricesBatchResponse>(`/pricing/lists/${priceListId}/prices`, {
          method: 'PUT',
          json: input,
        }),
      onSuccess: () => invalidatePricing(queryClient, companyId),
    });
  }

  // ---------- Bulk adjustment (FIXED lists only) ----------

  /** Produces no database changes — safe to call repeatedly while the user tweaks scope/adjustment. */
  function usePreviewBulkAdjust() {
    return useMutation({
      mutationFn: ({ priceListId, input }: { priceListId: string; input: BulkAdjustInput }) =>
        apiFetch<BulkAdjustPreviewResponse>(`/pricing/lists/${priceListId}/bulk-adjust/preview`, {
          method: 'POST',
          json: input,
        }),
    });
  }

  function useConfirmBulkAdjust() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: ({ priceListId, input }: { priceListId: string; input: BulkAdjustInput }) =>
        apiFetch<BulkAdjustResponse>(`/pricing/lists/${priceListId}/bulk-adjust`, {
          method: 'POST',
          json: input,
        }),
      onSuccess: () => invalidatePricing(queryClient, companyId),
    });
  }

  // ---------- Price history ----------

  function usePriceHistory(
    priceListId: string | null,
    variantId: string | null,
    query: Partial<PriceHistoryQuery>,
  ) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'pricing', 'lists', priceListId, 'history', variantId, query],
      queryFn: () =>
        apiFetch<PriceHistoryResponse>(
          `/pricing/lists/${priceListId}/products/${variantId}/history${buildQueryString({
            page: query.page,
            pageSize: query.pageSize,
          })}`,
        ),
      enabled: !!companyId && !!priceListId && !!variantId,
      placeholderData: keepPreviousData,
    });
  }

  // ---------- Operational lookup (future Facturación/POS — see docs/pricing.md) ----------

  /** Operational lookup for a future Facturación/POS selector. Key includes companyId + priceListId per CLAUDE.md's cache-isolation rule. */
  function usePriceLookup(query: PriceLookupQuery, options?: { enabled?: boolean }) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'pricing', 'lookup', query.priceListId, query],
      queryFn: () =>
        apiFetch<PriceLookupResponse>(
          `/pricing/lookup${buildQueryString({
            priceListId: query.priceListId,
            productVariantId: query.productVariantId,
            date: query.date ? new Date(query.date).toISOString() : undefined,
          })}`,
        ),
      enabled: !!companyId && !!query.priceListId && !!query.productVariantId && (options?.enabled ?? true),
    });
  }

  /** On-demand batch lookup (e.g. pricing a list of variants at once) — modeled as a mutation since it POSTs a body. */
  function useLookupPricesBatch() {
    return useMutation({
      mutationFn: (input: PriceLookupBatchInput) =>
        apiFetch<PriceLookupBatchResponse>('/pricing/lookup/batch', { json: input }),
    });
  }

  // ---------- Product price view (Product detail "Precios" tab) ----------

  function useProductPrices(productId: string | null) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'pricing', 'products', productId],
      queryFn: () => apiFetch<ProductPricesResponse>(`/pricing/products/${productId}/prices`),
      enabled: !!companyId && !!productId,
    });
  }

  return {
    useCurrencies,
    usePriceLists,
    usePriceList,
    useCreatePriceList,
    useUpdatePriceList,
    useDeactivatePriceList,
    useReactivatePriceList,
    usePriceListHistory,
    usePriceListItems,
    useSetPrice,
    useSetPrices,
    usePreviewBulkAdjust,
    useConfirmBulkAdjust,
    usePriceHistory,
    usePriceLookup,
    useLookupPricesBatch,
    useProductPrices,
  };
}
