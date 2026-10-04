import { BadRequestException } from '@nestjs/common';
import { isValidCuitChecksum, type FiscalPreview } from '@erp/shared';
import { Prisma } from '../generated/prisma/client';
import { calculateFiscalBreakdown } from './fiscal-calculation';

export interface ArcaInvoiceRequest {
  issuerCuit: string;
  pointOfSale: number;
  voucherType: 1 | 6 | 11;
  voucherNumber: number;
  date: string;
  recipientCuit: string;
  recipientVatConditionId: number;
  total: string;
  net: string;
  vat: string;
  exempt: string;
  notTaxed: string;
  iva: { id: number; base: string; amount: string }[];
}

const CONDITIONS: Record<string, number> = {
  RESPONSABLE_INSCRIPTO: 1,
  EXENTO: 4,
  CONSUMIDOR_FINAL: 5,
  MONOTRIBUTO: 6,
};
const RATES: Record<string, { id: number; rate: string }> = {
  VAT_0: { id: 3, rate: '0' },
  VAT_10_5: { id: 4, rate: '0.105' },
  VAT_21: { id: 5, rate: '0.21' },
  VAT_27: { id: 6, rate: '0.27' },
};
function invalid(): never {
  throw new BadRequestException(
    'El borrador no reúne las condiciones de este circuito de homologación. Revisá CUIT, condición de IVA, clase e importes.',
  );
}
export function validFiscalDate(value: string): boolean {
  if (!/^\d{8}$/.test(value)) return false;
  const date = new Date(
    `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00Z`,
  );
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10).replaceAll('-', '') === value
  );
}
export function buildHomologationRequest(
  preview: FiscalPreview,
  settings: { vatCondition: string | null; testPointOfSale: number | null },
  date: string,
): Omit<ArcaInvoiceRequest, 'voucherNumber'> {
  const issuerCuit = preview.source.issuer.taxId.replace(/[-\s]/g, '');
  const recipientCuit = (preview.source.recipient.taxId ?? '').replace(
    /[-\s]/g,
    '',
  );
  const recipientVatConditionId =
    CONDITIONS[preview.source.recipient.taxCondition];
  if (
    !/^\d{11}$/.test(issuerCuit) ||
    !isValidCuitChecksum(issuerCuit) ||
    !/^\d{11}$/.test(recipientCuit) ||
    !isValidCuitChecksum(recipientCuit) ||
    !recipientVatConditionId ||
    !validFiscalDate(date) ||
    preview.source.currencyCode !== 'ARS' ||
    !Number.isInteger(settings.testPointOfSale) ||
    settings.testPointOfSale! < 1 ||
    settings.testPointOfSale! > 99999
  )
    invalid();
  const expectedClass =
    settings.vatCondition === 'RESPONSABLE_INSCRIPTO'
      ? [1, 6].includes(recipientVatConditionId)
        ? 'A'
        : 'B'
      : ['MONOTRIBUTO', 'EXENTO'].includes(settings.vatCondition ?? '')
        ? 'C'
        : null;
  if (preview.invoiceType !== expectedClass) invalid();
  const calculated = calculateFiscalBreakdown(
    preview.source.lines,
    preview.source.total,
    {
      invoiceType: preview.invoiceType,
      amountInterpretation: preview.amountInterpretation,
      lines: preview.lines.map(({ salesLineId, treatment }) => ({
        salesLineId,
        treatment,
      })),
    },
  );
  if (
    Object.entries(calculated.totals).some(
      ([key, value]) =>
        preview.totals[key as keyof typeof preview.totals] !== value,
    ) ||
    calculated.lines.some((line, index) =>
      Object.entries(line).some(
        ([key, value]) =>
          preview.lines[index]?.[key as keyof typeof line] !== value,
      ),
    )
  )
    invalid();
  const Decimal = Prisma.Decimal.clone({
    precision: 40,
    rounding: Prisma.Decimal.ROUND_HALF_UP,
  });
  const groups = new Map<
    number,
    { base: Prisma.Decimal; amount: Prisma.Decimal; rate: string }
  >();
  for (const line of calculated.lines) {
    const rate = RATES[line.treatment];
    if (!rate) continue;
    const group = groups.get(rate.id) ?? {
      base: new Decimal(0),
      amount: new Decimal(0),
      rate: rate.rate,
    };
    group.base = group.base.plus(line.netAmount);
    group.amount = group.amount.plus(line.vatAmount);
    groups.set(rate.id, group);
  }
  const iva = [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([id, group]) => {
      if (
        !group.base
          .times(group.rate)
          .toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN)
          .eq(group.amount)
      )
        invalid();
      return {
        id,
        base: group.base.toFixed(2),
        amount: group.amount.toFixed(2),
      };
    });
  return {
    issuerCuit,
    recipientCuit,
    recipientVatConditionId,
    pointOfSale: settings.testPointOfSale!,
    voucherType:
      preview.invoiceType === 'A' ? 1 : preview.invoiceType === 'B' ? 6 : 11,
    date,
    total: calculated.totals.finalAmount,
    net: calculated.totals.netAmount,
    vat: calculated.totals.vatAmount,
    exempt: calculated.totals.exemptAmount,
    notTaxed: calculated.totals.notTaxedAmount,
    iva,
  };
}
