import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createApiClient } from '../../../../../../../packages/auth-client/src/api-client';
import { COMPANY_ID_HEADER, BRANCH_ID_HEADER } from '@erp/shared';
import { createTreasuryClient } from '../../../../../../../packages/auth-client/src/treasury-hooks';

let company: string | null;
let client: QueryClient;
const fetcher = vi.fn();
const hooks = createTreasuryClient({
  apiFetch: fetcher,
  useActiveCompanyId: () => company,
  getActiveCompanyId: () => company,
});
function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  company = 'a';
  fetcher.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.unstubAllGlobals();
});

describe('Treasury company-scoped API hooks', () => {
  it('omits false includeInactive but sends true explicitly', async () => {
    fetcher.mockResolvedValue({ accounts: [] });
    const view = renderHook(({ includeInactive }) => hooks.useTreasuryAccounts({ includeInactive }), {
      initialProps: { includeInactive: false },
      wrapper: Wrapper,
    });
    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith('/treasury/accounts', { expectedCompanyId: 'a' }),
    );
    view.rerender({ includeInactive: true });
    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith('/treasury/accounts?includeInactive=true', {
        expectedCompanyId: 'a',
      }),
    );
  });
  it('keeps same-company placeholder during filtering but never across companies', async () => {
    fetcher.mockResolvedValueOnce({ accounts: [{ id: 'a-account' }] });
    const view = renderHook(({ includeInactive }) => hooks.useTreasuryAccounts({ includeInactive }), {
      initialProps: { includeInactive: false },
      wrapper: Wrapper,
    });
    await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
    fetcher.mockImplementation(() => new Promise(() => {}));
    view.rerender({ includeInactive: true });
    expect(view.result.current.data?.accounts[0].id).toBe('a-account');
    company = 'b';
    view.rerender({ includeInactive: true });
    expect(view.result.current.data).toBeUndefined();
    expect(
      client
        .getQueryCache()
        .find({ queryKey: ['company', 'b', 'treasury', 'accounts', { includeInactive: true }] }),
    ).toBeTruthy();
  });
  it('does not request unauthorized statement or requests without company', () => {
    renderHook(() => hooks.useTreasuryStatement('id', {}, false), { wrapper: Wrapper });
    company = null;
    renderHook(() => hooks.useTreasuryAccounts(), { wrapper: Wrapper });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects an old mutation closure after company changed', async () => {
    const { result } = renderHook(() => hooks.useCreateTreasuryTransfer(), { wrapper: Wrapper });
    company = 'b';
    await act(async () => {
      await expect(
        result.current.mutateAsync({ sourceAccountId: 'a1', destinationAccountId: 'a2', amount: '1.00' }),
      ).rejects.toThrow('La empresa cambió');
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('invalidates Treasury balances, statements and legacy account options only for originating company', async () => {
    fetcher.mockResolvedValue({ transfer: { id: 't' } });
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => hooks.useConfirmTreasuryTransfer(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync('t');
    });
    expect(fetcher).toHaveBeenCalledWith('/treasury/transfers/t/confirm', {
      method: 'POST',
      expectedCompanyId: 'a',
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['company', 'a', 'treasury'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['company', 'a', 'treasury-accounts'] });
    expect(spy).toHaveBeenCalledTimes(2);
  });
  it('reads currencies from Treasury without the Pricing endpoint', async () => {
    fetcher.mockResolvedValue({ currencies: [] });
    renderHook(() => hooks.useTreasuryCurrencies(), { wrapper: Wrapper });
    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith('/treasury/accounts/currencies', { expectedCompanyId: 'a' }),
    );
  });
  it('sends patch clearable fields and opening amounts unchanged', async () => {
    fetcher.mockResolvedValue({ account: {} });
    const update = renderHook(() => hooks.useUpdateTreasuryAccount(), { wrapper: Wrapper });
    await act(async () => {
      await update.result.current.mutateAsync({ id: 'account', input: { alias: null, active: false } });
    });
    expect(fetcher).toHaveBeenCalledWith('/treasury/accounts/account', {
      expectedCompanyId: 'a',
      method: 'PATCH',
      json: { alias: null, active: false },
    });
    const opening = renderHook(() => hooks.useSetTreasuryOpeningBalance(), { wrapper: Wrapper });
    await act(async () => {
      await opening.result.current.mutateAsync({
        id: 'account',
        input: { amount: '-9007199254740993.1234' },
      });
    });
    expect(fetcher).toHaveBeenCalledWith('/treasury/accounts/account/opening-balance', {
      expectedCompanyId: 'a',
      json: { amount: '-9007199254740993.1234' },
    });
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function realTreasury() {
  const api = createApiClient({ baseUrl: 'http://erp.test', storageKeyPrefix: 'treasury-retry-test' });
  api.companyContextStore.setActiveCompanyId('a');
  api.companyContextStore.setActiveBranchId('branch-a');
  const treasury = createTreasuryClient({
    apiFetch: api.apiFetch,
    useActiveCompanyId: () => 'a',
    getActiveCompanyId: api.companyContextStore.getActiveCompanyId,
  });
  return { ...api, treasury };
}

describe('Treasury real API client context binding across refresh', () => {
  it.each(['query', 'mutation'] as const)(
    'aborts %s retry when company changes during refresh',
    async (kind) => {
      const refresh = deferred<Response>();
      const network = vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 401 }))
        .mockImplementationOnce(() => refresh.promise)
        .mockResolvedValue(Response.json({ accounts: [{ id: 'company-b-account' }] }));
      vi.stubGlobal('fetch', network);
      const api = realTreasury();
      const query =
        kind === 'query' ? renderHook(() => api.treasury.useTreasuryAccounts(), { wrapper: Wrapper }) : null;
      const mutation =
        kind === 'mutation'
          ? renderHook(() => api.treasury.useCreateTreasuryAccount(), { wrapper: Wrapper })
          : null;
      let outcome: Promise<unknown> | undefined;
      if (mutation) {
        act(() => {
          outcome = mutation.result.current
            .mutateAsync({
              code: 'A',
              name: 'Account A',
              type: 'CASH_BOX',
              currencyId: 'ars',
              allowsNegativeBalance: false,
            })
            .catch((error) => error);
        });
      }
      await waitFor(() => expect(network).toHaveBeenCalledTimes(2));
      expect(network.mock.calls[1][0]).toBe('http://erp.test/auth/refresh');
      api.companyContextStore.setActiveCompanyId('b');
      api.companyContextStore.setActiveBranchId('branch-b');
      await act(async () => {
        refresh.resolve(new Response(null, { status: 200 }));
        if (outcome) await outcome;
      });
      if (query) await waitFor(() => expect(query.result.current.isError).toBe(true));
      if (mutation) await waitFor(() => expect(mutation.result.current.isError).toBe(true));
      expect(network).toHaveBeenCalledTimes(2);
      const originalHeaders = network.mock.calls[0][1].headers;
      expect(originalHeaders[COMPANY_ID_HEADER]).toBe('a');
      expect(originalHeaders[BRANCH_ID_HEADER]).toBe('branch-a');
      expect(client.getQueryData(['company', 'a', 'treasury', 'accounts', {}])).toBeUndefined();
      expect(api.companyContextStore.getActiveCompanyId()).toBe('b');
    },
  );
  it('retries normally with original company and branch when context did not change', async () => {
    const network = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(Response.json({ accounts: [] }));
    vi.stubGlobal('fetch', network);
    const api = realTreasury();
    const view = renderHook(() => api.treasury.useTreasuryAccounts(), { wrapper: Wrapper });
    await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
    expect(network).toHaveBeenCalledTimes(3);
    expect(network.mock.calls[2][1].headers).toMatchObject({
      [COMPANY_ID_HEADER]: 'a',
      [BRANCH_ID_HEADER]: 'branch-a',
    });
    expect(client.getQueryData(['company', 'a', 'treasury', 'accounts', {}])).toEqual({ accounts: [] });
  });
  it.each(['COMPANY_ACCESS_DENIED', 'COMPANY_INACTIVE'])('late %s for A does not clear B', async (code) => {
    const pending = deferred<Response>();
    const network = vi.fn().mockReturnValue(pending.promise);
    vi.stubGlobal('fetch', network);
    const api = realTreasury();
    const outcome = api.apiFetch('/treasury/accounts', { expectedCompanyId: 'a' }).catch((error) => error);
    api.companyContextStore.setActiveCompanyId('b');
    pending.resolve(Response.json({ error: { code, message: 'Denied' } }, { status: 403 }));
    expect(await outcome).toMatchObject({ code: 'COMPANY_CONTEXT_CHANGED' });
    expect(api.companyContextStore.getActiveCompanyId()).toBe('b');
  });
  it('rechecks company after asynchronous response parsing', async () => {
    const body = deferred<unknown>();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => body.promise }));
    const api = realTreasury();
    const outcome = api.apiFetch('/treasury/accounts', { expectedCompanyId: 'a' }).catch((error) => error);
    await Promise.resolve();
    await Promise.resolve();
    api.companyContextStore.setActiveCompanyId('b');
    body.resolve({ accounts: [] });
    expect(await outcome).toMatchObject({ code: 'COMPANY_CONTEXT_CHANGED' });
  });
  it('leaves callers without opt-in on their existing retry behavior', async () => {
    const refresh = deferred<Response>();
    const network = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockImplementationOnce(() => refresh.promise)
      .mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal('fetch', network);
    const api = realTreasury();
    const outcome = api.apiFetch('/legacy');
    await waitFor(() => expect(network).toHaveBeenCalledTimes(2));
    api.companyContextStore.setActiveCompanyId('b');
    refresh.resolve(new Response(null, { status: 200 }));
    await expect(outcome).resolves.toEqual({ ok: true });
    expect(network.mock.calls[2][1].headers[COMPANY_ID_HEADER]).toBe('b');
  });
});
