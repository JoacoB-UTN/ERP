'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  FiscalDraftInput,
  SaveFiscalDraftInput,
  FiscalDraftResponse,
  FiscalDraftForSaleResponse,
  FiscalDraftsResponse,
  FiscalSourceResponse,
  FiscalPreviewResponse,
  SalesListResponse,
} from '@erp/shared';
import type { ApiFetchOptions } from './api-client';

interface FiscalClientConfig {
  apiFetch: <T>(path: string, options?: ApiFetchOptions) => Promise<T>;
  useActiveCompanyId: () => string | null;
  getActiveCompanyId: () => string | null;
}

export function createFiscalClient({ apiFetch, useActiveCompanyId, getActiveCompanyId }: FiscalClientConfig) {
  function assertCompany(id: string | null): asserts id is string {
    if (!id || getActiveCompanyId() !== id)
      throw new Error('La empresa cambió. Volvé a abrir el formulario.');
  }
  function useFiscalQuery<T>(key: readonly unknown[], path: string, enabled: boolean) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'fiscal', ...key],
      queryFn: () => {
        assertCompany(companyId);
        return apiFetch<T>(path, { expectedCompanyId: companyId });
      },
      enabled: !!companyId && enabled,
    });
  }
  function useFiscalSales(page = 1, enabled = true) {
    return useFiscalQuery<SalesListResponse>(
      ['sales', page],
      `/sales?status=CONFIRMED&page=${page}&pageSize=25`,
      enabled,
    );
  }
  function useFiscalDrafts(page = 1, enabled = true) {
    return useFiscalQuery<FiscalDraftsResponse>(
      ['drafts', page],
      `/fiscal/drafts?page=${page}&pageSize=25`,
      enabled,
    );
  }
  function useFiscalSource(saleId: string | null, enabled = true) {
    return useFiscalQuery<FiscalSourceResponse>(
      ['source', saleId],
      `/fiscal/sales/${saleId}/source`,
      !!saleId && enabled,
    );
  }
  function useFiscalDraftForSale(saleId: string | null, enabled = true) {
    return useFiscalQuery<FiscalDraftForSaleResponse>(
      ['sale-draft', saleId],
      `/fiscal/sales/${saleId}/draft`,
      !!saleId && enabled,
    );
  }
  function useFiscalDraft(id: string | null, enabled = true) {
    return useFiscalQuery<FiscalDraftResponse>(['draft', id], `/fiscal/drafts/${id}`, !!id && enabled);
  }
  function usePreviewFiscalDraft() {
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: ({ saleId, input }: { saleId: string; input: FiscalDraftInput }) => {
        assertCompany(companyId);
        return apiFetch<FiscalPreviewResponse>(`/fiscal/sales/${saleId}/preview`, {
          json: input,
          expectedCompanyId: companyId,
        });
      },
    });
  }
  function useSaveFiscalDraft() {
    const companyId = useActiveCompanyId();
    const client = useQueryClient();
    return useMutation({
      mutationFn: ({ saleId, input }: { saleId: string; input: SaveFiscalDraftInput }) => {
        assertCompany(companyId);
        return apiFetch<FiscalDraftResponse>(`/fiscal/sales/${saleId}/draft`, {
          json: input,
          expectedCompanyId: companyId,
        });
      },
      onSuccess: () => {
        void client.invalidateQueries({ queryKey: ['company', companyId, 'fiscal'] });
      },
    });
  }
  return {
    useFiscalSales,
    useFiscalDrafts,
    useFiscalSource,
    useFiscalDraftForSale,
    useFiscalDraft,
    usePreviewFiscalDraft,
    useSaveFiscalDraft,
  };
}
