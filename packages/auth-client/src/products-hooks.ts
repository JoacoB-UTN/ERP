'use client';

import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import type {
  CreateProductInput,
  UpdateProductInput,
  ProductVariantCreateInput,
  UpdateProductVariantInput,
  ProductCodeInput,
  UpdateProductCodeInput,
  CreateProductCategoryInput,
  UpdateProductCategoryInput,
  CreateBrandInput,
  UpdateBrandInput,
  CreateUnitOfMeasureInput,
  UpdateUnitOfMeasureInput,
  ProductListQuery,
  ProductLookupQuery,
  ProductListResponse,
  ProductLookupResponse,
  ProductDetailResponse,
  ProductVariantResponse,
  ProductCodeResponse,
  ProductCategoriesResponse,
  ProductCategoryDetailResponse,
  BrandsResponse,
  BrandDetailResponse,
  UnitsOfMeasureResponse,
  UnitOfMeasureDetailResponse,
  AuditEntityHistoryResponse,
} from '@erp/shared';
import type { ApiFetchOptions } from './api-client';

interface ProductsClientConfig {
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
 * Product catalog hooks — the ONE shared catalog client for Gestión today
 * and a future Facturación/POS lookup selector (see CLAUDE.md: "never
 * duplicate Product business logic between the two apps"). Kept in the
 * shared package for that reason, same as createCustomersClient.
 */
export function createProductsClient(config: ProductsClientConfig) {
  const { apiFetch, useActiveCompanyId } = config;

  function invalidateProduct(queryClient: ReturnType<typeof useQueryClient>, companyId: string | null, id?: string) {
    void queryClient.invalidateQueries({ queryKey: ['company', companyId, 'products', 'list'] });
    void queryClient.invalidateQueries({ queryKey: ['company', companyId, 'products', 'lookup'] });
    if (id) {
      void queryClient.invalidateQueries({ queryKey: ['company', companyId, 'products', 'detail', id] });
    }
  }

  // ---------- Products ----------

  function useProducts(filters: Partial<ProductListQuery>) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'products', 'list', filters],
      queryFn: () =>
        apiFetch<ProductListResponse>(
          `/products${buildQueryString({
            search: filters.search,
            status: filters.status,
            productType: filters.productType,
            categoryId: filters.categoryId,
            brandId: filters.brandId,
            trackInventory: filters.trackInventory,
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

  function useProduct(id: string | null) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'products', 'detail', id],
      queryFn: () => apiFetch<ProductDetailResponse>(`/products/${id}`),
      enabled: !!companyId && !!id,
    });
  }

  function useProductHistory(id: string | null, page = 1, pageSize = 25) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'products', 'detail', id, 'history', page, pageSize],
      queryFn: () =>
        apiFetch<AuditEntityHistoryResponse>(`/products/${id}/history${buildQueryString({ page, pageSize })}`),
      enabled: !!companyId && !!id,
      placeholderData: keepPreviousData,
    });
  }

  /** Sellable-variant search — for a future Facturación/POS selector, not used by any Gestión screen. */
  function useProductLookup(query: ProductLookupQuery, options?: { enabled?: boolean }) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'products', 'lookup', query],
      queryFn: () =>
        apiFetch<ProductLookupResponse>(
          `/products/lookup${buildQueryString({ search: query.search, barcode: query.barcode, limit: query.limit })}`,
        ),
      enabled: !!companyId && (options?.enabled ?? true),
    });
  }

  function useCreateProduct() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: (input: CreateProductInput) => apiFetch<ProductDetailResponse>('/products', { json: input }),
      onSuccess: () => invalidateProduct(queryClient, companyId),
    });
  }

  function useUpdateProduct() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: ({ id, input }: { id: string; input: UpdateProductInput }) =>
        apiFetch<ProductDetailResponse>(`/products/${id}`, { method: 'PATCH', json: input }),
      onSuccess: (_data, variables) => invalidateProduct(queryClient, companyId, variables.id),
    });
  }

  function useDeactivateProduct() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: (id: string) => apiFetch<ProductDetailResponse>(`/products/${id}/deactivate`, { method: 'POST' }),
      onSuccess: (_data, id) => invalidateProduct(queryClient, companyId, id),
    });
  }

  function useReactivateProduct() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: (id: string) => apiFetch<ProductDetailResponse>(`/products/${id}/reactivate`, { method: 'POST' }),
      onSuccess: (_data, id) => invalidateProduct(queryClient, companyId, id),
    });
  }

  // ---------- Variants ----------

  function useAddProductVariant() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: ({ productId, input }: { productId: string; input: ProductVariantCreateInput }) =>
        apiFetch<ProductVariantResponse>(`/products/${productId}/variants`, { json: input }),
      onSuccess: (_data, variables) => invalidateProduct(queryClient, companyId, variables.productId),
    });
  }

  function useUpdateProductVariant() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: ({
        productId,
        variantId,
        input,
      }: {
        productId: string;
        variantId: string;
        input: UpdateProductVariantInput;
      }) =>
        apiFetch<ProductVariantResponse>(`/products/${productId}/variants/${variantId}`, {
          method: 'PATCH',
          json: input,
        }),
      onSuccess: (_data, variables) => invalidateProduct(queryClient, companyId, variables.productId),
    });
  }

  function useDeactivateProductVariant() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: ({ productId, variantId }: { productId: string; variantId: string }) =>
        apiFetch<ProductVariantResponse>(`/products/${productId}/variants/${variantId}/deactivate`, {
          method: 'POST',
        }),
      onSuccess: (_data, variables) => invalidateProduct(queryClient, companyId, variables.productId),
    });
  }

  function useReactivateProductVariant() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: ({ productId, variantId }: { productId: string; variantId: string }) =>
        apiFetch<ProductVariantResponse>(`/products/${productId}/variants/${variantId}/reactivate`, {
          method: 'POST',
        }),
      onSuccess: (_data, variables) => invalidateProduct(queryClient, companyId, variables.productId),
    });
  }

  // ---------- Codes ----------

  function useAddProductCode() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: ({
        productId,
        variantId,
        input,
      }: {
        productId: string;
        variantId: string;
        input: ProductCodeInput;
      }) => apiFetch<ProductCodeResponse>(`/products/${productId}/variants/${variantId}/codes`, { json: input }),
      onSuccess: (_data, variables) => invalidateProduct(queryClient, companyId, variables.productId),
    });
  }

  function useUpdateProductCode() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: ({
        productId,
        variantId,
        codeId,
        input,
      }: {
        productId: string;
        variantId: string;
        codeId: string;
        input: UpdateProductCodeInput;
      }) =>
        apiFetch<ProductCodeResponse>(`/products/${productId}/variants/${variantId}/codes/${codeId}`, {
          method: 'PATCH',
          json: input,
        }),
      onSuccess: (_data, variables) => invalidateProduct(queryClient, companyId, variables.productId),
    });
  }

  function useRemoveProductCode() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: ({ productId, variantId, codeId }: { productId: string; variantId: string; codeId: string }) =>
        apiFetch<{ ok: true }>(`/products/${productId}/variants/${variantId}/codes/${codeId}`, {
          method: 'DELETE',
        }),
      onSuccess: (_data, variables) => invalidateProduct(queryClient, companyId, variables.productId),
    });
  }

  // ---------- Categories ----------

  function useProductCategories() {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'product-categories'],
      queryFn: () => apiFetch<ProductCategoriesResponse>('/product-categories'),
      enabled: !!companyId,
    });
  }

  function invalidateCategories(queryClient: ReturnType<typeof useQueryClient>, companyId: string | null) {
    void queryClient.invalidateQueries({ queryKey: ['company', companyId, 'product-categories'] });
  }

  function useCreateProductCategory() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: (input: CreateProductCategoryInput) =>
        apiFetch<ProductCategoryDetailResponse>('/product-categories', { json: input }),
      onSuccess: () => invalidateCategories(queryClient, companyId),
    });
  }

  function useUpdateProductCategory() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: ({ id, input }: { id: string; input: UpdateProductCategoryInput }) =>
        apiFetch<ProductCategoryDetailResponse>(`/product-categories/${id}`, { method: 'PATCH', json: input }),
      onSuccess: () => invalidateCategories(queryClient, companyId),
    });
  }

  function useDeactivateProductCategory() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: (id: string) =>
        apiFetch<ProductCategoryDetailResponse>(`/product-categories/${id}/deactivate`, { method: 'POST' }),
      onSuccess: () => invalidateCategories(queryClient, companyId),
    });
  }

  // ---------- Brands ----------

  function useBrands() {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'brands'],
      queryFn: () => apiFetch<BrandsResponse>('/brands'),
      enabled: !!companyId,
    });
  }

  function invalidateBrands(queryClient: ReturnType<typeof useQueryClient>, companyId: string | null) {
    void queryClient.invalidateQueries({ queryKey: ['company', companyId, 'brands'] });
  }

  function useCreateBrand() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: (input: CreateBrandInput) => apiFetch<BrandDetailResponse>('/brands', { json: input }),
      onSuccess: () => invalidateBrands(queryClient, companyId),
    });
  }

  function useUpdateBrand() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: ({ id, input }: { id: string; input: UpdateBrandInput }) =>
        apiFetch<BrandDetailResponse>(`/brands/${id}`, { method: 'PATCH', json: input }),
      onSuccess: () => invalidateBrands(queryClient, companyId),
    });
  }

  function useDeactivateBrand() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: (id: string) => apiFetch<BrandDetailResponse>(`/brands/${id}/deactivate`, { method: 'POST' }),
      onSuccess: () => invalidateBrands(queryClient, companyId),
    });
  }

  // ---------- Units of measure ----------

  function useUnits() {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'units'],
      queryFn: () => apiFetch<UnitsOfMeasureResponse>('/units'),
      enabled: !!companyId,
    });
  }

  function invalidateUnits(queryClient: ReturnType<typeof useQueryClient>, companyId: string | null) {
    void queryClient.invalidateQueries({ queryKey: ['company', companyId, 'units'] });
  }

  function useCreateUnit() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: (input: CreateUnitOfMeasureInput) => apiFetch<UnitOfMeasureDetailResponse>('/units', { json: input }),
      onSuccess: () => invalidateUnits(queryClient, companyId),
    });
  }

  function useUpdateUnit() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: ({ id, input }: { id: string; input: UpdateUnitOfMeasureInput }) =>
        apiFetch<UnitOfMeasureDetailResponse>(`/units/${id}`, { method: 'PATCH', json: input }),
      onSuccess: () => invalidateUnits(queryClient, companyId),
    });
  }

  function useDeactivateUnit() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: (id: string) => apiFetch<UnitOfMeasureDetailResponse>(`/units/${id}/deactivate`, { method: 'POST' }),
      onSuccess: () => invalidateUnits(queryClient, companyId),
    });
  }

  return {
    useProducts,
    useProduct,
    useProductHistory,
    useProductLookup,
    useCreateProduct,
    useUpdateProduct,
    useDeactivateProduct,
    useReactivateProduct,
    useAddProductVariant,
    useUpdateProductVariant,
    useDeactivateProductVariant,
    useReactivateProductVariant,
    useAddProductCode,
    useUpdateProductCode,
    useRemoveProductCode,
    useProductCategories,
    useCreateProductCategory,
    useUpdateProductCategory,
    useDeactivateProductCategory,
    useBrands,
    useCreateBrand,
    useUpdateBrand,
    useDeactivateBrand,
    useUnits,
    useCreateUnit,
    useUpdateUnit,
    useDeactivateUnit,
  };
}
