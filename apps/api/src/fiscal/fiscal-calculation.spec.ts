import { BadRequestException } from '@nestjs/common';
import type {
  FiscalDraftInput,
  FiscalSourceLine,
  FiscalTaxTreatment,
} from '@erp/shared';
import { Prisma } from '../generated/prisma/client';
import { calculateFiscalBreakdown } from './fiscal-calculation';

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture(
  amounts: string[],
  treatments: FiscalTaxTreatment[],
  invoiceType: 'A' | 'B' | 'C' = 'A',
) {
  const lines: FiscalSourceLine[] = amounts.map((finalAmount, i) => ({
    salesLineId: id(i),
    description: 'Snapshot',
    quantity: '1',
    finalAmount,
  }));
  const input: FiscalDraftInput = {
    invoiceType,
    amountInterpretation: 'FINAL_AMOUNTS_INCLUDE_VAT',
    lines: treatments.map((treatment, i) => ({
      salesLineId: id(i),
      treatment,
    })),
  };
  return { lines, input };
}
describe('Fiscal draft Decimal breakdown', () => {
  it.each(['A', 'B'] as const)(
    'decomposes gross 121 for class %s without increasing the payable',
    (type) => {
      const { lines, input } = fixture(['121.0000'], ['VAT_21'], type);
      expect(calculateFiscalBreakdown(lines, '121', input).totals).toEqual({
        netAmount: '100.00',
        vatAmount: '21.00',
        exemptAmount: '0.00',
        notTaxedAmount: '0.00',
        finalAmount: '121.00',
      });
      expect(lines[0].finalAmount).toBe('121.0000');
    },
  );
  it('reconciles mixed rates, exemption and non-taxed items exactly', () => {
    const { lines, input } = fixture(
      ['110.50', '127', '20', '15', '10'],
      ['VAT_10_5', 'VAT_27', 'VAT_0', 'EXEMPT', 'NOT_TAXED'],
    );
    expect(calculateFiscalBreakdown(lines, '282.50', input).totals).toEqual({
      netAmount: '220.00',
      vatAmount: '37.50',
      exemptAmount: '15.00',
      notTaxedAmount: '10.00',
      finalAmount: '282.50',
    });
  });
  it('uses the entire class C amount as subtotal and accepts zero', () => {
    const { lines, input } = fixture(
      ['121', '0'],
      ['C_NO_VAT', 'C_NO_VAT'],
      'C',
    );
    expect(calculateFiscalBreakdown(lines, '121', input).totals).toEqual({
      netAmount: '121.00',
      vatAmount: '0.00',
      exemptAmount: '0.00',
      notTaxedAmount: '0.00',
      finalAmount: '121.00',
    });
  });
  it('conserves cents at rounding boundaries and large database amounts', () => {
    const { lines, input } = fixture(
      ['0.03', '999999999999999.99'],
      ['VAT_21', 'VAT_27'],
    );
    const result = calculateFiscalBreakdown(
      lines,
      '1000000000000000.02',
      input,
    );
    for (const line of result.lines)
      expect(
        new Prisma.Decimal(line.netAmount)
          .plus(line.vatAmount)
          .eq(line.finalAmount),
      ).toBe(true);
    expect(result.lines[0].netAmount).toBe('0.02');
    expect(result.lines[0].vatAmount).toBe('0.01');
    expect(result.totals.finalAmount).toBe('1000000000000000.02');
  });
  it.each(['0.0001', '-1', 'NaN', 'Infinity', '1e2', ' 1', ''])(
    'rejects unsafe amount %s rather than rounding it',
    (amount) => {
      const { lines, input } = fixture([amount], ['VAT_21']);
      expect(() => calculateFiscalBreakdown(lines, amount, input)).toThrow(
        BadRequestException,
      );
    },
  );
  it('rejects an inconsistent source total', () => {
    const { lines, input } = fixture(['121'], ['VAT_21']);
    expect(() => calculateFiscalBreakdown(lines, '122', input)).toThrow(
      BadRequestException,
    );
  });
  it.each([
    'missing',
    'duplicate',
    'foreign',
    'duplicate-source',
    'unknown-field',
    'wrong-class',
    'empty',
  ] as const)('rejects %s selections', (scenario) => {
    const { lines, input } = fixture(['121', '121'], ['VAT_21', 'VAT_21']);
    if (scenario === 'missing') input.lines.pop();
    if (scenario === 'duplicate') input.lines[1] = input.lines[0];
    if (scenario === 'foreign') input.lines[0].salesLineId = id(99);
    if (scenario === 'duplicate-source') lines[1] = lines[0];
    if (scenario === 'unknown-field') Object.assign(input, { total: '0' });
    if (scenario === 'wrong-class') input.invoiceType = 'C';
    if (scenario === 'empty') lines.length = 0;
    expect(() => calculateFiscalBreakdown(lines, '242', input)).toThrow(
      BadRequestException,
    );
  });
  it('rejects class C treatment on A/B', () => {
    const { lines, input } = fixture(['121'], ['C_NO_VAT']);
    expect(() => calculateFiscalBreakdown(lines, '121', input)).toThrow(
      BadRequestException,
    );
  });
});
