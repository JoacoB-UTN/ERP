import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { FiscalAuthorizationDto, FiscalDraftDto } from '@erp/shared';
import { FiscalTestPrint } from './test-print';
const draft = {
  id: 'draft',
  revision: 2,
  invoiceType: 'A',
  source: {
    issuer: { legalName: '<script>test</script>', taxId: '20123456786' },
    recipient: {
      legalName: 'Cliente de prueba',
      taxId: '20123456786',
      taxCondition: 'RESPONSABLE_INSCRIPTO',
    },
    saleNumber: 'V-123',
  },
  lines: [
    {
      salesLineId: 'line',
      description: 'Producto de prueba',
      quantity: '2',
      treatment: 'VAT_21',
      finalAmount: '1234567890123.45',
    },
  ],
  totals: {
    netAmount: '100',
    vatAmount: '21',
    exemptAmount: '0',
    notTaxedAmount: '0',
    finalAmount: '1234567890123.45',
  },
} as FiscalDraftDto;
const authorization: FiscalAuthorizationDto = {
  id: 'attempt',
  draftId: 'draft',
  draftRevision: 2,
  environment: 'HOMOLOGATION',
  status: 'AUTHORIZED',
  pointOfSale: 12,
  voucherType: 1,
  voucherNumber: 42,
  cae: '12345678901234',
  expiresAt: '20261020',
  message: 'Autorizado',
  createdAt: '',
  updatedAt: '',
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('prints saved amounts, escaped identity and test CAE with visible repeated disclaimers', () => {
  const print = vi.spyOn(window, 'print').mockImplementation(() => {
    expect(document.querySelectorAll('[data-fiscal-print-selected]')).toHaveLength(1);
    expect(document.querySelector('[data-fiscal-print-selected]')!.getAttribute('aria-label')).toBe(
      'Comprobante de homologación',
    );
  });
  render(<FiscalTestPrint draft={draft} authorization={authorization} canPrint={() => true} />);
  const sheet = document.querySelector('[data-fiscal-test-print]')!;
  expect(sheet.textContent).toContain('00012-00000042');
  expect(sheet.textContent).toContain('1.234.567.890.123,45 ARS');
  expect(sheet.textContent).toContain('20/10/2026');
  expect(sheet.textContent).toContain('12345678901234');
  expect(sheet.textContent).toContain('<script>test</script>');
  expect(sheet.querySelector('script')).toBeNull();
  expect(sheet.querySelector('thead')!.textContent).toContain('SIN VALIDEZ FISCAL');
  expect(sheet.querySelectorAll('.warning')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'Imprimir comprobante de prueba' }));
  expect(print).toHaveBeenCalledOnce();
  fireEvent(window, new Event('afterprint'));
  expect(document.querySelector('[data-fiscal-print-selected]')).toBeNull();
});
it.each(['UNKNOWN', 'SENDING', 'REJECTED'] as const)('does not expose a printable sheet for %s', (status) => {
  render(
    <FiscalTestPrint draft={draft} authorization={{ ...authorization, status }} canPrint={() => true} />,
  );
  expect(document.querySelector('[data-fiscal-test-print]')).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
});
it.each([
  { draftId: 'other' },
  { draftRevision: 3 },
  { voucherType: 6 },
  { cae: null },
  { expiresAt: null },
  { environment: 'PRODUCTION' },
])('refuses a mismatched or incomplete authorization %j', (change) => {
  render(
    <FiscalTestPrint
      draft={draft}
      authorization={{ ...authorization, ...change } as FiscalAuthorizationDto}
      canPrint={() => true}
    />,
  );
  expect(screen.queryByRole('button')).toBeNull();
});
it('checks company again at click time and removes the print sheet on unmount', () => {
  const print = vi.spyOn(window, 'print').mockImplementation(() => {});
  let sameCompany = true;
  const view = render(
    <FiscalTestPrint draft={draft} authorization={authorization} canPrint={() => sameCompany} />,
  );
  sameCompany = false;
  fireEvent.click(screen.getByRole('button', { name: 'Imprimir comprobante de prueba' }));
  expect(print).not.toHaveBeenCalled();
  view.unmount();
  expect(document.querySelector('[data-fiscal-test-print]')).toBeNull();
});

it.each([
  { documentType: 'DNI', taxId: '12345678', label: 'DNI' },
  { documentType: 'CUIT', taxId: '20123456786', label: 'CUIT' },
  { documentType: undefined, taxId: '20123456786', label: 'Documento (tipo no registrado)' },
  { documentType: undefined, taxId: '12345678', label: 'Documento (tipo no registrado)' },
  { documentType: null, taxId: '12345678', label: 'Documento (tipo sin definir)' },
] as const)(
  'prints invoice B with its saved document label and number (%j)',
  ({ documentType, taxId, label }) => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(
      <FiscalTestPrint
        draft={{
          ...draft,
          invoiceType: 'B',
          source: {
            ...draft.source,
            recipient: { ...draft.source.recipient, documentType, taxId, taxCondition: 'CONSUMIDOR_FINAL' },
          },
        }}
        authorization={{ ...authorization, voucherType: 6 }}
        canPrint={() => true}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir comprobante de prueba' }));
    const sheet = document.querySelector('[data-fiscal-print-selected]')!;
    expect(sheet.textContent).toContain('Comprobante de homologación · B');
    expect(sheet.textContent).toContain(`Receptor: Cliente de prueba · ${label}: ${taxId}`);
    expect(sheet.textContent).toContain('Emisor: <script>test</script> · CUIT: 20123456786');
    expect(sheet.textContent).toContain('Condición de IVA del receptor: Consumidor Final');
    expect(sheet.textContent).toContain('SIN VALIDEZ FISCAL');
    expect(print).toHaveBeenCalledOnce();
  },
);
