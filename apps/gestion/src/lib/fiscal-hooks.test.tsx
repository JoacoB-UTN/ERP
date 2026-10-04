import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createFiscalClient } from '../../../../packages/auth-client/src/fiscal-hooks';
import { createApiClient } from '../../../../packages/auth-client/src/api-client';

let company: string | null;
let client: QueryClient;
const fetcher = vi.fn();
const hooks = createFiscalClient({
  apiFetch: fetcher,
  useActiveCompanyId: () => company,
  getActiveCompanyId: () => company,
});
const input = {
  invoiceType: 'B' as const,
  amountInterpretation: 'FINAL_AMOUNTS_INCLUDE_VAT' as const,
  lines: [{ salesLineId: 'line', treatment: 'VAT_21' as const }],
  expectedRevision: 0,
};
function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  company = 'a';
  fetcher.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.unstubAllGlobals();
});

describe('Fiscal company binding', () => {
  it('does not retain old-company results after switching', async () => {
    fetcher.mockResolvedValueOnce({ items: [{ id: 'a-draft' }] });
    const view = renderHook(() => hooks.useFiscalDrafts(), { wrapper: Wrapper });
    await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
    expect(fetcher).toHaveBeenCalledWith('/fiscal/drafts?page=1&pageSize=25', { expectedCompanyId: 'a' });
    fetcher.mockImplementation(() => new Promise(() => {}));
    company = 'b';
    view.rerender();
    expect(view.result.current.data).toBeUndefined();
  });
  it('does not load a disabled source or without a company', () => {
    renderHook(() => hooks.useFiscalSource('sale', false), { wrapper: Wrapper });
    company = null;
    renderHook(() => hooks.useFiscalDrafts(), { wrapper: Wrapper });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects a stale save before sending it', async () => {
    const view = renderHook(() => hooks.useSaveFiscalDraft(), { wrapper: Wrapper });
    company = 'b';
    await act(async () => {
      await expect(view.result.current.mutateAsync({ saleId: 'sale', input })).rejects.toThrow(
        'La empresa cambió',
      );
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('invalidates only the originating company and transmits the expected revision', async () => {
    fetcher.mockResolvedValue({ draft: { id: 'draft' } });
    const invalidation = vi.spyOn(client, 'invalidateQueries');
    const view = renderHook(() => hooks.useSaveFiscalDraft(), { wrapper: Wrapper });
    await act(async () => {
      await view.result.current.mutateAsync({ saleId: 'sale', input });
    });
    expect(fetcher).toHaveBeenCalledWith('/fiscal/sales/sale/draft', { expectedCompanyId: 'a', json: input });
    expect(invalidation).toHaveBeenCalledExactlyOnceWith({ queryKey: ['company', 'a', 'fiscal'] });
  });
  it('aborts an authenticated retry if the company changes while refreshing', async () => {
    let resolveRefresh!: (response: Response) => void;
    const refresh = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    const network = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockImplementationOnce(() => refresh);
    vi.stubGlobal('fetch', network);
    const api = createApiClient({ baseUrl: 'http://erp.test', storageKeyPrefix: 'fiscal-test' });
    api.companyContextStore.setActiveCompanyId('a');
    const fiscal = createFiscalClient({
      apiFetch: api.apiFetch,
      useActiveCompanyId: () => 'a',
      getActiveCompanyId: api.companyContextStore.getActiveCompanyId,
    });
    const view = renderHook(() => fiscal.useSaveFiscalDraft(), { wrapper: Wrapper });
    let result!: Promise<unknown>;
    act(() => {
      result = view.result.current.mutateAsync({ saleId: 'sale', input }).catch((error: unknown) => error);
    });
    await waitFor(() => expect(network).toHaveBeenCalledTimes(2));
    api.companyContextStore.setActiveCompanyId('b');
    await act(async () => {
      resolveRefresh(Response.json({ ok: true }));
      await result;
    });
    expect(await result).toBeInstanceOf(Error);
    expect(network).toHaveBeenCalledTimes(2);
  });
});
