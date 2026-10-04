import type { FiscalCreditNoteSnapshot } from '@erp/shared';
import { buildCreditNoteRequest } from './fiscal-credit-note-request';

function snapshot(
  invoiceType: 'A' | 'B' | 'C' = 'A',
): FiscalCreditNoteSnapshot {
  const isC = invoiceType === 'C';
  const amounts = {
    total: '121.00',
    net: isC ? '121.00' : '100.00',
    vat: isC ? '0.00' : '21.00',
    exempt: '0.00',
    notTaxed: '0.00',
    iva: isC ? [] : [{ id: 5, base: '100.00', amount: '21.00' }],
  };
  return {
    original: {
      authorizationId: 'original',
      issuerCuit: '20123456786',
      pointOfSale: 1,
      voucherType: { A: 1, B: 6, C: 11 }[invoiceType],
      voucherNumber: 9,
      date: '20261004',
      cae: '12345678901234',
    },
    creditNoteType: ({ A: 3, B: 8, C: 13 } as const)[invoiceType],
    authorizedAmounts: amounts,
    invoice: {
      invoiceType,
      source: {
        saleId: 'sale',
        saleNumber: 'V1',
        currencyCode: 'ARS',
        total: '121.00',
        issuer: { legalName: 'Emisor', taxId: '20-12345678-6' },
        recipient: {
          legalName: 'Receptor',
          taxId: '20-12345678-6',
          taxCondition:
            invoiceType === 'B' ? 'CONSUMIDOR_FINAL' : 'RESPONSABLE_INSCRIPTO',
        },
        lines: [
          {
            salesLineId: 'line',
            description: 'Producto',
            quantity: '1',
            finalAmount: '121.00',
          },
        ],
      },
      lines: [
        {
          salesLineId: 'line',
          description: 'Producto',
          quantity: '1',
          finalAmount: '121.00',
          netAmount: amounts.net,
          vatAmount: amounts.vat,
          exemptAmount: amounts.exempt,
          notTaxedAmount: amounts.notTaxed,
          treatment: isC ? 'C_NO_VAT' : 'VAT_21',
        },
      ],
      totals: {
        finalAmount: amounts.total,
        netAmount: amounts.net,
        vatAmount: amounts.vat,
        exemptAmount: amounts.exempt,
        notTaxedAmount: amounts.notTaxed,
      },
    },
  };
}
describe('Total credit-note request builder', () => {
  it.each(['A', 'B', 'C'] as const)(
    'preserves frozen %s amounts and original association without mutating the snapshot',
    (type) => {
      const saved = snapshot(type);
      const before = JSON.stringify(saved);
      const result = buildCreditNoteRequest(saved, '20261005');
      expect(result).toEqual({
        ...saved.authorizedAmounts,
        issuerCuit: '20123456786',
        recipientCuit: '20123456786',
        recipientVatConditionId: type === 'B' ? 5 : 1,
        voucherType: saved.creditNoteType,
        pointOfSale: 1,
        date: '20261005',
        associated: {
          voucherType: saved.original.voucherType,
          pointOfSale: 1,
          voucherNumber: 9,
          issuerCuit: '20123456786',
          date: '20261004',
        },
      });
      expect(JSON.stringify(saved)).toBe(before);
      expect(result.iva).not.toBe(saved.authorizedAmounts.iva);
      if (result.iva.length)
        expect(result.iva[0]).not.toBe(saved.authorizedAmounts.iva[0]);
    },
  );
  it('keeps authorized decimal text exactly and adds with Decimal precision', () => {
    const saved = snapshot();
    saved.authorizedAmounts = {
      total: '0.30',
      net: '0.1',
      vat: '0.02',
      exempt: '0.18',
      notTaxed: '0.00',
      iva: [{ id: 5, base: '0.1', amount: '0.02' }],
    };
    saved.invoice.totals = {
      finalAmount: '0.30',
      netAmount: '0.10',
      vatAmount: '0.02',
      exemptAmount: '0.18',
      notTaxedAmount: '0.00',
    };
    saved.invoice.source.total = '0.3';
    // The previously authorized request is the fiscal amount source, not prices or line recalculation.
    expect(buildCreditNoteRequest(saved, '20261005')).toMatchObject(
      saved.authorizedAmounts,
    );
  });
  it.each([
    [
      'unknown class',
      (s: FiscalCreditNoteSnapshot) => {
        s.original.voucherType = 2;
      },
    ],
    [
      'wrong note class',
      (s: FiscalCreditNoteSnapshot) => {
        s.creditNoteType = 8;
      },
    ],
    [
      'different invoice class',
      (s: FiscalCreditNoteSnapshot) => {
        s.invoice.invoiceType = 'B';
      },
    ],
    [
      'invalid issuer',
      (s: FiscalCreditNoteSnapshot) => {
        s.original.issuerCuit = '20123456780';
      },
    ],
    [
      'different issuer',
      (s: FiscalCreditNoteSnapshot) => {
        s.invoice.source.issuer.taxId = '30712345671';
      },
    ],
    [
      'unidentified recipient',
      (s: FiscalCreditNoteSnapshot) => {
        s.invoice.source.recipient.taxId = null;
      },
    ],
    [
      'unknown recipient VAT',
      (s: FiscalCreditNoteSnapshot) => {
        s.invoice.source.recipient.taxCondition = 'UNKNOWN';
      },
    ],
    [
      'incompatible recipient VAT',
      (s: FiscalCreditNoteSnapshot) => {
        s.invoice.source.recipient.taxCondition = 'CONSUMIDOR_FINAL';
      },
    ],
    [
      'missing CAE',
      (s: FiscalCreditNoteSnapshot) => {
        s.original.cae = '';
      },
    ],
    [
      'invalid original date',
      (s: FiscalCreditNoteSnapshot) => {
        s.original.date = '20260230';
      },
    ],
    [
      'future original date',
      (s: FiscalCreditNoteSnapshot) => {
        s.original.date = '20261006';
      },
    ],
    [
      'invalid PV',
      (s: FiscalCreditNoteSnapshot) => {
        s.original.pointOfSale = 100000;
      },
    ],
    [
      'invalid original number',
      (s: FiscalCreditNoteSnapshot) => {
        s.original.voucherNumber = 0;
      },
    ],
    [
      'overlong original number',
      (s: FiscalCreditNoteSnapshot) => {
        s.original.voucherNumber = 100000000;
      },
    ],
    [
      'fractional original number',
      (s: FiscalCreditNoteSnapshot) => {
        s.original.voucherNumber = 1.2;
      },
    ],
    [
      'changed total',
      (s: FiscalCreditNoteSnapshot) => {
        s.authorizedAmounts.total = '120.00';
      },
    ],
    [
      'changed invoice payable',
      (s: FiscalCreditNoteSnapshot) => {
        s.invoice.totals.finalAmount = '120.00';
      },
    ],
    [
      'changed sale payable',
      (s: FiscalCreditNoteSnapshot) => {
        s.invoice.source.total = '120.00';
      },
    ],
    [
      'changed VAT groups',
      (s: FiscalCreditNoteSnapshot) => {
        s.authorizedAmounts.iva[0].amount = '20.00';
      },
    ],
    [
      'duplicate VAT group',
      (s: FiscalCreditNoteSnapshot) => {
        s.authorizedAmounts.iva.push(s.authorizedAmounts.iva[0]);
      },
    ],
    [
      'unsupported VAT group',
      (s: FiscalCreditNoteSnapshot) => {
        s.authorizedAmounts.iva[0].id = 9;
      },
    ],
    [
      'negative amount',
      (s: FiscalCreditNoteSnapshot) => {
        s.authorizedAmounts.net = '-100.00';
      },
    ],
    [
      'fractional cents',
      (s: FiscalCreditNoteSnapshot) => {
        s.authorizedAmounts.net = '100.001';
      },
    ],
    [
      'non-finite amount',
      (s: FiscalCreditNoteSnapshot) => {
        s.authorizedAmounts.total = 'NaN';
      },
    ],
  ] as const)('rejects %s', (_name, mutate) => {
    const saved = snapshot();
    mutate(saved);
    expect(() => buildCreditNoteRequest(saved, '20261005')).toThrow(
      'La nota de crédito',
    );
  });
  it('rejects zero total and VAT on a C note', () => {
    const saved = snapshot('C');
    saved.authorizedAmounts.iva = [{ id: 3, base: '121.00', amount: '0.00' }];
    expect(() => buildCreditNoteRequest(saved, '20261005')).toThrow();
    const zero = snapshot('C');
    zero.authorizedAmounts.total = zero.authorizedAmounts.net = '0.00';
    zero.invoice.source.total =
      zero.invoice.totals.finalAmount =
      zero.invoice.totals.netAmount =
        '0.00';
    expect(() => buildCreditNoteRequest(zero, '20261005')).toThrow();
  });
});
