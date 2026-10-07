import type { FiscalPreview, FiscalTaxTreatment } from '@erp/shared';
import { buildHomologationRequest, validFiscalDate } from './fiscal-request';
import { calculateFiscalBreakdown } from './fiscal-calculation';
function preview(
  amounts = ['121.00'],
  treatments: FiscalTaxTreatment[] = ['VAT_21'],
  invoiceType: 'A' | 'B' | 'C' = 'A',
): FiscalPreview {
  const lines = amounts.map((finalAmount, i) => ({
    salesLineId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    description: 'Item',
    quantity: '1',
    finalAmount,
  }));
  const total = amounts.length === 1 ? amounts[0] : '0.06';
  const input = {
    invoiceType,
    amountInterpretation: 'FINAL_AMOUNTS_INCLUDE_VAT' as const,
    lines: lines.map((line, i) => ({
      salesLineId: line.salesLineId,
      treatment: treatments[i],
    })),
  };
  return {
    ...calculateFiscalBreakdown(lines, total, input),
    source: {
      saleId: 'sale',
      saleNumber: 'V1',
      currencyCode: 'ARS',
      total,
      issuer: { legalName: 'Emisor', taxId: '20-12345678-6' },
      recipient: {
        legalName: 'Receptor',
        taxId: '20-12345678-6',
        taxCondition: 'RESPONSABLE_INSCRIPTO',
      },
      lines,
    },
    invoiceType,
    amountInterpretation: input.amountInterpretation,
    authorizationAvailable: false,
    pendingRequirements: [],
  };
}
const settings = { vatCondition: 'RESPONSABLE_INSCRIPTO', testPointOfSale: 1 };
describe('Homologation request builder', () => {
  it('uses saved totals and groups VAT without changing the commercial payable', () => {
    const source = preview();
    const before = JSON.stringify(source);
    expect(
      buildHomologationRequest(source, settings, '20261004'),
    ).toMatchObject({
      issuerCuit: '20123456786',
      recipientDocumentType: 80,
      recipientDocumentNumber: '20123456786',
      recipientVatConditionId: 1,
      voucherType: 1,
      total: '121.00',
      net: '100.00',
      vat: '21.00',
      iva: [{ id: 5, base: '100.00', amount: '21.00' }],
    });
    expect(JSON.stringify(source)).toBe(before);
  });
  it('accepts JSONB key reordering', () => {
    const p = preview();
    p.totals = {
      ...Object.fromEntries(Object.entries(p.totals).reverse()),
    } as FiscalPreview['totals'];
    expect(buildHomologationRequest(p, settings, '20261004').total).toBe(
      '121.00',
    );
  });
  it.each(['MONOTRIBUTO', 'EXENTO'])(
    'builds C for issuer %s',
    (vatCondition) => {
      const p = preview(['121.00'], ['C_NO_VAT'], 'C');
      expect(
        buildHomologationRequest(p, { ...settings, vatCondition }, '20261004'),
      ).toMatchObject({ voucherType: 11, net: '121.00', vat: '0.00', iva: [] });
    },
  );
  it.each(['EXENTO', 'CONSUMIDOR_FINAL'])(
    'builds B for recipient %s',
    (taxCondition) => {
      const p = preview(['121.00'], ['VAT_21'], 'B');
      p.source.recipient.taxCondition = taxCondition;
      expect(
        buildHomologationRequest(p, settings, '20261004').voucherType,
      ).toBe(6);
    },
  );
  it('allows A to monotributista', () => {
    const p = preview();
    p.source.recipient.taxCondition = 'MONOTRIBUTO';
    expect(
      buildHomologationRequest(p, settings, '20261004').recipientVatConditionId,
    ).toBe(6);
  });
  it('builds B for an explicitly saved DNI consumer without a fabricated CUIT', () => {
    const p = preview(['121.00'], ['VAT_21'], 'B');
    p.source.recipient = {
      legalName: 'Consumidor',
      documentType: 'DNI',
      taxId: '0012345678',
      taxCondition: 'CONSUMIDOR_FINAL',
    };
    const before = JSON.stringify(p);
    const result = buildHomologationRequest(p, settings, '20261004');
    expect(result).toMatchObject({
      recipientDocumentType: 96,
      recipientDocumentNumber: '12345678',
      recipientVatConditionId: 5,
      voucherType: 6,
      total: '121.00',
      net: '100.00',
      vat: '21.00',
      iva: [{ id: 5, base: '100.00', amount: '21.00' }],
    });
    expect(result).not.toHaveProperty('recipientCuit');
    expect(JSON.stringify(p)).toBe(before);
    delete p.source.recipient.documentType;
    expect(() => buildHomologationRequest(p, settings, '20261004')).toThrow();
  });
  it.each(['A', 'C'] as const)(
    'rejects DNI for %s even with a known issuer and valid amounts',
    (invoiceType) => {
      const p = preview(
        ['121.00'],
        [invoiceType === 'C' ? 'C_NO_VAT' : 'VAT_21'],
        invoiceType,
      );
      p.source.recipient = {
        legalName: 'Consumidor',
        documentType: 'DNI',
        taxId: '12345678',
        taxCondition: 'CONSUMIDOR_FINAL',
      };
      expect(() =>
        buildHomologationRequest(
          p,
          {
            ...settings,
            vatCondition:
              invoiceType === 'C' ? 'MONOTRIBUTO' : 'RESPONSABLE_INSCRIPTO',
          },
          '20261004',
        ),
      ).toThrow();
    },
  );
  it.each(['UNKNOWN', 'NO_RESPONSABLE'])(
    'blocks unsupported recipient condition %s',
    (taxCondition) => {
      const p = preview();
      p.source.recipient.taxCondition = taxCondition;
      expect(() => buildHomologationRequest(p, settings, '20261004')).toThrow();
    },
  );
  it('rejects incompatible proposed class', () => {
    expect(() =>
      buildHomologationRequest(
        preview(['121.00'], ['VAT_21'], 'B'),
        settings,
        '20261004',
      ),
    ).toThrow();
  });
  it('rejects modified saved totals and modified line amounts', () => {
    const p = preview();
    p.totals.vatAmount = '20.00';
    expect(() => buildHomologationRequest(p, settings, '20261004')).toThrow();
    const q = preview();
    q.lines[0].netAmount = '99.00';
    expect(() => buildHomologationRequest(q, settings, '20261004')).toThrow();
  });
  it('rejects VAT aggregation rounding mismatches without changing cents', () => {
    expect(() =>
      buildHomologationRequest(
        preview(['0.03', '0.03'], ['VAT_21', 'VAT_21']),
        settings,
        '20261004',
      ),
    ).toThrow();
  });
  it.each([null, 0, 100000, 1.2])(
    'rejects invalid point of sale %s',
    (testPointOfSale) => {
      expect(() =>
        buildHomologationRequest(
          preview(),
          { ...settings, testPointOfSale },
          '20261004',
        ),
      ).toThrow();
    },
  );
  it('requires known issuer and valid CUIT checksums', () => {
    expect(() =>
      buildHomologationRequest(
        preview(),
        { ...settings, vatCondition: null },
        '20261004',
      ),
    ).toThrow();
    const p = preview();
    p.source.recipient.taxId = '20123456780';
    expect(() => buildHomologationRequest(p, settings, '20261004')).toThrow();
  });
  it.each(['20260229', '20261301', '20260100', 'x'])(
    'rejects invalid calendar date %s',
    (date) => expect(validFiscalDate(date)).toBe(false),
  );
});
