import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FiscalDraftDto } from '@erp/shared';
import { FiscalAuthorizationPanel } from './authorization';
vi.mock('./test-print', () => ({ FiscalTestPrint: () => null }));
vi.mock('./credit-note', () => ({ FiscalCreditNotePanel: () => <div>Credit note preparation</div> }));
const mock = vi.hoisted(() => ({
  company: 'a',
  write: true,
  query: vi.fn(),
  history: vi.fn(),
  historyRefetch: vi.fn(),
  send: vi.fn(),
  consult: vi.fn(),
}));
vi.mock('@/lib/auth-client', () => ({
  authClient: { companyContextStore: { getActiveCompanyId: () => mock.company } },
  useActiveCompany: () => ({ activeCompanyId: mock.company }),
  useFiscalAuthorizationHistory: (...args: unknown[]) => mock.history(...args),
  usePermissions: () => ({
    isLoading: false,
    can: (p: string) => p !== 'sales.invoices.create' || mock.write,
  }),
  useFiscalAuthorization: () => mock.query(),
  useAuthorizeFiscalDraft: () => ({ mutateAsync: mock.send }),
  useReconcileFiscalAuthorization: () => ({ mutateAsync: mock.consult }),
}));
const draft = { id: 'draft', revision: 3, source: { saleId: 'sale' } } as FiscalDraftDto;
const attempt = {
  id: 'attempt',
  status: 'AUTHORIZED',
  pointOfSale: 1,
  voucherType: 6,
  voucherNumber: 4,
  cae: '12345678901234',
  expiresAt: '20261020',
  message: 'Solo pruebas',
  updatedAt: '2026-10-04T12:00:00Z',
};
function setup(status?: string) {
  mock.query.mockReturnValue({
    data: { authorization: status ? { ...attempt, status } : null },
    isError: false,
    isPending: false,
    isFetching: false,
  });
}
function acknowledgements() {
  screen.getAllByRole('checkbox').forEach((e) => fireEvent.click(e));
}
beforeEach(() => {
  mock.company = 'a';
  mock.historyRefetch.mockReset();
  mock.history.mockReset().mockReturnValue({
    data: { items: [], latestAuthorizationId: null, pagination: { page: 1, pageSize: 25, total: 0 } },
    isError: false,
    isPending: false,
    isFetching: false,
    refetch: mock.historyRefetch,
  });
  mock.write = true;
  setup();
  mock.send.mockReset().mockResolvedValue({ authorization: attempt });
  mock.consult.mockReset().mockResolvedValue({ authorization: attempt });
});
afterEach(cleanup);
it('requires two explicit confirmations and sends the displayed revision only once', async () => {
  let resolve!: (value: unknown) => void;
  mock.send.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  render(<FiscalAuthorizationPanel draft={draft} canPrepare />);
  const button = screen.getByRole('button', { name: 'Autorizar comprobante de prueba' });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getAllByRole('checkbox')[0]);
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getAllByRole('checkbox')[1]);
  fireEvent.click(button);
  fireEvent.click(button);
  expect(mock.send).toHaveBeenCalledTimes(1);
  expect(mock.send).toHaveBeenCalledWith({
    draftId: 'draft',
    input: { expectedRevision: 3, confirmHomologation: true, exclusivePointOfSale: true },
  });
  await act(async () => resolve({ authorization: attempt }));
  expect(screen.getByText(/CAE de prueba: 12345678901234/)).toBeTruthy();
  expect(screen.queryByText('Continuar preparación')).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull();
});
it.each(['UNKNOWN', 'SENDING'])('offers only reconciliation for %s', async (status) => {
  setup(status);
  render(<FiscalAuthorizationPanel draft={draft} canPrepare />);
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByText('Continuar preparación')).toBeNull();
  expect(mock.consult).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Consultar resultado en ARCA' }));
  await waitFor(() => expect(mock.consult).toHaveBeenCalledWith('attempt'));
  expect(mock.send).not.toHaveBeenCalled();
});
it('does not allow a read-only operator to send or reconcile', () => {
  mock.write = false;
  setup('UNKNOWN');
  render(<FiscalAuthorizationPanel draft={draft} canPrepare={false} />);
  expect(screen.queryByRole('button', { name: /Guardar|Autorizar|Consultar resultado/ })).toBeNull();
  expect(screen.getByText('Resultado desconocido')).toBeTruthy();
});
it('discards a late result from the previous company', async () => {
  let resolve!: (value: unknown) => void;
  mock.send.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  render(<FiscalAuthorizationPanel draft={draft} canPrepare />);
  acknowledgements();
  fireEvent.click(screen.getByRole('button', { name: 'Autorizar comprobante de prueba' }));
  mock.company = 'b';
  await act(async () => resolve({ authorization: attempt }));
  expect(screen.queryByText('Autorizado en pruebas')).toBeNull();
});
it('blocks resend and requires reloading after a network error', async () => {
  mock.send.mockRejectedValue(new Error('Conexión interrumpida'));
  render(<FiscalAuthorizationPanel draft={draft} canPrepare />);
  acknowledgements();
  fireEvent.click(screen.getByRole('button', { name: 'Autorizar comprobante de prueba' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.getByRole('button', { name: 'Recargar estado' })).toBeTruthy();
  expect(mock.send).toHaveBeenCalledTimes(1);
});
it('requires fresh confirmations after a rejected attempt', () => {
  setup('REJECTED');
  render(<FiscalAuthorizationPanel draft={draft} canPrepare />);
  expect(
    (screen.getByRole('button', { name: 'Autorizar comprobante de prueba' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.getByText('Continuar preparación')).toBeTruthy();
});
it('blocks actions when a background query failed even with cached data', () => {
  mock.query.mockReturnValue({ data: { authorization: null }, isError: true });
  render(<FiscalAuthorizationPanel draft={draft} canPrepare />);
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByText('Continuar preparación')).toBeNull();
});

it('blocks sends while the outer draft is unavailable and preserves state until it is verified', () => {
  const view = render(<FiscalAuthorizationPanel draft={draft} canPrepare />);
  acknowledgements();
  view.rerender(<FiscalAuthorizationPanel draft={draft} canPrepare available={false} />);
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Autorizar comprobante de prueba' })).toBeNull();
  view.rerender(<FiscalAuthorizationPanel draft={draft} canPrepare available />);
  expect(
    (screen.getByRole('button', { name: 'Autorizar comprobante de prueba' }) as HTMLButtonElement).disabled,
  ).toBe(false);
  expect(mock.send).not.toHaveBeenCalled();
});

it('blocks reconciliation while the outer draft is unavailable', () => {
  setup('UNKNOWN');
  render(<FiscalAuthorizationPanel draft={draft} canPrepare available={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Consultar resultado en ARCA' }));
  expect(mock.consult).not.toHaveBeenCalled();
});

it('never derives send or reconciliation eligibility from an older history entry', () => {
  setup('UNKNOWN');
  mock.history.mockReturnValue({
    data: {
      items: [
        {
          ...attempt,
          id: 'old',
          status: 'REJECTED',
          createdAt: '2026-10-04T12:00:00Z',
          draftRevision: 1,
          message: 'Rechazo anterior',
        },
      ],
      latestAuthorizationId: 'attempt',
      pagination: { page: 1, pageSize: 25, total: 1 },
    },
    isError: false,
    isPending: false,
    isFetching: false,
    refetch: mock.historyRefetch,
  });
  const view = render(<FiscalAuthorizationPanel draft={draft} canPrepare />);
  expect(mock.history).toHaveBeenLastCalledWith('invoice', 'draft', 1, false);
  fireEvent.click(screen.getByRole('button', { name: 'Ver historial de factura' }));
  expect(screen.getByText('Rechazo anterior')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Autorizar comprobante de prueba' })).toBeNull();
  expect(
    (screen.getByRole('button', { name: 'Consultar resultado en ARCA' }) as HTMLButtonElement).disabled,
  ).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Recargar historial' }));
  expect(mock.historyRefetch).toHaveBeenCalledTimes(1);
  expect(mock.consult).not.toHaveBeenCalled();
  mock.history.mockReturnValue({
    data: undefined,
    isError: true,
    isPending: false,
    isFetching: false,
    refetch: mock.historyRefetch,
  });
  view.rerender(<FiscalAuthorizationPanel draft={draft} canPrepare />);
  expect(screen.queryByText('Rechazo anterior')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Autorizar comprobante de prueba' })).toBeNull();
  expect(
    (screen.getByRole('button', { name: 'Consultar resultado en ARCA' }) as HTMLButtonElement).disabled,
  ).toBe(false);
});

it.each([
  ['AUTHORIZED', 'HOMOLOGATION', 'draft', 3, true],
  ['UNKNOWN', 'HOMOLOGATION', 'draft', 3, false],
  ['SENDING', 'HOMOLOGATION', 'draft', 3, false],
  ['REJECTED', 'HOMOLOGATION', 'draft', 3, false],
  ['AUTHORIZED', 'PRODUCTION', 'draft', 3, false],
  ['AUTHORIZED', 'HOMOLOGATION', 'other', 3, false],
  ['AUTHORIZED', 'HOMOLOGATION', 'draft', 2, false],
])(
  'mounts credit preparation only for a matching homologation authorization (%s/%s/%s/%s)',
  (status, environment, draftId, draftRevision, visible) => {
    mock.query.mockReturnValue({
      data: { authorization: { ...attempt, status, environment, draftId, draftRevision } },
      isError: false,
      isPending: false,
      isFetching: false,
    });
    render(<FiscalAuthorizationPanel draft={draft} canPrepare />);
    expect(Boolean(screen.queryByText('Credit note preparation'))).toBe(visible);
  },
);
