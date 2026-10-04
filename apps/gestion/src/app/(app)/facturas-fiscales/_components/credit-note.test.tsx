import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FiscalDraftDto } from '@erp/shared';
import { FiscalCreditNotePanel } from './credit-note';
const mock = vi.hoisted(() => ({
  company: 'a',
  read: true,
  write: true,
  query: vi.fn(),
  save: vi.fn(),
  authorization: vi.fn(),
  send: vi.fn(),
  consult: vi.fn(),
}));
vi.mock('@/lib/auth-client', () => ({
  authClient: { companyContextStore: { getActiveCompanyId: () => mock.company } },
  useActiveCompany: () => ({ activeCompanyId: mock.company }),
  usePermissions: () => ({
    isLoading: false,
    can: (p: string) => (p === 'sales.invoices.read' ? mock.read : mock.write),
  }),
  useFiscalCreditNote: (...args: unknown[]) => mock.query(...args),
  useSaveFiscalCreditNote: () => ({ mutateAsync: mock.save }),
  useFiscalCreditNoteAuthorization: (...args: unknown[]) => mock.authorization(...args),
  useAuthorizeFiscalCreditNote: () => ({ mutateAsync: mock.send }),
  useReconcileFiscalCreditNote: () => ({ mutateAsync: mock.consult }),
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
const attempt = {
  id: 'attempt',
  draftId: 'note',
  draftRevision: 1,
  environment: 'HOMOLOGATION',
  status: 'AUTHORIZED',
  pointOfSale: 3,
  voucherType: 8,
  voucherNumber: 7,
  cae: '12345678901234',
  expiresAt: '20261020',
  message: 'Solo pruebas',
  updatedAt: '2026-10-04T12:00:00Z',
};
const authorizationState = (authorization: unknown = null) => ({
  data: { authorization },
  isError: false,
  isPending: false,
  isFetching: false,
});
function acknowledge() {
  screen.getAllByRole('checkbox').forEach((checkbox) => fireEvent.click(checkbox));
}
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
  mock.authorization.mockReset().mockReturnValue(authorizationState());
  mock.send.mockReset().mockResolvedValue({ authorization: attempt });
  mock.consult.mockReset().mockResolvedValue({ authorization: attempt });
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
  expect(await screen.findByText('Borrador de nota de crédito guardado.')).toBeTruthy();
  expect(mock.send).not.toHaveBeenCalled();
  expect(
    (screen.getByRole('button', { name: 'Autorizar nota de crédito de prueba' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
it('rejects overlong reasons even when the DOM is given a longer value', () => {
  render(<FiscalCreditNotePanel originalId="original" invoice={invoice} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x'.repeat(501) } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar borrador de nota' }));
  expect(mock.save).not.toHaveBeenCalled();
});
it('preserves edits but requires reload when a background refetch reveals a newer revision', () => {
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
  expect(mock.save).not.toHaveBeenCalled();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.getByText(/La nota cambió en otra sesión/)).toBeTruthy();
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Mi motivo local');
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

it('requires both acknowledgements and sends the saved revision once, then freezes the note', async () => {
  mock.query.mockReturnValue(state(saved));
  let resolve!: (value: unknown) => void;
  mock.send.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  render(<FiscalCreditNotePanel originalId="original" invoice={invoice} />);
  const send = screen.getByRole('button', { name: 'Autorizar nota de crédito de prueba' });
  expect((send as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getAllByRole('checkbox')[0]);
  expect((send as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getAllByRole('checkbox')[1]);
  fireEvent.click(send);
  fireEvent.click(send);
  fireEvent.click(screen.getByRole('button', { name: 'Guardar borrador de nota' }));
  expect(mock.save).not.toHaveBeenCalled();
  expect(mock.send).toHaveBeenCalledTimes(1);
  expect(mock.send).toHaveBeenCalledWith({
    creditNoteId: 'note',
    input: {
      expectedRevision: 1,
      confirmHomologation: true,
      exclusivePointOfSale: true,
    },
  });
  await act(async () => resolve({ authorization: attempt }));
  expect(screen.getByText('Nota autorizada en pruebas')).toBeTruthy();
  expect(screen.getByText(/CAE de prueba de la nota: 12345678901234/)).toBeTruthy();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(
    (screen.getByRole('button', { name: 'Guardar borrador de nota' }) as HTMLButtonElement).disabled,
  ).toBe(true);
});

it.each(['SENDING', 'UNKNOWN'])('allows consultation alone for %s and never resends', async (status) => {
  mock.query.mockReturnValue(state(saved));
  mock.authorization.mockReturnValue(authorizationState({ ...attempt, status, cae: null, expiresAt: null }));
  render(<FiscalCreditNotePanel originalId="original" invoice={invoice} />);
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByText(/No enviado/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Guardar borrador de nota' }));
  expect(mock.save).not.toHaveBeenCalled();
  expect(mock.consult).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Consultar resultado de la nota en ARCA' }));
  await waitFor(() => expect(mock.consult).toHaveBeenCalledWith('attempt'));
  expect(await screen.findByText('Nota autorizada en pruebas')).toBeTruthy();
  expect(mock.send).not.toHaveBeenCalled();
});

it.each(['AUTHORIZED', 'UNKNOWN', 'REJECTED'])('read-only operators see %s but no mutations', (status) => {
  mock.query.mockReturnValue(state(saved));
  mock.authorization.mockReturnValue(authorizationState({ ...attempt, status }));
  mock.write = false;
  render(<FiscalCreditNotePanel originalId="original" invoice={invoice} />);
  expect(mock.authorization).toHaveBeenCalledWith('note', true);
  expect(screen.getByText('Motivo: Devolución total')).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(mock.send).not.toHaveBeenCalled();
  expect(mock.consult).not.toHaveBeenCalled();
});

it('requires saving changed reason and renewed confirmations before a rejected note can be sent', async () => {
  mock.query.mockReturnValue(state(saved));
  mock.authorization.mockReturnValue(authorizationState({ ...attempt, status: 'REJECTED', cae: null }));
  mock.save.mockResolvedValue({ draft: { ...saved, reason: 'Mercadería devuelta', revision: 2 } });
  render(<FiscalCreditNotePanel originalId="original" invoice={invoice} />);
  acknowledge();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Mercadería devuelta' } });
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.getByText('Guardá el motivo antes de autorizar la nota.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Guardar borrador de nota' }));
  const send = await screen.findByRole('button', { name: 'Autorizar nota de crédito de prueba' });
  expect((send as HTMLButtonElement).disabled).toBe(true);
  acknowledge();
  fireEvent.click(send);
  await waitFor(() =>
    expect(mock.send).toHaveBeenCalledWith({
      creditNoteId: 'note',
      input: {
        expectedRevision: 2,
        confirmHomologation: true,
        exclusivePointOfSale: true,
      },
    }),
  );
});

it('rejects stale confirmations when a different attempt is loaded in the background', () => {
  mock.query.mockReturnValue(state(saved));
  const view = render(<FiscalCreditNotePanel originalId="original" invoice={invoice} />);
  acknowledge();
  mock.authorization.mockReturnValue(authorizationState({ ...attempt, status: 'REJECTED' }));
  view.rerender(<FiscalCreditNotePanel originalId="original" invoice={invoice} />);
  fireEvent.click(screen.getByRole('button', { name: 'Autorizar nota de crédito de prueba' }));
  expect(mock.send).not.toHaveBeenCalled();
});

it('keeps an uncertain send locked even if a background response says there was no attempt', async () => {
  mock.query.mockReturnValue(state(saved));
  mock.send.mockRejectedValue(new Error('Conexión interrumpida'));
  const view = render(<FiscalCreditNotePanel originalId="original" invoice={invoice} />);
  acknowledge();
  fireEvent.click(screen.getByRole('button', { name: 'Autorizar nota de crédito de prueba' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  mock.authorization.mockReturnValue(authorizationState());
  view.rerender(<FiscalCreditNotePanel originalId="original" invoice={invoice} />);
  expect(screen.queryByRole('checkbox')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Guardar borrador de nota' }));
  expect(mock.save).not.toHaveBeenCalled();
  expect(mock.send).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Recargar y descartar cambios de la nota' })).toBeTruthy();
});

it('discards a late authorization result after changing company and clears confirmations', async () => {
  mock.query.mockReturnValue(state(saved));
  let resolve!: (value: unknown) => void;
  mock.send.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const view = render(<FiscalCreditNotePanel originalId="original" invoice={invoice} />);
  acknowledge();
  fireEvent.click(screen.getByRole('button', { name: 'Autorizar nota de crédito de prueba' }));
  mock.company = 'b';
  view.rerender(<FiscalCreditNotePanel originalId="original" invoice={invoice} />);
  await act(async () => resolve({ authorization: attempt }));
  expect(screen.queryByText('Nota autorizada en pruebas')).toBeNull();
  expect(
    (screen.getByRole('button', { name: 'Autorizar nota de crédito de prueba' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});

it.each([{ isError: true }, { isFetching: true }, { isPending: true, data: undefined }])(
  'blocks edits and sends until the saved note authorization is verified (%j)',
  (queryState) => {
    mock.query.mockReturnValue(state(saved));
    mock.authorization.mockReturnValue({ ...authorizationState(), ...queryState });
    render(<FiscalCreditNotePanel originalId="original" invoice={invoice} />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar borrador de nota' }));
    expect(mock.save).not.toHaveBeenCalled();
  },
);

it('fails closed for an authorization belonging to a different note', () => {
  mock.query.mockReturnValue(state(saved));
  mock.authorization.mockReturnValue(authorizationState({ ...attempt, draftId: 'other-note' }));
  render(<FiscalCreditNotePanel originalId="original" invoice={invoice} />);
  expect(screen.queryByText('Nota autorizada en pruebas')).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.getByText(/No se pudo verificar que el resultado corresponda/)).toBeTruthy();
});

const printableNote = {
  ...saved,
  environment: 'HOMOLOGATION',
  original: { ...saved.original, voucherType: 6, date: '20261004' },
  authorizedAmounts: { total: '121.00', net: '100.00', vat: '21.00', exempt: '0.00', notTaxed: '0.00' },
  invoice: {
    invoiceType: 'B',
    source: {
      issuer: { legalName: 'Emisor', taxId: '20123456786' },
      recipient: { legalName: 'Cliente', taxId: '20123456786', taxCondition: 'CONSUMIDOR_FINAL' },
      saleNumber: 'V-1',
    },
    lines: [],
  },
};
it('allows a read-only operator to print a verified authorized note without mutation permissions', () => {
  mock.write = false;
  mock.query.mockReturnValue(state(printableNote));
  mock.authorization.mockReturnValue(authorizationState(attempt));
  const print = vi.spyOn(window, 'print').mockImplementation(() => {});
  render(<FiscalCreditNotePanel originalId="original" invoice={invoice} />);
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.getAllByRole('button')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Imprimir nota de crédito de prueba' }));
  expect(print).toHaveBeenCalledOnce();
  expect(mock.send).not.toHaveBeenCalled();
  expect(mock.save).not.toHaveBeenCalled();
  print.mockRestore();
});

it.each(['authorization-error', 'authorization-refresh', 'note-error', 'stale-note', 'original-unavailable'])(
  'removes the printable note when current data cannot be verified (%s)',
  (failure) => {
    mock.query.mockReturnValue(state(printableNote));
    mock.authorization.mockReturnValue(authorizationState(attempt));
    const view = render(<FiscalCreditNotePanel originalId="original" invoice={invoice} />);
    expect(screen.getByRole('button', { name: 'Imprimir nota de crédito de prueba' })).toBeTruthy();
    if (failure === 'authorization-error')
      mock.authorization.mockReturnValue({ ...authorizationState(attempt), isError: true });
    if (failure === 'authorization-refresh')
      mock.authorization.mockReturnValue({ ...authorizationState(attempt), isFetching: true });
    if (failure === 'note-error') mock.query.mockReturnValue({ ...state(printableNote), isError: true });
    if (failure === 'stale-note') mock.query.mockReturnValue(state({ ...printableNote, revision: 2 }));
    view.rerender(
      <FiscalCreditNotePanel
        originalId="original"
        invoice={invoice}
        available={failure !== 'original-unavailable'}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Imprimir nota de crédito de prueba' })).toBeNull();
    expect(document.querySelector('[data-fiscal-test-print]')).toBeNull();
  },
);
