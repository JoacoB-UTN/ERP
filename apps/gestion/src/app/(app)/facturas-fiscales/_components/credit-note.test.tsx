import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FiscalDraftDto } from '@erp/shared';
import { FiscalCreditNotePanel } from './credit-note';
const mock = vi.hoisted(() => ({ company: 'a', read: true, write: true, query: vi.fn(), save: vi.fn() }));
vi.mock('@/lib/auth-client', () => ({
  authClient: { companyContextStore: { getActiveCompanyId: () => mock.company } },
  useActiveCompany: () => ({ activeCompanyId: mock.company }),
  usePermissions: () => ({
    isLoading: false,
    can: (p: string) => (p === 'sales.invoices.read' ? mock.read : mock.write),
  }),
  useFiscalCreditNote: (...args: unknown[]) => mock.query(...args),
  useSaveFiscalCreditNote: () => ({ mutateAsync: mock.save }),
}));
const invoice = { totals: { finalAmount: '121.00' } } as FiscalDraftDto;
const saved = {
  id: 'note',
  reason: 'Devolución total',
  revision: 1,
  authorizedAmounts: { total: '121.00' },
  original: { pointOfSale: 3, voucherNumber: 42 },
  creditNoteType: 8,
};
const state = (draft: unknown = null) => ({
  data: { draft },
  isError: false,
  isFetching: false,
  isPending: false,
});
beforeEach(() => {
  mock.company = 'a';
  mock.read = true;
  mock.write = true;
  mock.query.mockReset().mockReturnValue(state());
  mock.save.mockReset().mockResolvedValue({ draft: saved });
});
afterEach(cleanup);
it('requires a meaningful reason and saves only reason plus loaded revision', async () => {
  render(<FiscalCreditNotePanel originalId="original" invoice={invoice} />);
  const button = screen.getByRole('button', { name: 'Guardar borrador de nota' });
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '    abc    ' } });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '  Devolución total  ' } });
  fireEvent.click(button);
  await waitFor(() =>
    expect(mock.save).toHaveBeenCalledWith({
      originalId: 'original',
      input: { reason: 'Devolución total', expectedRevision: 0 },
    }),
  );
  expect(await screen.findByText('Borrador de nota de crédito guardado. No enviado a ARCA.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Autorizar|Enviar/ })).toBeNull();
});
it('rejects overlong reasons even when the DOM is given a longer value', () => {
  render(<FiscalCreditNotePanel originalId="original" invoice={invoice} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x'.repeat(501) } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar borrador de nota' }));
  expect(mock.save).not.toHaveBeenCalled();
});
it('preserves local reason and revision across background refetches', async () => {
  mock.query.mockReturnValue(state(saved));
  const view = render(<FiscalCreditNotePanel originalId="original" invoice={invoice} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Mi motivo local' } });
  mock.query.mockReturnValue({ ...state({ ...saved, revision: 9, reason: 'Cambio ajeno' }), isError: true });
  view.rerender(<FiscalCreditNotePanel originalId="original" invoice={invoice} />);
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Mi motivo local');
  expect(
    (screen.getByRole('button', { name: 'Guardar borrador de nota' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  mock.query.mockReturnValue(state({ ...saved, revision: 9 }));
  view.rerender(<FiscalCreditNotePanel originalId="original" invoice={invoice} />);
  fireEvent.click(screen.getByRole('button', { name: 'Guardar borrador de nota' }));
  await waitFor(() =>
    expect(mock.save).toHaveBeenCalledWith({
      originalId: 'original',
      input: { reason: 'Mi motivo local', expectedRevision: 1 },
    }),
  );
});
it('keeps edits but latches a conflict until explicit reload', async () => {
  mock.save.mockRejectedValue(new Error('La revisión cambió'));
  render(<FiscalCreditNotePanel originalId="original" invoice={invoice} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Devolución total' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar borrador de nota' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Recargar y descartar cambios de la nota' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Guardar borrador de nota' }));
  expect(mock.save).toHaveBeenCalledTimes(1);
});
it('guards double submission and discards responses after a company change', async () => {
  let resolve!: (v: unknown) => void;
  mock.save.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  render(<FiscalCreditNotePanel originalId="original" invoice={invoice} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Devolución total' } });
  const button = screen.getByRole('button', { name: 'Guardar borrador de nota' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(mock.save).toHaveBeenCalledTimes(1);
  mock.company = 'b';
  await act(async () => resolve({ draft: saved }));
  expect(screen.queryByText(/Borrador de nota de crédito guardado/)).toBeNull();
});
it('shows a persisted note read-only using its own original amounts', () => {
  mock.write = false;
  mock.query.mockReturnValue(state({ ...saved, authorizedAmounts: { total: '99.00' } }));
  render(<FiscalCreditNotePanel originalId="original" invoice={invoice} />);
  expect(screen.getByText('Importe total de la nota: ARS 99.00')).toBeTruthy();
  expect(screen.getByText('Motivo: Devolución total')).toBeTruthy();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
});
it('does not query without read permission', () => {
  mock.read = false;
  render(<FiscalCreditNotePanel originalId="original" invoice={invoice} />);
  expect(mock.query).toHaveBeenCalledWith('original', false);
  expect(screen.queryByRole('heading')).toBeNull();
});
it('disables writes while the original authorization is being verified without losing edits', () => {
  const view = render(<FiscalCreditNotePanel originalId="original" invoice={invoice} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Motivo conservado' } });
  view.rerender(<FiscalCreditNotePanel originalId="original" invoice={invoice} available={false} />);
  expect(
    (screen.getByRole('button', { name: 'Guardar borrador de nota' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  view.rerender(<FiscalCreditNotePanel originalId="original" invoice={invoice} available />);
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Motivo conservado');
});
