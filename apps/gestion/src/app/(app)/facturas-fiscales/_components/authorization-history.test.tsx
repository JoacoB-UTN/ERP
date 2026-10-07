import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FiscalAuthorizationHistory } from './authorization-history';

const mock = vi.hoisted(() => ({ company: 'a', read: true, query: vi.fn(), refetch: vi.fn() }));
vi.mock('@/lib/auth-client', () => ({
  authClient: { companyContextStore: { getActiveCompanyId: () => mock.company } },
  useActiveCompany: () => ({ activeCompanyId: mock.company }),
  usePermissions: () => ({
    isLoading: false,
    can: (permission: string) => permission === 'sales.invoices.read' && mock.read,
  }),
  useFiscalAuthorizationHistory: (...args: unknown[]) => mock.query(...args),
}));
const attempt = {
  id: 'latest',
  draftId: 'draft',
  draftRevision: 4,
  environment: 'HOMOLOGATION',
  status: 'REJECTED',
  pointOfSale: 3,
  voucherType: 6,
  voucherNumber: 42,
  message: '<script>Mensaje guardado</script>',
  createdAt: '2026-10-07T12:30:00Z',
  updatedAt: '2026-10-07T13:00:00Z',
  cae: '12345678901234',
  expiresAt: '20261020',
};
function state(
  items: unknown[] = [attempt],
  latestAuthorizationId: string | null = 'latest',
  total = items.length,
) {
  return {
    data: { items, latestAuthorizationId, pagination: { page: 1, pageSize: 25, total } },
    isPending: false,
    isFetching: false,
    isError: false,
    refetch: mock.refetch,
  };
}
const expand = () => fireEvent.click(screen.getByRole('button', { name: /Ver historial/ }));
beforeEach(() => {
  mock.company = 'a';
  mock.read = true;
  mock.query.mockReset().mockReturnValue(state());
  mock.refetch.mockReset();
});
afterEach(cleanup);

it.each(['invoice', 'credit-note'] as const)(
  'loads %s history only when explicitly expanded and never exposes fiscal actions',
  (kind) => {
    render(<FiscalAuthorizationHistory kind={kind} id="draft" />);
    expect(mock.query).toHaveBeenLastCalledWith(kind, 'draft', 1, false);
    expect(screen.queryByRole('table')).toBeNull();
    expand();
    expect(mock.query).toHaveBeenLastCalledWith(kind, 'draft', 1, true);
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Ocultar historial/ }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(
      screen.queryByRole('button', { name: /Autorizar|Consultar resultado|Imprimir|Enviar/ }),
    ).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(mock.refetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Ocultar historial/ }));
    expect(mock.query).toHaveBeenLastCalledWith(kind, 'draft', 1, false);
    expect(screen.queryByRole('table')).toBeNull();
  },
);

it('renders persisted revisions, local registration date, numbers and escaped messages without CAE or request fields', () => {
  mock.query.mockReturnValue(
    state([
      attempt,
      { ...attempt, id: 'older', draftRevision: 2, status: 'UNKNOWN', message: 'Respuesta incierta' },
    ]),
  );
  render(<FiscalAuthorizationHistory kind="invoice" id="draft" />);
  expand();
  const latest = within(screen.getByText('Último intento').closest('tr')!);
  expect(latest.getByText('4')).toBeTruthy();
  expect(latest.getByText('00003-00000042 · Tipo 6')).toBeTruthy();
  expect(latest.getByText('Rechazado en pruebas')).toBeTruthy();
  expect(latest.getByText('<script>Mensaje guardado</script>')).toBeTruthy();
  const timestamp = screen.getAllByText(/9:30/)[0].closest('time')!;
  expect(timestamp.dateTime).toBe('2026-10-07T12:30:00Z');
  expect(document.querySelector('script')).toBeNull();
  expect(screen.queryByText('12345678901234')).toBeNull();
  expect(screen.getByText('Anterior', { selector: 'td' })).toBeTruthy();
});

it('uses the global latest ID rather than treating the first row of each page as latest', () => {
  mock.query.mockReturnValue(state([attempt], 'latest', 26));
  const view = render(<FiscalAuthorizationHistory kind="invoice" id="draft" />);
  expand();
  expect(screen.getByText('Página 1 de 2')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
  expect(mock.query).toHaveBeenLastCalledWith('invoice', 'draft', 2, true);
  mock.query.mockReturnValue(state([{ ...attempt, id: 'older' }], 'latest', 26));
  view.rerender(<FiscalAuthorizationHistory kind="invoice" id="draft" />);
  expect(screen.queryByText('Último intento')).toBeNull();
  expect(screen.getByText('Anterior', { selector: 'td' })).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Siguiente' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));
  expect(mock.query).toHaveBeenLastCalledWith('invoice', 'draft', 1, true);
});

it('has an explicit empty state and reloads only its own history query', () => {
  mock.query.mockReturnValue(state([], null));
  render(<FiscalAuthorizationHistory kind="credit-note" id="note" />);
  expand();
  expect(screen.getByText('Todavía no hay intentos registrados.')).toBeTruthy();
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.getByText('Página 1 de 1')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Recargar historial' }));
  expect(mock.refetch).toHaveBeenCalledTimes(1);
});

it.each([{ isError: true }, { isFetching: true }, { isPending: true }])(
  'hides stale cached rows and pagination while the query is not current (%j)',
  (change) => {
    const view = render(<FiscalAuthorizationHistory kind="invoice" id="draft" />);
    expand();
    expect(screen.getByRole('table')).toBeTruthy();
    mock.query.mockReturnValue({ ...state(), ...change });
    view.rerender(<FiscalAuthorizationHistory kind="invoice" id="draft" />);
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText('Último intento')).toBeNull();
    expect(screen.queryByText('Todavía no hay intentos registrados.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Siguiente' })).toBeNull();
    if ('isError' in change) {
      expect(screen.getByRole('alert')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Recargar historial' }));
      expect(mock.refetch).toHaveBeenCalledTimes(1);
    } else {
      expect(screen.getByText('Cargando historial…')).toBeTruthy();
      expect((screen.getByRole('button', { name: 'Recargar historial' }) as HTMLButtonElement).disabled).toBe(
        true,
      );
    }
  },
);

it('preserves expanded state but hides cached history while its parent is unavailable', () => {
  const view = render(<FiscalAuthorizationHistory kind="invoice" id="draft" />);
  expand();
  view.rerender(<FiscalAuthorizationHistory kind="invoice" id="draft" available={false} />);
  expect(mock.query).toHaveBeenLastCalledWith('invoice', 'draft', 1, false);
  expect(screen.getByRole('button', { name: 'Ocultar historial de factura' })).toBeTruthy();
  expect(screen.queryByRole('table')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Recargar historial' }));
  expect(mock.refetch).not.toHaveBeenCalled();
  view.rerender(<FiscalAuthorizationHistory kind="invoice" id="draft" available />);
  expect(screen.getByRole('table')).toBeTruthy();
});

it.each(['company', 'kind', 'id'])('resets page and expansion when %s changes', (change) => {
  mock.query.mockReturnValue(state([attempt], 'latest', 26));
  const view = render(<FiscalAuthorizationHistory kind="invoice" id="draft" />);
  expand();
  fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
  if (change === 'company') mock.company = 'b';
  const kind = change === 'kind' ? 'credit-note' : 'invoice';
  const id = change === 'id' ? 'other' : 'draft';
  view.rerender(<FiscalAuthorizationHistory kind={kind} id={id} />);
  expect(mock.query).toHaveBeenLastCalledWith(kind, id, 1, false);
  expect(screen.queryByRole('table')).toBeNull();
  expand();
  expect(mock.query).toHaveBeenLastCalledWith(kind, id, 1, true);
});

it('rejects stale click handlers immediately after the company store changes', () => {
  mock.query.mockReturnValue(state([attempt], 'latest', 26));
  render(<FiscalAuthorizationHistory kind="invoice" id="draft" />);
  expand();
  mock.company = 'b';
  fireEvent.click(screen.getByRole('button', { name: 'Recargar historial' }));
  fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
  expect(mock.refetch).not.toHaveBeenCalled();
  expect(mock.query).toHaveBeenLastCalledWith('invoice', 'draft', 1, true);
});

it('does not mount history without read permission or a saved document', () => {
  mock.read = false;
  const view = render(<FiscalAuthorizationHistory kind="invoice" id="draft" />);
  expect(mock.query).not.toHaveBeenCalled();
  expect(screen.queryByRole('button')).toBeNull();
  mock.read = true;
  view.rerender(<FiscalAuthorizationHistory kind="credit-note" id={null} />);
  expect(mock.query).not.toHaveBeenCalled();
});
