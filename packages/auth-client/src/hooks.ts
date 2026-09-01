'use client';

import { useMutation, useQuery, useQueryClient, type UseMutationOptions } from '@tanstack/react-query';
import type {
  ChangePasswordInput,
  ForgotPasswordInput,
  LoginInput,
  LoginResponse,
  MeResponse,
  ResetPasswordInput,
} from '@erp/shared';
import { createApiClient, type ApiClientConfig, ApiError } from './api-client';
import { createCompanyContextClient } from './company-context-hooks';
import { createPermissionsClient } from './permissions-hooks';
import { createAdministrationClient } from './administration-hooks';
import { createAuditClient } from './audit-hooks';
import { createCustomersClient } from './customers-hooks';
import { createProductsClient } from './products-hooks';
import { createWarehousesClient } from './warehouses-hooks';
import { createInventoryClient } from './inventory-hooks';
import { createWarehouseContextClient } from './warehouse-context-hooks';
import { createPricingClient } from './pricing-hooks';
import { createPriceListContextClient } from './price-list-context-hooks';
import { createSalesClient } from './sales-hooks';
import { createSuppliersClient } from './suppliers-hooks';
import { createPurchaseOrdersClient } from './purchase-orders-hooks';
import { createPurchaseReceiptsClient } from './purchase-receipts-hooks';
import { createDashboardClient } from './dashboard-hooks';
import { createSystemClient } from './system-hooks';
import { createRealtimeClient } from './realtime-client';

export const AUTH_ME_QUERY_KEY = ['auth', 'me'] as const;

export { ApiError };
export type { ApiClientConfig };
export * from './company-context-hooks';
export * from './permissions-hooks';
export * from './administration-hooks';
export * from './audit-hooks';
export * from './customers-hooks';
export * from './products-hooks';
export * from './warehouses-hooks';
export * from './inventory-hooks';
export * from './warehouse-context-hooks';
export * from './pricing-hooks';
export * from './price-list-context-hooks';
export * from './sales-hooks';
export * from './suppliers-hooks';
export * from './purchase-orders-hooks';
export * from './purchase-receipts-hooks';
export * from './dashboard-hooks';
export * from './realtime-client';

/**
 * Builds the set of auth AND company-context hooks for one app (see
 * company-context-hooks.ts). Each app (Gestión, Facturación) calls this
 * once with its own API base URL, `onUnauthenticated` callback (typically
 * a router redirect to that app's own /login), and `storageKeyPrefix`
 * (e.g. "gestion"/"facturacion"), then shares the returned hooks across
 * its components — this is the "shared authentication + company-context
 * client" required by CLAUDE.md, kept as plain hooks rather than a
 * heavier context/provider abstraction.
 */
export function createAuthClient(config: ApiClientConfig) {
  const { apiFetch, companyContextStore } = createApiClient(config);
  const companyContext = createCompanyContextClient({
    apiFetch,
    store: companyContextStore,
  });
  const permissionsClient = createPermissionsClient({
    apiFetch,
    useActiveCompanyId: companyContext.useActiveCompanyId,
  });
  const administrationClient = createAdministrationClient({
    apiFetch,
    useActiveCompanyId: companyContext.useActiveCompanyId,
  });
  const auditClient = createAuditClient({
    apiFetch,
    useActiveCompanyId: companyContext.useActiveCompanyId,
  });
  const customersClient = createCustomersClient({
    apiFetch,
    useActiveCompanyId: companyContext.useActiveCompanyId,
  });
  const productsClient = createProductsClient({
    apiFetch,
    useActiveCompanyId: companyContext.useActiveCompanyId,
  });
  const warehousesClient = createWarehousesClient({
    apiFetch,
    useActiveCompanyId: companyContext.useActiveCompanyId,
  });
  const inventoryClient = createInventoryClient({
    apiFetch,
    useActiveCompanyId: companyContext.useActiveCompanyId,
  });
  const warehouseContextClient = createWarehouseContextClient({
    store: companyContextStore,
    useWarehouses: warehousesClient.useWarehouses,
    useActiveBranchId: companyContext.useActiveBranchId,
  });
  const pricingClient = createPricingClient({
    apiFetch,
    useActiveCompanyId: companyContext.useActiveCompanyId,
  });
  const priceListContextClient = createPriceListContextClient({
    store: companyContextStore,
    usePriceLists: pricingClient.usePriceLists,
    useActiveCompanyId: companyContext.useActiveCompanyId,
  });
  const salesClient = createSalesClient({
    apiFetch,
    useActiveCompanyId: companyContext.useActiveCompanyId,
  });
  const suppliersClient = createSuppliersClient({
    apiFetch,
    useActiveCompanyId: companyContext.useActiveCompanyId,
  });
  const purchaseOrdersClient = createPurchaseOrdersClient({
    apiFetch,
    useActiveCompanyId: companyContext.useActiveCompanyId,
  });
  const purchaseReceiptsClient = createPurchaseReceiptsClient({
    apiFetch,
    useActiveCompanyId: companyContext.useActiveCompanyId,
  });
  const dashboardClient = createDashboardClient({
    apiFetch,
    useActiveCompanyId: companyContext.useActiveCompanyId,
  });
  const systemClient = createSystemClient({
    apiFetch,
    useActiveCompanyId: companyContext.useActiveCompanyId,
  });
  const realtimeClient = createRealtimeClient({
    baseUrl: config.baseUrl,
    useActiveCompanyId: companyContext.useActiveCompanyId,
  });

  /**
   * Session bootstrap: querying /auth/me transparently handles all three
   * startup states —
   *   - valid access token           → resolves immediately
   *   - expired access token         → apiFetch refreshes once and retries
   *   - no/invalid session           → onUnauthenticated() fires, query errors
   * No separate "check session" step is needed; this IS that step.
   */
  function useMe(options?: { enabled?: boolean }) {
    return useQuery({
      queryKey: AUTH_ME_QUERY_KEY,
      queryFn: () => apiFetch<MeResponse>('/auth/me'),
      retry: false,
      staleTime: 60_000,
      enabled: options?.enabled,
    });
  }

  function useLogin(options?: UseMutationOptions<LoginResponse, ApiError, LoginInput>) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (input: LoginInput) => apiFetch<LoginResponse>('/auth/login', { json: input }),
      onSuccess: (data, ...rest) => {
        queryClient.setQueryData(AUTH_ME_QUERY_KEY, { user: data.user });
        void queryClient.invalidateQueries({ queryKey: AUTH_ME_QUERY_KEY });
        options?.onSuccess?.(data, ...rest);
      },
      ...options,
    });
  }

  function clearSessionState(queryClient: ReturnType<typeof useQueryClient>) {
    queryClient.removeQueries({ queryKey: AUTH_ME_QUERY_KEY });
    // Company context is meaningless without a session — clearing it here
    // means the next login always goes through the normal restore flow
    // instead of momentarily flashing the previous user's selection.
    companyContextStore.setActiveCompanyId(null);
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] === 'context' });
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] === 'company' });
  }

  function useLogout() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: () => apiFetch<{ ok: true }>('/auth/logout', { method: 'POST' }),
      onSuccess: () => clearSessionState(queryClient),
    });
  }

  function useLogoutAll() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: () => apiFetch<{ ok: true }>('/auth/logout-all', { method: 'POST' }),
      onSuccess: () => clearSessionState(queryClient),
    });
  }

  function useChangePassword() {
    return useMutation({
      mutationFn: (input: ChangePasswordInput) =>
        apiFetch<{ ok: true }>('/auth/change-password', { json: input }),
    });
  }

  function useForgotPassword() {
    return useMutation({
      mutationFn: (input: ForgotPasswordInput) =>
        apiFetch<{ message: string }>('/auth/forgot-password', { json: input }),
    });
  }

  function useResetPassword() {
    return useMutation({
      mutationFn: (input: ResetPasswordInput) =>
        apiFetch<{ ok: true }>('/auth/reset-password', { json: input }),
    });
  }

  return {
    apiFetch,
    companyContextStore,
    useMe,
    useLogin,
    useLogout,
    useLogoutAll,
    useChangePassword,
    useForgotPassword,
    useResetPassword,
    ...companyContext,
    ...permissionsClient,
    ...administrationClient,
    ...auditClient,
    ...customersClient,
    ...productsClient,
    ...warehousesClient,
    ...inventoryClient,
    ...warehouseContextClient,
    ...pricingClient,
    ...priceListContextClient,
    ...salesClient,
    ...suppliersClient,
    ...purchaseOrdersClient,
    ...purchaseReceiptsClient,
    ...dashboardClient,
    ...systemClient,
    ...realtimeClient,
  };
}

export type AuthClient = ReturnType<typeof createAuthClient>;
