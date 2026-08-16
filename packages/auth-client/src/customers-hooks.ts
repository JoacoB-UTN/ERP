'use client';

import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import type {
  CreateCustomerInput,
  UpdateCustomerInput,
  CustomerAddressInput,
  UpdateCustomerAddressInput,
  CustomerContactInput,
  UpdateCustomerContactInput,
  CreateCustomerCategoryInput,
  UpdateCustomerCategoryInput,
  CustomerListQuery,
  CustomerLookupQuery,
  CustomerListResponse,
  CustomerLookupResponse,
  CustomerDetailResponse,
  CustomerAddressResponse,
  CustomerContactResponse,
  CustomerCategoriesResponse,
  CustomerCategoryDetailResponse,
  AuditEntityHistoryResponse,
} from '@erp/shared';
import type { ApiFetchOptions } from './api-client';

interface CustomersClientConfig {
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
 * Customer master-data hooks — Gestión's /clientes today; the lookup hook
 * exists for a future fast Facturación customer selector, per CLAUDE.md's
 * "never duplicate Customer business logic between the two apps." Kept in
 * the shared package for that reason, same as createAdministrationClient.
 */
export function createCustomersClient(config: CustomersClientConfig) {
  const { apiFetch, useActiveCompanyId } = config;

  function invalidateCustomer(queryClient: ReturnType<typeof useQueryClient>, companyId: string | null, id?: string) {
    void queryClient.invalidateQueries({ queryKey: ['company', companyId, 'customers', 'list'] });
    void queryClient.invalidateQueries({ queryKey: ['company', companyId, 'customers', 'lookup'] });
    if (id) {
      void queryClient.invalidateQueries({ queryKey: ['company', companyId, 'customers', 'detail', id] });
    }
  }

  function useCustomers(filters: Partial<CustomerListQuery>) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'customers', 'list', filters],
      queryFn: () =>
        apiFetch<CustomerListResponse>(
          `/customers${buildQueryString({
            search: filters.search,
            status: filters.status,
            customerType: filters.customerType,
            taxCondition: filters.taxCondition,
            categoryId: filters.categoryId,
            province: filters.province,
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

  function useCustomer(id: string | null) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'customers', 'detail', id],
      queryFn: () => apiFetch<CustomerDetailResponse>(`/customers/${id}`),
      enabled: !!companyId && !!id,
    });
  }

  function useCustomerHistory(id: string | null, page = 1, pageSize = 25) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'customers', 'detail', id, 'history', page, pageSize],
      queryFn: () =>
        apiFetch<AuditEntityHistoryResponse>(`/customers/${id}/history${buildQueryString({ page, pageSize })}`),
      enabled: !!companyId && !!id,
      placeholderData: keepPreviousData,
    });
  }

  /** Lightweight ACTIVE-only search — for a future fast customer selector, not used by any screen yet. */
  function useCustomerLookup(query: CustomerLookupQuery, options?: { enabled?: boolean }) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'customers', 'lookup', query],
      queryFn: () =>
        apiFetch<CustomerLookupResponse>(
          `/customers/lookup${buildQueryString({ search: query.search, limit: query.limit })}`,
        ),
      enabled: !!companyId && (options?.enabled ?? true),
    });
  }

  function useCreateCustomer() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: (input: CreateCustomerInput) =>
        apiFetch<CustomerDetailResponse>('/customers', { json: input }),
      onSuccess: () => invalidateCustomer(queryClient, companyId),
    });
  }

  function useUpdateCustomer() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: ({ id, input }: { id: string; input: UpdateCustomerInput }) =>
        apiFetch<CustomerDetailResponse>(`/customers/${id}`, { method: 'PATCH', json: input }),
      onSuccess: (_data, variables) => invalidateCustomer(queryClient, companyId, variables.id),
    });
  }

  function useDeactivateCustomer() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: (id: string) =>
        apiFetch<CustomerDetailResponse>(`/customers/${id}/deactivate`, { method: 'POST' }),
      onSuccess: (_data, id) => invalidateCustomer(queryClient, companyId, id),
    });
  }

  function useReactivateCustomer() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: (id: string) =>
        apiFetch<CustomerDetailResponse>(`/customers/${id}/reactivate`, { method: 'POST' }),
      onSuccess: (_data, id) => invalidateCustomer(queryClient, companyId, id),
    });
  }

  function useAddCustomerAddress() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: ({ customerId, input }: { customerId: string; input: CustomerAddressInput }) =>
        apiFetch<CustomerAddressResponse>(`/customers/${customerId}/addresses`, { json: input }),
      onSuccess: (_data, variables) => invalidateCustomer(queryClient, companyId, variables.customerId),
    });
  }

  function useUpdateCustomerAddress() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: ({
        customerId,
        addressId,
        input,
      }: {
        customerId: string;
        addressId: string;
        input: UpdateCustomerAddressInput;
      }) =>
        apiFetch<CustomerAddressResponse>(`/customers/${customerId}/addresses/${addressId}`, {
          method: 'PATCH',
          json: input,
        }),
      onSuccess: (_data, variables) => invalidateCustomer(queryClient, companyId, variables.customerId),
    });
  }

  function useRemoveCustomerAddress() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: ({ customerId, addressId }: { customerId: string; addressId: string }) =>
        apiFetch<{ ok: true }>(`/customers/${customerId}/addresses/${addressId}`, { method: 'DELETE' }),
      onSuccess: (_data, variables) => invalidateCustomer(queryClient, companyId, variables.customerId),
    });
  }

  function useAddCustomerContact() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: ({ customerId, input }: { customerId: string; input: CustomerContactInput }) =>
        apiFetch<CustomerContactResponse>(`/customers/${customerId}/contacts`, { json: input }),
      onSuccess: (_data, variables) => invalidateCustomer(queryClient, companyId, variables.customerId),
    });
  }

  function useUpdateCustomerContact() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: ({
        customerId,
        contactId,
        input,
      }: {
        customerId: string;
        contactId: string;
        input: UpdateCustomerContactInput;
      }) =>
        apiFetch<CustomerContactResponse>(`/customers/${customerId}/contacts/${contactId}`, {
          method: 'PATCH',
          json: input,
        }),
      onSuccess: (_data, variables) => invalidateCustomer(queryClient, companyId, variables.customerId),
    });
  }

  function useRemoveCustomerContact() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: ({ customerId, contactId }: { customerId: string; contactId: string }) =>
        apiFetch<{ ok: true }>(`/customers/${customerId}/contacts/${contactId}`, { method: 'DELETE' }),
      onSuccess: (_data, variables) => invalidateCustomer(queryClient, companyId, variables.customerId),
    });
  }

  function useCustomerCategories() {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'customer-categories'],
      queryFn: () => apiFetch<CustomerCategoriesResponse>('/customer-categories'),
      enabled: !!companyId,
    });
  }

  function useCreateCustomerCategory() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: (input: CreateCustomerCategoryInput) =>
        apiFetch<CustomerCategoryDetailResponse>('/customer-categories', { json: input }),
      onSuccess: () =>
        void queryClient.invalidateQueries({ queryKey: ['company', companyId, 'customer-categories'] }),
    });
  }

  function useUpdateCustomerCategory() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: ({ id, input }: { id: string; input: UpdateCustomerCategoryInput }) =>
        apiFetch<CustomerCategoryDetailResponse>(`/customer-categories/${id}`, {
          method: 'PATCH',
          json: input,
        }),
      onSuccess: () =>
        void queryClient.invalidateQueries({ queryKey: ['company', companyId, 'customer-categories'] }),
    });
  }

  return {
    useCustomers,
    useCustomer,
    useCustomerHistory,
    useCustomerLookup,
    useCreateCustomer,
    useUpdateCustomer,
    useDeactivateCustomer,
    useReactivateCustomer,
    useAddCustomerAddress,
    useUpdateCustomerAddress,
    useRemoveCustomerAddress,
    useAddCustomerContact,
    useUpdateCustomerContact,
    useRemoveCustomerContact,
    useCustomerCategories,
    useCreateCustomerCategory,
    useUpdateCustomerCategory,
  };
}
