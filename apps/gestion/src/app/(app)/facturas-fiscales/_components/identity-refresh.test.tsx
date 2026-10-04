import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FiscalDraftDto } from '@erp/shared';
import { FiscalIdentityRefresh } from './identity-refresh';

const mock = vi.hoisted(() => ({
  company: 'a',
  permissions: new Set<string>(),
  query: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('@/lib/auth-client', () => ({
  authClient: { companyContextStore: { getActiveCompanyId: () => mock.company } },
  useActiveCompany: () => ({ activeCompanyId: mock.company }),
  usePermissions: () => ({ isLoading: false, can: (permission: string) => mock.permissions.has(permission) }),
  useFiscalAuthorization: (...args: unknown[]) => mock.query(...args),
  useRefreshFiscalIdentity: () => ({ mutateAsync: mock.refresh }),
}));
const draft = {
  id: 'draft',
  revision: 3,
  source: {
    saleId: 'sale',
    issuer: { legalName: 'Emisor guardado', taxId: '20123456786' },
    recipient: { legalName: 'Receptor guardado', taxId: null, taxCondition: 'UNKNOWN' },
  },
} as FiscalDraftDto;
const updated = {
  ...draft,
  revision: 4,
  source: {
    ...draft.source,
    recipient: { legalName: 'Receptor corregido', taxId: '20123456786', taxCondition: 'MONOTRIBUTO' },
  },
};
const state = (authorization: unknown = null) => ({
  data: { authorization },
  isError: false,
  isPending: false,
  isFetching: false,
});
beforeEach(() => {
  mock.company = 'a';
  mock.permissions = new Set(['sales.invoices.read', 'sales.invoices.create', 'sales.documents.read']);
  mock.query.mockReset().mockReturnValue(state());
  mock.refresh.mockReset().mockResolvedValue({ draft: updated });
});
afterEach(cleanup);

it('shows frozen identity and requires an explicit confirmation before sending the strict revision input once', async () => {
  let resolve!: (value: unknown) => void;
  mock.refresh.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const onRefreshed = vi.fn();
  const onBusyChange = vi.fn();
  render(
    <FiscalIdentityRefresh draft={draft} available onRefreshed={onRefreshed} onBusyChange={onBusyChange} />,
  );
  expect(screen.getByText(/Emisor: Emisor guardado/)).toBeTruthy();
  expect(screen.getByText(/Receptor: Receptor guardado · CUIT: Sin informar/)).toBeTruthy();
  expect(screen.getByText(/Condición de IVA del receptor/)).toBeTruthy();
  const button = screen.getByRole('button', { name: 'Actualizar datos fiscales del borrador' });
  fireEvent.click(button);
  expect(mock.refresh).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(button);
  fireEvent.click(button);
  expect(mock.refresh).toHaveBeenCalledTimes(1);
  expect(mock.refresh).toHaveBeenCalledWith({
    draftId: 'draft',
    input: { expectedRevision: 3, confirmIdentityRefresh: true },
  });
  expect(onBusyChange).toHaveBeenCalledWith(true);
  await act(async () => resolve({ draft: updated }));
  expect(onRefreshed).toHaveBeenCalledWith(updated);
  expect(onBusyChange).toHaveBeenLastCalledWith(false);
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  expect(screen.getByRole('link', { name: 'Revisar clase e IVA' }).getAttribute('href')).toBe(
    '/facturas-fiscales/preparar/sale',
  );
});

it.each(['sales.invoices.create', 'sales.documents.read'])(
  'keeps identity read-only without %s',
  (permission) => {
    mock.permissions.delete(permission);
    render(<FiscalIdentityRefresh draft={draft} available onRefreshed={vi.fn()} onBusyChange={vi.fn()} />);
    expect(screen.getByText(/Emisor: Emisor guardado/)).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(mock.query).toHaveBeenCalledWith('draft', true);
  },
);

it('neither displays nor queries identity without invoice-read permission', () => {
  mock.permissions.delete('sales.invoices.read');
  render(<FiscalIdentityRefresh draft={draft} available onRefreshed={vi.fn()} onBusyChange={vi.fn()} />);
  expect(screen.queryByRole('heading')).toBeNull();
  expect(mock.query).toHaveBeenCalledWith('draft', false);
});

it.each(['SENDING', 'UNKNOWN', 'AUTHORIZED', 'REJECTED'])(
  'does not refresh after any prior attempt, including %s',
  (status) => {
    mock.query.mockReturnValue(state({ status }));
    render(<FiscalIdentityRefresh draft={draft} available onRefreshed={vi.fn()} onBusyChange={vi.fn()} />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByText(/ya tiene un intento de autorización/)).toBeTruthy();
    expect(mock.refresh).not.toHaveBeenCalled();
  },
);

it.each([{ isError: true }, { isFetching: true }, { isPending: true }, { data: undefined }, { data: {} }])(
  'requires a current, explicitly empty authorization query (%j)',
  (change) => {
    mock.query.mockReturnValue({ ...state(), ...change });
    render(<FiscalIdentityRefresh draft={draft} available onRefreshed={vi.fn()} onBusyChange={vi.fn()} />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(mock.refresh).not.toHaveBeenCalled();
  },
);

it('blocks a cached draft while its outer query is being verified', () => {
  render(
    <FiscalIdentityRefresh draft={draft} available={false} onRefreshed={vi.fn()} onBusyChange={vi.fn()} />,
  );
  const button = screen.getByRole('button', { name: 'Actualizar datos fiscales del borrador' });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(button);
  expect(mock.refresh).not.toHaveBeenCalled();
});

it('latches a failed mutation until reload and never silently retries', async () => {
  mock.refresh.mockRejectedValue(new Error('La revisión cambió'));
  render(<FiscalIdentityRefresh draft={draft} available onRefreshed={vi.fn()} onBusyChange={vi.fn()} />);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar datos fiscales del borrador' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar datos fiscales del borrador' }));
  expect(mock.refresh).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Recargar datos fiscales' })).toBeTruthy();
});

it.each([{ id: 'other' }, { revision: 3 }, { source: { ...updated.source, saleId: 'other-sale' } }])(
  'refuses a mismatched response (%j)',
  async (change) => {
    mock.refresh.mockResolvedValue({ draft: { ...updated, ...change } });
    const onRefreshed = vi.fn();
    render(
      <FiscalIdentityRefresh draft={draft} available onRefreshed={onRefreshed} onBusyChange={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar datos fiscales del borrador' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(onRefreshed).not.toHaveBeenCalled();
  },
);

it('rejects a late response after switching company', async () => {
  let resolve!: (value: unknown) => void;
  mock.refresh.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const onRefreshed = vi.fn();
  const onBusyChange = vi.fn();
  render(
    <FiscalIdentityRefresh draft={draft} available onRefreshed={onRefreshed} onBusyChange={onBusyChange} />,
  );
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar datos fiscales del borrador' }));
  mock.company = 'b';
  await act(async () => resolve({ draft: updated }));
  expect(onRefreshed).not.toHaveBeenCalled();
  expect(onBusyChange).toHaveBeenCalledTimes(1);
});

it('clears confirmation when a newer revision or another company is displayed', () => {
  const view = render(
    <FiscalIdentityRefresh draft={draft} available onRefreshed={vi.fn()} onBusyChange={vi.fn()} />,
  );
  fireEvent.click(screen.getByRole('checkbox'));
  view.rerender(
    <FiscalIdentityRefresh draft={updated} available onRefreshed={vi.fn()} onBusyChange={vi.fn()} />,
  );
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByRole('checkbox'));
  mock.company = 'b';
  view.rerender(
    <FiscalIdentityRefresh draft={updated} available onRefreshed={vi.fn()} onBusyChange={vi.fn()} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar datos fiscales del borrador' }));
  expect(mock.refresh).not.toHaveBeenCalled();
});

it('rejects an invalid displayed revision through the shared strict schema', async () => {
  render(
    <FiscalIdentityRefresh
      draft={{ ...draft, revision: 0 }}
      available
      onRefreshed={vi.fn()}
      onBusyChange={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar datos fiscales del borrador' }));
  await waitFor(() => expect(mock.refresh).not.toHaveBeenCalled());
});
