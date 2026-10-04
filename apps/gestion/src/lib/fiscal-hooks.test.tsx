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

describe('Fiscal settings client context', () => {
  it('does not query configuration without permission', () => {
    renderHook(() => hooks.useFiscalSettings(false), { wrapper: Wrapper });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('uses scoped PUT and invalidates only that company configuration', async () => {
    fetcher.mockResolvedValue({ settings: { revision: 1 } });
    const invalidation = vi.spyOn(client, 'invalidateQueries');
    const view = renderHook(() => hooks.useSaveFiscalSettings(), { wrapper: Wrapper });
    const values = { vatCondition: null, testPointOfSale: null, expectedRevision: 0 };
    await act(async () => {
      await view.result.current.mutateAsync(values);
    });
    expect(fetcher).toHaveBeenCalledWith('/fiscal/settings', {
      method: 'PUT',
      json: values,
      expectedCompanyId: 'a',
    });
    expect(invalidation).toHaveBeenCalledExactlyOnceWith({
      queryKey: ['company', 'a', 'fiscal', 'settings'],
    });
  });
  it('rejects a stale public probe before sending and sends an empty payload when current', async () => {
    fetcher.mockResolvedValue({ status: 'AVAILABLE' });
    const view = renderHook(() => hooks.useCheckFiscalConnectivity(), { wrapper: Wrapper });
    company = 'b';
    await act(async () => {
      await expect(view.result.current.mutateAsync()).rejects.toThrow('La empresa cambió');
    });
    expect(fetcher).not.toHaveBeenCalled();
    company = 'a';
    view.rerender();
    await act(async () => {
      await view.result.current.mutateAsync();
    });
    expect(fetcher).toHaveBeenCalledWith('/fiscal/settings/connectivity', {
      json: {},
      expectedCompanyId: 'a',
    });
  });
});

describe('Homologation authorization client safety', () => {
  const authorizationInput = {
    expectedRevision: 4,
    confirmHomologation: true as const,
    exclusivePointOfSale: true as const,
  };
  it('never retries issuance even when global mutation defaults enable retries', async () => {
    client.setDefaultOptions({ mutations: { retry: 3, retryDelay: 0 } });
    fetcher.mockRejectedValue(new Error('Network interrupted after send'));
    const invalidation = vi.spyOn(client, 'invalidateQueries');
    const view = renderHook(() => hooks.useAuthorizeFiscalDraft(), { wrapper: Wrapper });
    await act(async () => {
      await expect(
        view.result.current.mutateAsync({ draftId: 'draft', input: authorizationInput }),
      ).rejects.toThrow('Network interrupted');
    });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/fiscal/drafts/draft/authorize', {
      json: authorizationInput,
      expectedCompanyId: 'a',
    });
    expect(invalidation).toHaveBeenCalledExactlyOnceWith({ queryKey: ['company', 'a', 'fiscal'] });
  });
  it('invalidates the original company after a late failed request, not the selected company', async () => {
    let reject!: (error: Error) => void;
    fetcher.mockImplementation(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    const invalidation = vi.spyOn(client, 'invalidateQueries');
    const view = renderHook(() => hooks.useAuthorizeFiscalDraft(), { wrapper: Wrapper });
    let pending!: Promise<unknown>;
    act(() => {
      pending = view.result.current
        .mutateAsync({ draftId: 'draft', input: authorizationInput })
        .catch((error) => error);
    });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    company = 'b';
    view.rerender();
    await act(async () => {
      reject(new Error('Timeout'));
      await pending;
    });
    expect(invalidation).toHaveBeenCalledExactlyOnceWith({ queryKey: ['company', 'a', 'fiscal'] });
  });
  it('blocks stale authorization before any network request', async () => {
    const view = renderHook(() => hooks.useAuthorizeFiscalDraft(), { wrapper: Wrapper });
    company = 'b';
    await act(async () => {
      await expect(
        view.result.current.mutateAsync({ draftId: 'draft', input: authorizationInput }),
      ).rejects.toThrow('La empresa cambió');
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('queries only scoped persisted state and clears the old result after switching company', async () => {
    fetcher.mockResolvedValueOnce({ authorization: { id: 'old-attempt', status: 'UNKNOWN' } });
    const view = renderHook(() => hooks.useFiscalAuthorization('draft'), { wrapper: Wrapper });
    await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/fiscal/drafts/draft/authorization', {
      expectedCompanyId: 'a',
    });
    fetcher.mockImplementation(() => new Promise(() => {}));
    company = 'b';
    view.rerender();
    expect(view.result.current.data).toBeUndefined();
  });
  it('does not query authorization without permission or a draft', () => {
    renderHook(() => hooks.useFiscalAuthorization('draft', false), { wrapper: Wrapper });
    renderHook(() => hooks.useFiscalAuthorization(null), { wrapper: Wrapper });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('reconciles explicitly with an empty body, no retries, and refreshes after failure', async () => {
    client.setDefaultOptions({ mutations: { retry: 2, retryDelay: 0 } });
    fetcher.mockRejectedValue(new Error('Consultation failed'));
    const invalidation = vi.spyOn(client, 'invalidateQueries');
    const view = renderHook(() => hooks.useReconcileFiscalAuthorization(), { wrapper: Wrapper });
    expect(fetcher).not.toHaveBeenCalled();
    await act(async () => {
      await expect(view.result.current.mutateAsync('attempt')).rejects.toThrow('Consultation failed');
    });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/fiscal/authorizations/attempt/reconcile', {
      json: {},
      expectedCompanyId: 'a',
    });
    expect(invalidation).toHaveBeenCalledExactlyOnceWith({ queryKey: ['company', 'a', 'fiscal'] });
  });
  it('sends no credential material when manually checking authentication and rejects a stale check', async () => {
    fetcher.mockResolvedValue({ status: 'UNAVAILABLE' });
    const view = renderHook(() => hooks.useCheckFiscalAuthentication(), { wrapper: Wrapper });
    expect(fetcher).not.toHaveBeenCalled();
    await act(async () => {
      await view.result.current.mutateAsync();
    });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/fiscal/settings/authentication', {
      json: {},
      expectedCompanyId: 'a',
    });
    company = 'b';
    await act(async () => {
      await expect(view.result.current.mutateAsync()).rejects.toThrow('La empresa cambió');
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
