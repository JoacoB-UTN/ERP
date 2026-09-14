'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { keepPreviousCompanyData } from './company-scoped-placeholder';
import type {
  CreateCustomerCollectionInput,
  CreateSupplierPaymentInput,
  CustomerAccountListQuery,
  CustomerAccountListResponse,
  CustomerCollectionDetailResponse,
  CustomerCollectionListQuery,
  CustomerCollectionListResponse,
  CustomerOpenSalesResponse,
  CustomerStatementResponse,
  SupplierAccountListQuery,
  SupplierAccountListResponse,
  SupplierOpenReceiptsResponse,
  SupplierPaymentDetailResponse,
  SupplierPaymentListQuery,
  SupplierPaymentListResponse,
  SupplierStatementResponse,
  UpdateCustomerCollectionInput,
  UpdateSupplierPaymentInput,
} from '@erp/shared';
import type { ApiFetchOptions } from './api-client';

interface AccountsClientConfig {
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
 * Current accounts, collections and supplier payments — see
 * docs/current-accounts.md.
 *
 * Confirming or cancelling a collection or a payment posts to the ledger, so
 * those mutations invalidate the ACCOUNT reads too, not just their own list:
 * a balance left on screen after the movement that changed it is worse than a
 * spinner. The same is true in the other direction — confirming a sale or a
 * goods receipt moves an account balance — but that lives with those modules'
 * own hooks and with the realtime invalidation.
 */
export function createAccountsClient(config: AccountsClientConfig) {
  const { apiFetch, useActiveCompanyId } = config;

  function invalidateReceivables(queryClient: QueryClient, companyId: string | null) {
    void queryClient.invalidateQueries({ queryKey: ['company', companyId, 'customer-accounts'] });
    void queryClient.invalidateQueries({ queryKey: ['company', companyId, 'customer-collections'] });
    // A collection pays down sales, so their outstanding changes too.
    void queryClient.invalidateQueries({ queryKey: ['company', companyId, 'sales'] });
  }

  function invalidatePayables(queryClient: QueryClient, companyId: string | null) {
    void queryClient.invalidateQueries({ queryKey: ['company', companyId, 'supplier-accounts'] });
    void queryClient.invalidateQueries({ queryKey: ['company', companyId, 'supplier-payments'] });
    void queryClient.invalidateQueries({ queryKey: ['company', companyId, 'purchase-receipts'] });
  }

  // ---------- Customer accounts (receivable) ----------

  function useCustomerAccounts(query: Partial<CustomerAccountListQuery>) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'customer-accounts', query],
      queryFn: () =>
        apiFetch<CustomerAccountListResponse>(
          `/customer-accounts${buildQueryString({
            search: query.search,
            page: query.page,
            pageSize: query.pageSize,
          })}`,
        ),
      enabled: !!companyId,
      placeholderData: keepPreviousCompanyData(companyId),
    });
  }

  /**
   * A statement is always per currency — there is no such thing as a single
   * balance across currencies (see docs/current-accounts.md) — so the query
   * stays disabled until one is chosen rather than guessing.
   */
  function useCustomerStatement(
    customerId: string | null,
    currencyId: string | null,
    range?: { dateFrom?: string; dateTo?: string },
  ) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'customer-accounts', customerId, 'statement', currencyId, range],
      queryFn: () =>
        apiFetch<CustomerStatementResponse>(
          `/customer-accounts/${customerId}/statement${buildQueryString({
            currencyId: currencyId ?? undefined,
            dateFrom: range?.dateFrom,
            dateTo: range?.dateTo,
          })}`,
        ),
      enabled: !!companyId && !!customerId && !!currencyId,
    });
  }

  function useCustomerOpenSales(customerId: string | null, currencyId: string | null) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'customer-accounts', customerId, 'open-sales', currencyId],
      queryFn: () =>
        apiFetch<CustomerOpenSalesResponse>(
          `/customer-accounts/${customerId}/open-sales${buildQueryString({
            currencyId: currencyId ?? undefined,
          })}`,
        ),
      enabled: !!companyId && !!customerId && !!currencyId,
    });
  }

  // ---------- Customer collections (cobros) ----------

  function useCustomerCollections(query: Partial<CustomerCollectionListQuery>) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'customer-collections', query],
      queryFn: () =>
        apiFetch<CustomerCollectionListResponse>(
          `/customer-collections${buildQueryString({
            search: query.search,
            status: query.status,
            customerId: query.customerId,
            page: query.page,
            pageSize: query.pageSize,
          })}`,
        ),
      enabled: !!companyId,
      placeholderData: keepPreviousCompanyData(companyId),
    });
  }

  function useCustomerCollection(id: string | null) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'customer-collections', id],
      queryFn: () => apiFetch<CustomerCollectionDetailResponse>(`/customer-collections/${id}`),
      enabled: !!companyId && !!id,
    });
  }

  function useCreateCustomerCollection() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: (input: CreateCustomerCollectionInput) =>
        apiFetch<CustomerCollectionDetailResponse>('/customer-collections', { json: input }),
      onSuccess: () => invalidateReceivables(queryClient, companyId),
    });
  }

  function useUpdateCustomerCollection() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: ({ id, input }: { id: string; input: UpdateCustomerCollectionInput }) =>
        apiFetch<CustomerCollectionDetailResponse>(`/customer-collections/${id}`, {
          method: 'PATCH',
          json: input,
        }),
      onSuccess: () => invalidateReceivables(queryClient, companyId),
    });
  }

  function useConfirmCustomerCollection() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: (id: string) =>
        apiFetch<CustomerCollectionDetailResponse>(`/customer-collections/${id}/confirm`, {
          method: 'POST',
        }),
      onSuccess: () => invalidateReceivables(queryClient, companyId),
    });
  }

  function useCancelCustomerCollection() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
        apiFetch<CustomerCollectionDetailResponse>(`/customer-collections/${id}/cancel`, {
          method: 'POST',
          json: { reason },
        }),
      onSuccess: () => invalidateReceivables(queryClient, companyId),
    });
  }

  // ---------- Supplier accounts (payable) ----------

  function useSupplierAccounts(query: Partial<SupplierAccountListQuery>) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'supplier-accounts', query],
      queryFn: () =>
        apiFetch<SupplierAccountListResponse>(
          `/supplier-accounts${buildQueryString({
            search: query.search,
            page: query.page,
            pageSize: query.pageSize,
          })}`,
        ),
      enabled: !!companyId,
      placeholderData: keepPreviousCompanyData(companyId),
    });
  }

  function useSupplierStatement(
    supplierId: string | null,
    currencyId: string | null,
    range?: { dateFrom?: string; dateTo?: string },
  ) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'supplier-accounts', supplierId, 'statement', currencyId, range],
      queryFn: () =>
        apiFetch<SupplierStatementResponse>(
          `/supplier-accounts/${supplierId}/statement${buildQueryString({
            currencyId: currencyId ?? undefined,
            dateFrom: range?.dateFrom,
            dateTo: range?.dateTo,
          })}`,
        ),
      enabled: !!companyId && !!supplierId && !!currencyId,
    });
  }

  function useSupplierOpenReceipts(supplierId: string | null, currencyId: string | null) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'supplier-accounts', supplierId, 'open-receipts', currencyId],
      queryFn: () =>
        apiFetch<SupplierOpenReceiptsResponse>(
          `/supplier-accounts/${supplierId}/open-receipts${buildQueryString({
            currencyId: currencyId ?? undefined,
          })}`,
        ),
      enabled: !!companyId && !!supplierId && !!currencyId,
    });
  }

  // ---------- Supplier payments (pagos) ----------

  function useSupplierPayments(query: Partial<SupplierPaymentListQuery>) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'supplier-payments', query],
      queryFn: () =>
        apiFetch<SupplierPaymentListResponse>(
          `/supplier-payments${buildQueryString({
            search: query.search,
            status: query.status,
            supplierId: query.supplierId,
            page: query.page,
            pageSize: query.pageSize,
          })}`,
        ),
      enabled: !!companyId,
      placeholderData: keepPreviousCompanyData(companyId),
    });
  }

  function useSupplierPayment(id: string | null) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'supplier-payments', id],
      queryFn: () => apiFetch<SupplierPaymentDetailResponse>(`/supplier-payments/${id}`),
      enabled: !!companyId && !!id,
    });
  }

  function useCreateSupplierPayment() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: (input: CreateSupplierPaymentInput) =>
        apiFetch<SupplierPaymentDetailResponse>('/supplier-payments', { json: input }),
      onSuccess: () => invalidatePayables(queryClient, companyId),
    });
  }

  function useUpdateSupplierPayment() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: ({ id, input }: { id: string; input: UpdateSupplierPaymentInput }) =>
        apiFetch<SupplierPaymentDetailResponse>(`/supplier-payments/${id}`, {
          method: 'PATCH',
          json: input,
        }),
      onSuccess: () => invalidatePayables(queryClient, companyId),
    });
  }

  function useConfirmSupplierPayment() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: (id: string) =>
        apiFetch<SupplierPaymentDetailResponse>(`/supplier-payments/${id}/confirm`, { method: 'POST' }),
      onSuccess: () => invalidatePayables(queryClient, companyId),
    });
  }

  function useCancelSupplierPayment() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
        apiFetch<SupplierPaymentDetailResponse>(`/supplier-payments/${id}/cancel`, {
          method: 'POST',
          json: { reason },
        }),
      onSuccess: () => invalidatePayables(queryClient, companyId),
    });
  }

  return {
    useCustomerAccounts,
    useCustomerStatement,
    useCustomerOpenSales,
    useCustomerCollections,
    useCustomerCollection,
    useCreateCustomerCollection,
    useUpdateCustomerCollection,
    useConfirmCustomerCollection,
    useCancelCustomerCollection,
    useSupplierAccounts,
    useSupplierStatement,
    useSupplierOpenReceipts,
    useSupplierPayments,
    useSupplierPayment,
    useCreateSupplierPayment,
    useUpdateSupplierPayment,
    useConfirmSupplierPayment,
    useCancelSupplierPayment,
  };
}
