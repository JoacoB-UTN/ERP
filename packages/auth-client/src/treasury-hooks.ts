'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CurrenciesResponse,
  TreasuryAccountsQuery,
  TreasuryAccountsResponse,
  TreasuryAccountDetailResponse,
  TreasuryStatementQuery,
  TreasuryStatementResponse,
  TreasuryTransfersQuery,
  TreasuryTransfersResponse,
  TreasuryTransferDetailResponse,
  CreateTreasuryAccountInput,
  UpdateTreasuryAccountInput,
  SetTreasuryOpeningBalanceInput,
  CreateTreasuryTransferInput,
  UpdateTreasuryTransferInput,
} from '@erp/shared';
import type { ApiFetchOptions } from './api-client';
import { keepPreviousCompanyData } from './company-scoped-placeholder';

interface TreasuryClientConfig {
  apiFetch: <T>(path: string, options?: ApiFetchOptions) => Promise<T>;
  useActiveCompanyId: () => string | null;
  getActiveCompanyId: () => string | null;
}

function queryString(filters: object) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    // z.coerce.boolean treats the string "false" as true.
    if (value !== undefined && value !== false && value !== '') params.set(key, String(value));
  }
  return params.size ? `?${params}` : '';
}

export function createTreasuryClient({
  apiFetch,
  useActiveCompanyId,
  getActiveCompanyId,
}: TreasuryClientConfig) {
  function assertCompany(companyId: string | null): asserts companyId is string {
    if (!companyId || getActiveCompanyId() !== companyId) {
      throw new Error('La empresa cambió. Volvé a abrir el formulario.');
    }
  }
  function useTreasuryQuery<T>(key: readonly unknown[], path: string, enabled: boolean, placeholder = false) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'treasury', ...key],
      queryFn: () => {
        assertCompany(companyId);
        return apiFetch<T>(path, { expectedCompanyId: companyId });
      },
      enabled: !!companyId && enabled,
      placeholderData: placeholder
        ? (previous, query) => keepPreviousCompanyData<typeof previous>(companyId)(previous, query)
        : undefined,
    });
  }
  function useTreasuryCurrencies() {
    return useTreasuryQuery<CurrenciesResponse>(['currencies'], '/treasury/accounts/currencies', true);
  }
  function useTreasuryAccounts(filters: Partial<TreasuryAccountsQuery> = {}, enabled = true) {
    return useTreasuryQuery<TreasuryAccountsResponse>(
      ['accounts', filters],
      `/treasury/accounts${queryString(filters)}`,
      enabled,
      true,
    );
  }
  function useTreasuryAccount(id: string | null, enabled = true) {
    return useTreasuryQuery<TreasuryAccountDetailResponse>(
      ['account', id],
      `/treasury/accounts/${id}`,
      !!id && enabled,
    );
  }
  function useTreasuryStatement(
    id: string | null,
    filters: Partial<TreasuryStatementQuery> = {},
    enabled = true,
  ) {
    return useTreasuryQuery<TreasuryStatementResponse>(
      ['account', id, 'statement', filters],
      `/treasury/accounts/${id}/statement${queryString(filters)}`,
      !!id && enabled,
    );
  }
  function useTreasuryTransfers(filters: Partial<TreasuryTransfersQuery> = {}, enabled = true) {
    return useTreasuryQuery<TreasuryTransfersResponse>(
      ['transfers', filters],
      `/treasury/transfers${queryString(filters)}`,
      enabled,
      true,
    );
  }
  function useTreasuryTransfer(id: string | null, enabled = true) {
    return useTreasuryQuery<TreasuryTransferDetailResponse>(
      ['transfer', id],
      `/treasury/transfers/${id}`,
      !!id && enabled,
    );
  }
  function useWrite<TInput, TResult>(
    request: (input: TInput, expectedCompanyId: string) => Promise<TResult>,
  ) {
    const companyId = useActiveCompanyId();
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (input: TInput) => {
        assertCompany(companyId);
        return request(input, companyId);
      },
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: ['company', companyId, 'treasury'] });
        // Keep the existing Cobros/Pagos options hook and its cache compatible.
        void queryClient.invalidateQueries({ queryKey: ['company', companyId, 'treasury-accounts'] });
      },
    });
  }
  function useCreateTreasuryAccount() {
    return useWrite((input: CreateTreasuryAccountInput, expectedCompanyId) =>
      apiFetch<TreasuryAccountDetailResponse>('/treasury/accounts', { json: input, expectedCompanyId }),
    );
  }
  function useUpdateTreasuryAccount() {
    return useWrite(({ id, input }: { id: string; input: UpdateTreasuryAccountInput }, expectedCompanyId) =>
      apiFetch<TreasuryAccountDetailResponse>(`/treasury/accounts/${id}`, {
        method: 'PATCH',
        json: input,
        expectedCompanyId,
      }),
    );
  }
  function useSetTreasuryOpeningBalance() {
    return useWrite(
      ({ id, input }: { id: string; input: SetTreasuryOpeningBalanceInput }, expectedCompanyId) =>
        apiFetch<TreasuryAccountDetailResponse>(`/treasury/accounts/${id}/opening-balance`, {
          json: input,
          expectedCompanyId,
        }),
    );
  }
  function useCreateTreasuryTransfer() {
    return useWrite((input: CreateTreasuryTransferInput, expectedCompanyId) =>
      apiFetch<TreasuryTransferDetailResponse>('/treasury/transfers', { json: input, expectedCompanyId }),
    );
  }
  function useUpdateTreasuryTransfer() {
    return useWrite(({ id, input }: { id: string; input: UpdateTreasuryTransferInput }, expectedCompanyId) =>
      apiFetch<TreasuryTransferDetailResponse>(`/treasury/transfers/${id}`, {
        method: 'PATCH',
        json: input,
        expectedCompanyId,
      }),
    );
  }
  function useConfirmTreasuryTransfer() {
    return useWrite((id: string, expectedCompanyId) =>
      apiFetch<TreasuryTransferDetailResponse>(`/treasury/transfers/${id}/confirm`, {
        method: 'POST',
        expectedCompanyId,
      }),
    );
  }
  function useCancelTreasuryTransfer() {
    return useWrite((id: string, expectedCompanyId) =>
      apiFetch<TreasuryTransferDetailResponse>(`/treasury/transfers/${id}/cancel`, {
        method: 'POST',
        expectedCompanyId,
      }),
    );
  }
  return {
    useTreasuryCurrencies,
    useTreasuryAccounts,
    useTreasuryAccount,
    useTreasuryStatement,
    useTreasuryTransfers,
    useTreasuryTransfer,
    useCreateTreasuryAccount,
    useUpdateTreasuryAccount,
    useSetTreasuryOpeningBalance,
    useCreateTreasuryTransfer,
    useUpdateTreasuryTransfer,
    useConfirmTreasuryTransfer,
    useCancelTreasuryTransfer,
  };
}
