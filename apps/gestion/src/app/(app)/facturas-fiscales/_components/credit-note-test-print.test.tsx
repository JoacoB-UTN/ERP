import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { FiscalAuthorizationDto, FiscalCreditNoteDraftDto, FiscalDraftDto } from '@erp/shared';
import { FiscalCreditNoteTestPrint } from './credit-note-test-print';
import { FiscalTestPrint } from './test-print';

const invoice = {
  id: 'invoice-draft',
  revision: 2,
  invoiceType: 'B',
  source: {
    issuer: { legalName: 'Emisor guardado', taxId: '20123456786' },
    recipient: { legalName: 'Receptor guardado', taxId: '20123456786', taxCondition: 'CONSUMIDOR_FINAL' },
    saleNumber: 'V-1',
  },
  lines: [
    {
      salesLineId: 'line',
      description: 'Producto original',
      quantity: '2',
      treatment: 'VAT_21',
      finalAmount: '1234567890123.45',
    },
  ],
  totals: {
    netAmount: '100.00',
    vatAmount: '21.00',
    exemptAmount: '0.00',
    notTaxedAmount: '0.00',
    finalAmount: '121.00',
  },
} as FiscalDraftDto;
const note = {
  id: 'note',
  revision: 3,
  environment: 'HOMOLOGATION',
  status: 'DRAFT',
  reason: '<script>Motivo guardado</script>',
  creditNoteType: 8,
  invoice,
  original: {
    authorizationId: 'invoice-attempt',
    issuerCuit: '20123456786',
    pointOfSale: 12,
    voucherType: 6,
    voucherNumber: 42,
    date: '20261004',
    cae: '98765432109876',
  },
  authorizedAmounts: {
    total: '1234567890123.45',
    net: '999999999999.99',
    vat: '1.00',
    exempt: '2.00',
    notTaxed: '3.00',
    iva: [],
  },
  createdAt: '',
  updatedAt: '',
} as FiscalCreditNoteDraftDto;
const authorization: FiscalAuthorizationDto = {
  id: 'note-attempt',
  draftId: 'note',
  draftRevision: 3,
  environment: 'HOMOLOGATION',
  status: 'AUTHORIZED',
  pointOfSale: 12,
  voucherType: 8,
  voucherNumber: 7,
  cae: '12345678901234',
  expiresAt: '20261020',
  message: '',
  createdAt: '',
  updatedAt: '',
};
const invoiceAuthorization: FiscalAuthorizationDto = {
  ...authorization,
  id: 'invoice-attempt',
  draftId: 'invoice-draft',
  draftRevision: 2,
  voucherType: 6,
  voucherNumber: 42,
  cae: '98765432109876',
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('prints the NC snapshot, saved reason, original reference and its own authorization without recalculation', () => {
  const print = vi.spyOn(window, 'print').mockImplementation(() => {});
  render(<FiscalCreditNoteTestPrint note={note} authorization={authorization} canPrint={() => true} />);
  const sheet = document.querySelector('[data-fiscal-test-print]')!;
  expect(sheet.textContent).toContain('Nota de crédito total de homologación · B');
  expect(sheet.textContent).toContain('Número de prueba: 00012-00000007');
  expect(sheet.textContent).toContain('tipo 6 · 00012-00000042');
  expect(sheet.textContent).toContain('Fecha del comprobante original: 04/10/2026');
  expect(sheet.textContent).toContain('Emisor guardado');
  expect(sheet.textContent).toContain('Receptor guardado');
  expect(sheet.textContent).toContain('<script>Motivo guardado</script>');
  expect(sheet.querySelector('script')).toBeNull();
  expect(sheet.textContent).toContain('Total: 1.234.567.890.123,45 ARS');
  expect(sheet.textContent).toContain('Neto: 999.999.999.999,99 ARS');
  expect(sheet.textContent).not.toContain('Total: 121,00 ARS');
  expect(sheet.textContent).toContain('CAE de prueba: 12345678901234');
  expect(sheet.textContent).not.toContain('98765432109876');
  expect(sheet.textContent).toContain('20/10/2026');
  expect(sheet.querySelector('thead')!.textContent).toContain('SIN VALIDEZ FISCAL');
  expect(sheet.querySelectorAll('.warning')).toHaveLength(2);
  expect(sheet.textContent).toContain('no devuelve dinero ni mercadería');
  fireEvent.click(screen.getByRole('button', { name: 'Imprimir nota de crédito de prueba' }));
  expect(print).toHaveBeenCalledOnce();
});

it('prints DNI invoice B and total NC B separately with the original frozen recipient', () => {
  const dniInvoice: FiscalDraftDto = {
    ...invoice,
    source: {
      ...invoice.source,
      recipient: { ...invoice.source.recipient, documentType: 'DNI', taxId: '00123456' },
    },
  };
  const printed: string[] = [];
  vi.spyOn(window, 'print').mockImplementation(() => {
    const sheets = document.querySelectorAll('[data-fiscal-print-selected]');
    expect(sheets).toHaveLength(1);
    const sheet = sheets[0];
    expect(sheet.textContent).toContain('Receptor: Receptor guardado · DNI: 00123456');
    expect(sheet.textContent).toContain('Emisor: Emisor guardado · CUIT: 20123456786');
    expect(sheet.textContent).toContain('Condición de IVA del receptor: Consumidor Final');
    expect(sheet.textContent).toContain('SIN VALIDEZ FISCAL');
    printed.push(sheet.getAttribute('aria-label')!);
  });
  render(
    <>
      <FiscalTestPrint draft={dniInvoice} authorization={invoiceAuthorization} canPrint={() => true} />
      <FiscalCreditNoteTestPrint
        note={{ ...note, invoice: dniInvoice }}
        authorization={authorization}
        canPrint={() => true}
      />
    </>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Imprimir nota de crédito de prueba' }));
  const ncSheet = document.querySelector('[data-fiscal-print-selected]')!;
  expect(ncSheet.textContent).toContain('CAE de prueba: 12345678901234');
  expect(ncSheet.textContent).toContain('tipo 6 · 00012-00000042');
  expect(ncSheet.textContent).toContain('Total: 1.234.567.890.123,45 ARS');
  fireEvent.click(screen.getByRole('button', { name: 'Imprimir comprobante de prueba' }));
  expect(printed).toEqual(['Nota de crédito total de homologación', 'Comprobante de homologación']);
  fireEvent(window, new Event('afterprint'));
  expect(document.querySelector('[data-fiscal-print-selected]')).toBeNull();
});

it.each(['UNKNOWN', 'SENDING', 'REJECTED'] as const)('does not offer a printable NC for %s', (status) => {
  render(
    <FiscalCreditNoteTestPrint
      note={note}
      authorization={{ ...authorization, status }}
      canPrint={() => true}
    />,
  );
  expect(document.querySelector('[data-fiscal-test-print]')).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
});

it.each([
  { draftId: 'other' },
  { draftRevision: 4 },
  { voucherType: 3 },
  { pointOfSale: 13 },
  { cae: null },
  { cae: 'bad' },
  { expiresAt: null },
  { expiresAt: 'bad' },
  { environment: 'PRODUCTION' },
])('refuses a mismatched or incomplete NC authorization %j', (change) => {
  render(
    <FiscalCreditNoteTestPrint
      note={note}
      authorization={{ ...authorization, ...change } as FiscalAuthorizationDto}
      canPrint={() => true}
    />,
  );
  expect(document.querySelector('[data-fiscal-test-print]')).toBeNull();
});

it.each([
  { environment: 'PRODUCTION' },
  { original: { ...note.original, voucherType: 1 } },
  { invoice: { ...note.invoice, invoiceType: 'C' } },
])('refuses an inconsistent saved NC snapshot %j', (change) => {
  render(
    <FiscalCreditNoteTestPrint
      note={{ ...note, ...change } as FiscalCreditNoteDraftDto}
      authorization={authorization}
      canPrint={() => true}
    />,
  );
  expect(document.querySelector('[data-fiscal-test-print]')).toBeNull();
});

it('selects only the requested sheet when invoice and NC are mounted together', () => {
  const printed: string[] = [];
  vi.spyOn(window, 'print').mockImplementation(() => {
    const selected = document.querySelectorAll('[data-fiscal-test-print][data-fiscal-print-selected]');
    expect(selected).toHaveLength(1);
    printed.push(selected[0].getAttribute('aria-label')!);
  });
  render(
    <>
      <FiscalTestPrint draft={invoice} authorization={invoiceAuthorization} canPrint={() => true} />
      <FiscalCreditNoteTestPrint note={note} authorization={authorization} canPrint={() => true} />
    </>,
  );
  expect(document.querySelectorAll('[data-fiscal-test-print]')).toHaveLength(2);
  expect(document.querySelectorAll('[data-fiscal-print-selected]')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Imprimir nota de crédito de prueba' }));
  fireEvent.click(screen.getByRole('button', { name: 'Imprimir comprobante de prueba' }));
  expect(printed).toEqual(['Nota de crédito total de homologación', 'Comprobante de homologación']);
  // A non-blocking print implementation still needs the selected sheet after print() returns.
  expect(document.querySelectorAll('[data-fiscal-print-selected]')).toHaveLength(1);
  fireEvent(window, new Event('afterprint'));
  expect(document.querySelectorAll('[data-fiscal-print-selected]')).toHaveLength(0);
  const styles = document.querySelector('[data-fiscal-test-print] style')!.textContent!;
  expect(styles).toContain('[data-fiscal-test-print] { display: none !important; }');
  expect(styles).toContain(
    '[data-fiscal-test-print][data-fiscal-print-selected] { display: block !important;',
  );
});

it('prevents printing after a company change and clears any selected sheet before browser printing', () => {
  const print = vi.spyOn(window, 'print').mockImplementation(() => {});
  let sameCompany = true;
  const view = render(
    <FiscalCreditNoteTestPrint note={note} authorization={authorization} canPrint={() => sameCompany} />,
  );
  const button = screen.getByRole('button', { name: 'Imprimir nota de crédito de prueba' });
  fireEvent.click(button);
  expect(document.querySelectorAll('[data-fiscal-print-selected]')).toHaveLength(1);
  sameCompany = false;
  fireEvent.click(button);
  expect(print).toHaveBeenCalledOnce();
  fireEvent(window, new Event('beforeprint'));
  expect(document.querySelectorAll('[data-fiscal-print-selected]')).toHaveLength(0);
  view.unmount();
  expect(document.querySelector('[data-fiscal-test-print]')).toBeNull();
});

it('keeps the same document selected across benign rerenders until afterprint', () => {
  vi.spyOn(window, 'print').mockImplementation(() => {});
  const view = render(
    <FiscalCreditNoteTestPrint note={note} authorization={authorization} canPrint={() => true} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Imprimir nota de crédito de prueba' }));
  view.rerender(
    <FiscalCreditNoteTestPrint
      note={{ ...note }}
      authorization={{ ...authorization }}
      canPrint={() => true}
    />,
  );
  expect(document.querySelectorAll('[data-fiscal-print-selected]')).toHaveLength(1);
  fireEvent(window, new Event('afterprint'));
  expect(document.querySelector('[data-fiscal-print-selected]')).toBeNull();
});

it.each(['authorization', 'revision', 'access'])(
  'clears the selection when document identity or access changes (%s)',
  (change) => {
    vi.spyOn(window, 'print').mockImplementation(() => {});
    const view = render(
      <FiscalCreditNoteTestPrint note={note} authorization={authorization} canPrint={() => true} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir nota de crédito de prueba' }));
    view.rerender(
      <FiscalCreditNoteTestPrint
        note={change === 'revision' ? { ...note, revision: 4 } : note}
        authorization={
          change === 'authorization'
            ? { ...authorization, id: 'another' }
            : change === 'revision'
              ? { ...authorization, draftRevision: 4 }
              : authorization
        }
        canPrint={() => change !== 'access'}
      />,
    );
    expect(document.querySelector('[data-fiscal-print-selected]')).toBeNull();
  },
);

it('clears selection and shows a retryable message when the print dialog cannot open', () => {
  const print = vi
    .spyOn(window, 'print')
    .mockImplementationOnce(() => {
      throw new Error('Unavailable');
    })
    .mockImplementation(() => {});
  render(<FiscalCreditNoteTestPrint note={note} authorization={authorization} canPrint={() => true} />);
  const button = screen.getByRole('button', { name: 'Imprimir nota de crédito de prueba' });
  fireEvent.click(button);
  expect(screen.getByRole('alert').textContent).toContain('No se pudo abrir la impresión');
  expect(document.querySelectorAll('[data-fiscal-print-selected]')).toHaveLength(0);
  fireEvent.click(button);
  expect(print).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('retains every saved row and repeated print warnings for long notes', () => {
  const lines = Array.from({ length: 120 }, (_, index) => ({
    ...invoice.lines[0],
    salesLineId: `line-${index}`,
    description: `Producto ${index}: ${'descripción extensa '.repeat(10)}`,
  }));
  render(
    <FiscalCreditNoteTestPrint
      note={{ ...note, invoice: { ...note.invoice, lines } }}
      authorization={authorization}
      canPrint={() => true}
    />,
  );
  const sheet = document.querySelector('[data-fiscal-test-print]')!;
  expect(sheet.querySelectorAll('tbody tr')).toHaveLength(120);
  expect(sheet.querySelector('thead')!.textContent).toContain('SIN VALIDEZ FISCAL');
  expect(sheet.querySelector('tfoot')!.textContent).toContain('Sin validez fiscal');
  expect(sheet.querySelector('style')!.textContent).toContain('display: table-header-group');
});
