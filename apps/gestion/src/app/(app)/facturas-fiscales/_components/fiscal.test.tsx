import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { FiscalDraftDto, FiscalPreview, FiscalSource } from '@erp/shared';
import FiscalLayout from '../layout';
import { FiscalForm, FiscalListPage, FiscalNewPage, FiscalPreparePage, FiscalDetailPage } from './fiscal';

const mock = vi.hoisted(() => ({
  company: 'company-a',
  permissions: new Set<string>(),
  preview: vi.fn(),
  save: vi.fn(),
  authorize: vi.fn(),
  reconcile: vi.fn(),
  list: vi.fn(),
  sales: vi.fn(),
  source: vi.fn(),
  bySale: vi.fn(),
  detail: vi.fn(),
  listError: false,
  listItems: [] as unknown[],
  sourceData: undefined as unknown,
  draftData: undefined as unknown,
  refetchError: false,
  retry: vi.fn(),
}));
const result = (data: unknown) => ({ data, isPending: false, isError: false, error: null, refetch: vi.fn() });
vi.mock('next/navigation', () => ({ useParams: () => ({ saleId: 'sale-a', id: 'draft-a' }) }));
vi.mock('@/lib/auth-client', () => ({
  authClient: { companyContextStore: { getActiveCompanyId: () => mock.company } },
  useActiveCompany: () => ({ activeCompanyId: mock.company }),
  useFiscalAuthorization: () => ({ data: { authorization: null }, isError: false, isPending: false }),
  useAuthorizeFiscalDraft: () => ({ mutateAsync: mock.authorize }),
  useReconcileFiscalAuthorization: () => ({ mutateAsync: mock.reconcile }),
  usePermissions: () => ({ can: (p: string) => mock.permissions.has(p), isLoading: false }),
  usePreviewFiscalDraft: () => ({ mutateAsync: mock.preview }),
  useSaveFiscalDraft: () => ({ mutateAsync: mock.save }),
  useFiscalDrafts: (...args: unknown[]) => {
    mock.list(...args);
    return {
      ...result({
        items: mock.listItems,
        pagination: { page: 1, pageSize: 25, total: mock.listItems.length, totalPages: 1 },
      }),
      isError: mock.listError,
      error: mock.listError ? new Error('Sin conexión') : null,
    };
  },
  useFiscalSales: (...args: unknown[]) => {
    mock.sales(...args);
    return result({ items: [], pagination: { page: 1, pageSize: 25, total: 0 } });
  },
  useFiscalSource: (...args: unknown[]) => {
    mock.source(...args);
    return {
      ...result(mock.sourceData),
      isError: mock.refetchError,
      error: mock.refetchError ? new Error('Error al actualizar venta') : null,
      refetch: mock.retry,
    };
  },
  useFiscalDraftForSale: (...args: unknown[]) => {
    mock.bySale(...args);
    return {
      ...result(mock.draftData),
      isError: mock.refetchError,
      error: mock.refetchError ? new Error('Error al actualizar borrador') : null,
      refetch: mock.retry,
    };
  },
  useFiscalDraft: (...args: unknown[]) => {
    mock.detail(...args);
    return result({ draft: draft });
  },
}));
const source: FiscalSource = {
  saleId: 'sale-a',
  saleNumber: 'VTA-001',
  currencyCode: 'ARS',
  total: '121.00',
  issuer: { legalName: 'Empresa A', taxId: '20123456789' },
  recipient: { legalName: 'Cliente A', taxId: null, taxCondition: 'UNKNOWN' },
  lines: [{ salesLineId: 'line-a', description: 'Producto de prueba', quantity: '1', finalAmount: '121.00' }],
};
const preview: FiscalPreview = {
  source,
  invoiceType: 'B',
  amountInterpretation: 'FINAL_AMOUNTS_INCLUDE_VAT',
  authorizationAvailable: false,
  pendingRequirements: ['Configurar emisor y punto de venta de pruebas.'],
  lines: [
    {
      ...source.lines[0],
      treatment: 'VAT_21',
      netAmount: '100.00',
      vatAmount: '21.00',
      exemptAmount: '0.00',
      notTaxedAmount: '0.00',
    },
  ],
  totals: {
    netAmount: '100.00',
    vatAmount: '21.00',
    exemptAmount: '0.00',
    notTaxedAmount: '0.00',
    finalAmount: '121.00',
  },
};
const draft: FiscalDraftDto = {
  ...preview,
  id: 'draft-a',
  revision: 3,
  status: 'DRAFT',
  createdAt: '2026-10-03T10:00:00Z',
  updatedAt: '2026-10-03T10:00:00Z',
};
function fill() {
  fireEvent.change(screen.getByLabelText('Clase propuesta'), { target: { value: 'B' } });
  fireEvent.change(screen.getByLabelText('Tratamiento: Producto de prueba'), { target: { value: 'VAT_21' } });
  fireEvent.click(screen.getByRole('checkbox'));
}
async function calculate() {
  fireEvent.click(screen.getByRole('button', { name: 'Calcular desglose' }));
  await screen.findByRole('heading', { name: 'Desglose propuesto · Clase B' });
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.company = 'company-a';
  mock.permissions = new Set(['sales.invoices.read', 'sales.invoices.create', 'sales.documents.read']);
  mock.listError = false;
  mock.listItems = [];
  mock.sourceData = undefined;
  mock.draftData = undefined;
  mock.refetchError = false;
  mock.preview.mockResolvedValue({ preview });
  mock.save.mockResolvedValue({ draft: { ...draft, revision: 1 } });
});
afterEach(cleanup);

describe('Fiscal draft preparation', () => {
  it('requires explicit class, tax treatment and final amount confirmation before server preview', async () => {
    render(<FiscalForm source={source} draft={null} />);
    expect((screen.getByLabelText('Clase propuesta') as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText('Tratamiento: Producto de prueba') as HTMLSelectElement).value).toBe('');
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('button', { name: 'Calcular desglose' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.queryByRole('button', { name: 'Guardar borrador' })).toBeNull();
    fill();
    await calculate();
    expect(mock.preview).toHaveBeenCalledWith({
      saleId: 'sale-a',
      input: {
        invoiceType: 'B',
        amountInterpretation: 'FINAL_AMOUNTS_INCLUDE_VAT',
        lines: [{ salesLineId: 'line-a', treatment: 'VAT_21' }],
      },
    });
    expect(screen.getAllByText('ARS 21,00').length).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    await screen.findByRole('status');
    expect(mock.save.mock.calls[0][0].input.expectedRevision).toBe(0);
    expect(mock.save.mock.calls[0][0].input).not.toHaveProperty('total');
  });
  it('invalidates the preview and clears treatments when changing invoice class to C', async () => {
    render(<FiscalForm source={source} draft={null} />);
    fill();
    await calculate();
    fireEvent.change(screen.getByLabelText('Clase propuesta'), { target: { value: 'C' } });
    expect(screen.queryByRole('button', { name: 'Guardar borrador' })).toBeNull();
    expect((screen.getByLabelText('Tratamiento: Producto de prueba') as HTMLSelectElement).value).toBe('');
    expect(screen.queryByRole('option', { name: 'IVA 21%' })).toBeNull();
    expect(screen.getByRole('option', { name: 'Comprobante C (sin discriminar IVA)' })).toBeTruthy();
  });
  it('invalidates the preview when the gross amount confirmation is removed', async () => {
    render(<FiscalForm source={source} draft={null} />);
    fill();
    await calculate();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.queryByRole('button', { name: 'Guardar borrador' })).toBeNull();
  });
  it('does not overwrite edits or loaded revision when a background refetch supplies a newer draft', async () => {
    const view = render(<FiscalForm source={source} draft={draft} />);
    fireEvent.change(screen.getByLabelText('Tratamiento: Producto de prueba'), {
      target: { value: 'VAT_0' },
    });
    view.rerender(<FiscalForm source={{ ...source, total: '999.00' }} draft={{ ...draft, revision: 8 }} />);
    expect((screen.getByLabelText('Tratamiento: Producto de prueba') as HTMLSelectElement).value).toBe(
      'VAT_0',
    );
    expect(screen.queryByText(/999/)).toBeNull();
    await calculate();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    await waitFor(() => expect(mock.save).toHaveBeenCalled());
    expect(mock.save.mock.calls[0][0].input.expectedRevision).toBe(3);
  });
  it('shows save conflicts without claiming success or silently replacing the revision', async () => {
    mock.save.mockRejectedValue(new Error('El borrador cambió. Recargá para continuar.'));
    render(<FiscalForm source={source} draft={null} />);
    fill();
    await calculate();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    expect((await screen.findByRole('alert')).textContent).toContain('El borrador cambió');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Guardar borrador' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Recargar y descartar cambios locales' })).toBeTruthy();
  });
  it('ignores a preview response after the company changes', async () => {
    let finish!: (data: { preview: FiscalPreview }) => void;
    mock.preview.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<FiscalForm source={source} draft={null} />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Calcular desglose' }));
    mock.company = 'company-b';
    finish({ preview });
    await waitFor(() => expect(mock.preview).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('heading', { name: /Desglose propuesto/ })).toBeNull();
  });
  it('remounts edits on a company change', () => {
    const view = render(
      <FiscalLayout>
        <FiscalForm source={source} draft={null} />
      </FiscalLayout>,
    );
    fill();
    mock.company = 'company-b';
    view.rerender(
      <FiscalLayout>
        <FiscalForm source={source} draft={null} />
      </FiscalLayout>,
    );
    expect((screen.getByLabelText('Clase propuesta') as HTMLSelectElement).value).toBe('');
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  });
  it('preserves unsaved class, treatment and revision through failed background refetch and retry', async () => {
    mock.sourceData = { source };
    mock.draftData = { draft };
    const view = render(<FiscalPreparePage />);
    fireEvent.change(screen.getByLabelText('Clase propuesta'), { target: { value: 'A' } });
    fireEvent.change(screen.getByLabelText('Tratamiento: Producto de prueba'), {
      target: { value: 'VAT_0' },
    });
    mock.refetchError = true;
    view.rerender(<FiscalPreparePage />);
    expect(screen.getAllByRole('alert')).toHaveLength(2);
    expect((screen.getByLabelText('Clase propuesta') as HTMLSelectElement).value).toBe('A');
    expect((screen.getByLabelText('Tratamiento: Producto de prueba') as HTMLSelectElement).value).toBe(
      'VAT_0',
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Reintentar' })[0]);
    expect(mock.retry).toHaveBeenCalledTimes(1);
    mock.refetchError = false;
    mock.draftData = { draft: { ...draft, revision: 8 } };
    view.rerender(<FiscalPreparePage />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByLabelText('Clase propuesta') as HTMLSelectElement).value).toBe('A');
    expect((screen.getByLabelText('Tratamiento: Producto de prueba') as HTMLSelectElement).value).toBe(
      'VAT_0',
    );
    await calculate();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    await waitFor(() => expect(mock.save).toHaveBeenCalledTimes(1));
    expect(mock.save.mock.calls[0][0].input.expectedRevision).toBe(3);
    expect(mock.save.mock.calls[0][0].input.invoiceType).toBe('A');
    expect(mock.save.mock.calls[0][0].input.lines[0].treatment).toBe('VAT_0');
  });
  it('blocks initial preparation when a failed query has no cached data', () => {
    mock.refetchError = true;
    render(<FiscalPreparePage />);
    expect(screen.getAllByRole('alert')).toHaveLength(2);
    expect(screen.queryByLabelText('Clase propuesta')).toBeNull();
  });
  it('blocks duplicate saves while a request is pending', async () => {
    mock.save.mockReturnValue(new Promise(() => {}));
    render(<FiscalForm source={source} draft={null} />);
    fill();
    await calculate();
    const button = screen.getByRole('button', { name: 'Guardar borrador' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mock.save).toHaveBeenCalledTimes(1);
  });
});
describe('Fiscal permissions and read paths', () => {
  it('disables list/source queries without the necessary permissions', () => {
    mock.permissions.clear();
    render(
      <>
        <FiscalListPage />
        <FiscalNewPage />
        <FiscalPreparePage />
      </>,
    );
    expect(mock.list).toHaveBeenCalledWith(1, false);
    expect(mock.sales).toHaveBeenCalledWith(1, false);
    expect(mock.source).toHaveBeenCalledWith('sale-a', false);
    expect(mock.bySale).toHaveBeenCalledWith('sale-a', false);
    expect(screen.queryByRole('link', { name: 'Preparar desde una venta' })).toBeNull();
  });
  it('supports fiscal read-only access without sales read or create permission', () => {
    mock.permissions = new Set(['sales.invoices.read']);
    render(<FiscalDetailPage />);
    expect(mock.detail).toHaveBeenCalledWith('draft-a', true);
    expect(screen.getByText(/Sin validez fiscal/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Continuar preparación' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Emitir/ })).toBeNull();
  });
  it('shows query failure instead of claiming there are no drafts', () => {
    mock.listError = true;
    render(<FiscalListPage />);
    expect(screen.getByRole('alert').textContent).toBe('Sin conexión');
    expect(screen.queryByText('Todavía no hay borradores fiscales.')).toBeNull();
  });
});

describe('Homologation status list', () => {
  it.each([
    [null, 'Sin enviar'],
    ['SENDING', 'Envío pendiente de confirmar'],
    ['UNKNOWN', 'Resultado desconocido'],
    ['AUTHORIZED', 'Autorizado en pruebas'],
    ['REJECTED', 'Rechazado en pruebas'],
  ])('shows the persisted latest status %s and test number', (status, label) => {
    mock.listItems = [
      {
        ...draft,
        authorization: status === null ? null : { status, pointOfSale: 3, voucherType: 6, voucherNumber: 42 },
      },
    ];
    render(<FiscalListPage />);
    expect(screen.getByRole('heading', { name: 'Comprobantes de prueba' })).toBeTruthy();
    expect(screen.getByText(label!)).toBeTruthy();
    expect(screen.getByText('Homologación de ARCA · Sin validez fiscal')).toBeTruthy();
    if (status) expect(screen.getByText('00003-00000042')).toBeTruthy();
    else expect(screen.queryByText('00003-00000042')).toBeNull();
    const link = screen.getByRole('link', {
      name: status === 'SENDING' || status === 'UNKNOWN' ? 'Consultar resultado' : 'Ver detalle',
    });
    expect(link.getAttribute('href')).toBe('/facturas-fiscales/draft-a');
    expect(mock.save).not.toHaveBeenCalled();
  });
  it('never interprets a missing status field as unsent', () => {
    mock.listItems = [{ ...draft, creditNote: null }];
    render(<FiscalListPage />);
    expect(screen.getByText('Datos no disponibles')).toBeTruthy();
    expect(screen.queryByText('Sin enviar')).toBeNull();
  });
  it('hides cached status and links when a background request fails', () => {
    mock.listItems = [
      {
        ...draft,
        authorization: { status: 'AUTHORIZED', pointOfSale: 3, voucherNumber: 42, voucherType: 6 },
      },
    ];
    const view = render(<FiscalListPage />);
    expect(screen.getByText('Autorizado en pruebas')).toBeTruthy();
    mock.listError = true;
    view.rerender(<FiscalListPage />);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByText('Autorizado en pruebas')).toBeNull();
    expect(screen.queryByText('00003-00000042')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Ver detalle' })).toBeNull();
  });
  it('allows read-only operators to inspect pending results without preparation actions', () => {
    mock.permissions = new Set(['sales.invoices.read']);
    mock.listItems = [
      { ...draft, authorization: { status: 'UNKNOWN', pointOfSale: 3, voucherNumber: 42, voucherType: 6 } },
    ];
    render(<FiscalListPage />);
    expect(mock.list).toHaveBeenCalledWith(1, true);
    expect(screen.getByRole('link', { name: 'Consultar resultado' }).getAttribute('href')).toBe(
      '/facturas-fiscales/draft-a',
    );
    expect(screen.queryByRole('link', { name: 'Preparar desde una venta' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Autorizar|Consultar/ })).toBeNull();
  });
});

describe('Credit-note status in the homologation list', () => {
  const invoiceAuthorization = { status: 'AUTHORIZED', pointOfSale: 3, voucherType: 6, voucherNumber: 42 };
  it.each([
    [null, 'Nota preparada'],
    ['SENDING', 'Envío de NC pendiente'],
    ['UNKNOWN', 'Resultado de NC desconocido'],
    ['AUTHORIZED', 'NC autorizada en pruebas'],
    ['REJECTED', 'NC rechazada en pruebas'],
  ])('shows the persisted NC state %s and its own number separately from the invoice', (status, label) => {
    mock.listItems = [
      {
        ...draft,
        authorization: invoiceAuthorization,
        creditNote: {
          id: 'credit-a',
          authorization:
            status === null ? null : { status, pointOfSale: 3, voucherType: 8, voucherNumber: 7 },
        },
      },
    ];
    render(<FiscalListPage />);
    expect(screen.getByRole('columnheader', { name: 'Nota de crédito' })).toBeTruthy();
    expect(screen.getByText(label!)).toBeTruthy();
    expect(screen.getByText('00003-00000042')).toBeTruthy();
    if (status) expect(screen.getByText('NC 00003-00000007 · Tipo 8')).toBeTruthy();
    else expect(screen.queryByText('NC 00003-00000007 · Tipo 8')).toBeNull();
    const pending = status === 'SENDING' || status === 'UNKNOWN';
    const link = screen.getByRole('link', {
      name: pending ? 'Consultar resultado de NC' : 'Ver nota de crédito',
    });
    expect(link.getAttribute('href')).toBe('/facturas-fiscales/draft-a#nota-de-credito');
    expect(screen.getByRole('link', { name: 'Ver detalle' }).getAttribute('href')).toBe(
      '/facturas-fiscales/draft-a',
    );
    expect(mock.authorize).not.toHaveBeenCalled();
    expect(mock.reconcile).not.toHaveBeenCalled();
    expect(mock.save).not.toHaveBeenCalled();
  });
  it('distinguishes no note from missing data in an older cached list response', () => {
    mock.listItems = [
      { ...draft, authorization: invoiceAuthorization, creditNote: null },
      {
        ...draft,
        id: 'cached',
        source: { ...source, saleNumber: 'VTA-CACHED' },
        authorization: invoiceAuthorization,
      },
      {
        ...draft,
        id: 'partial',
        source: { ...source, saleNumber: 'VTA-PARTIAL' },
        authorization: invoiceAuthorization,
        creditNote: { id: 'partial-note' },
      },
    ];
    render(<FiscalListPage />);
    const noNote = within(screen.getByText('VTA-001').closest('tr')!);
    expect(noNote.getByText('Sin nota')).toBeTruthy();
    expect(noNote.queryByRole('link', { name: 'Ver nota de crédito' })).toBeNull();
    const cached = within(screen.getByText('VTA-CACHED').closest('tr')!);
    expect(cached.getByText('Datos no disponibles')).toBeTruthy();
    expect(cached.queryByText('Sin nota')).toBeNull();
    expect(cached.queryByText('Nota preparada')).toBeNull();
    expect(cached.queryByRole('link', { name: 'Ver nota de crédito' })).toBeNull();
    const partial = within(screen.getByText('VTA-PARTIAL').closest('tr')!);
    expect(partial.getByText('Datos no disponibles')).toBeTruthy();
    expect(partial.queryByText('Nota preparada')).toBeNull();
  });
  it('hides cached note state, number and links after a failed background refresh', () => {
    mock.listItems = [
      {
        ...draft,
        authorization: invoiceAuthorization,
        creditNote: {
          id: 'credit-a',
          authorization: { status: 'UNKNOWN', pointOfSale: 3, voucherType: 8, voucherNumber: 7 },
        },
      },
    ];
    const view = render(<FiscalListPage />);
    expect(screen.getByText('Resultado de NC desconocido')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Consultar resultado de NC' })).toBeTruthy();
    mock.listError = true;
    view.rerender(<FiscalListPage />);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByText('Resultado de NC desconocido')).toBeNull();
    expect(screen.queryByText('NC 00003-00000007 · Tipo 8')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Consultar resultado de NC' })).toBeNull();
  });
  it('lets invoice-read-only users open the note without send or consult mutations', () => {
    mock.permissions = new Set(['sales.invoices.read']);
    mock.listItems = [
      {
        ...draft,
        authorization: invoiceAuthorization,
        creditNote: {
          id: 'credit-a',
          authorization: { status: 'SENDING', pointOfSale: 3, voucherType: 8, voucherNumber: 7 },
        },
      },
    ];
    render(<FiscalListPage />);
    expect(mock.list).toHaveBeenCalledWith(1, true);
    expect(screen.getByRole('link', { name: 'Consultar resultado de NC' }).getAttribute('href')).toBe(
      '/facturas-fiscales/draft-a#nota-de-credito',
    );
    expect(screen.queryByRole('link', { name: 'Preparar desde una venta' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Autorizar|Consultar/ })).toBeNull();
    expect(mock.authorize).not.toHaveBeenCalled();
    expect(mock.reconcile).not.toHaveBeenCalled();
  });
  it('does not expose cached notes when invoice-read permission is absent', () => {
    mock.permissions = new Set(['sales.invoices.create']);
    mock.listItems = [
      {
        ...draft,
        authorization: invoiceAuthorization,
        creditNote: {
          id: 'credit-a',
          authorization: { status: 'AUTHORIZED', pointOfSale: 3, voucherType: 8, voucherNumber: 7 },
        },
      },
    ];
    render(<FiscalListPage />);
    expect(mock.list).toHaveBeenCalledWith(1, false);
    expect(screen.queryByText('NC autorizada en pruebas')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Ver nota de crédito' })).toBeNull();
  });
});
