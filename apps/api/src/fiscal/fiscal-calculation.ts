import { BadRequestException } from '@nestjs/common';
import {
  fiscalDraftInputSchema,
  type FiscalBreakdown,
  type FiscalDraftInput,
  type FiscalSourceLine,
  type FiscalTaxTreatment,
} from '@erp/shared';
import { Prisma } from '../generated/prisma/client';

const VAT_DIVISORS: Partial<Record<FiscalTaxTreatment, string>> = {
  VAT_0: '1',
  VAT_10_5: '1.105',
  VAT_21: '1.21',
  VAT_27: '1.27',
};

function invalidLines(): never {
  throw new BadRequestException({
    code: 'FISCAL_DRAFT_INVALID_LINES',
    message:
      'Indicá un tratamiento fiscal válido para cada línea de la venta, sin repetir ni agregar líneas.',
  });
}

function invalidAmount(): never {
  throw new BadRequestException({
    code: 'FISCAL_DRAFT_INVALID_AMOUNT',
    message:
      'Los importes de la venta deben ser no negativos, expresarse en centavos exactos y coincidir con su total.',
  });
}

/** Decomposes immutable payable line amounts; never re-prices a sale or authorizes it. */
export function calculateFiscalBreakdown(
  sourceLines: FiscalSourceLine[],
  sourceTotal: string,
  input: FiscalDraftInput,
): FiscalBreakdown {
  const parsed = fiscalDraftInputSchema.safeParse(input);
  if (!parsed.success) invalidLines();
  if (
    !Array.isArray(sourceLines) ||
    sourceLines.length === 0 ||
    sourceLines.length > 500
  ) {
    invalidLines();
  }
  const ids = new Set<string>();
  for (const line of sourceLines) {
    if (!line || !line.salesLineId || ids.has(line.salesLineId)) invalidLines();
    ids.add(line.salesLineId);
  }
  const treatments = new Map<string, FiscalTaxTreatment>();
  for (const line of parsed.data.lines) {
    if (!ids.has(line.salesLineId) || treatments.has(line.salesLineId)) {
      invalidLines();
    }
    if ((parsed.data.invoiceType === 'C') !== (line.treatment === 'C_NO_VAT')) {
      invalidLines();
    }
    treatments.set(line.salesLineId, line.treatment);
  }
  if (treatments.size !== sourceLines.length) invalidLines();

  const amounts = [sourceTotal, ...sourceLines.map((line) => line.finalAmount)];
  // Bound parsing work without limiting the database's Decimal(19,4) range.
  // A private constructor avoids changing Prisma's process-wide precision.
  for (const value of amounts) {
    if (
      typeof value !== 'string' ||
      value.length > 1000 ||
      !/^\d+(?:\.\d+)?$/.test(value)
    ) {
      invalidAmount();
    }
  }
  const Decimal = Prisma.Decimal.clone({
    precision: Math.max(40, ...amounts.map((value) => value.length + 20)),
    rounding: Prisma.Decimal.ROUND_HALF_UP,
  });
  const parseAmount = (value: string) => {
    const amount = new Decimal(value);
    if (
      !amount.isFinite() ||
      amount.isNegative() ||
      amount.decimalPlaces() > 2
    ) {
      invalidAmount();
    }
    return amount;
  };
  const expectedTotal = parseAmount(sourceTotal);
  let netTotal = new Decimal(0);
  let vatTotal = new Decimal(0);
  let exemptTotal = new Decimal(0);
  let notTaxedTotal = new Decimal(0);
  let finalTotal = new Decimal(0);
  const lines = sourceLines.map((line) => {
    const gross = parseAmount(line.finalAmount);
    const treatment = treatments.get(line.salesLineId)!;
    let net = new Decimal(0);
    let vat = new Decimal(0);
    let exempt = new Decimal(0);
    let notTaxed = new Decimal(0);
    if (treatment === 'C_NO_VAT') {
      net = gross;
    } else if (treatment === 'EXEMPT') {
      exempt = gross;
    } else if (treatment === 'NOT_TAXED') {
      notTaxed = gross;
    } else {
      const divisor = VAT_DIVISORS[treatment];
      if (!divisor) invalidLines();
      net = gross.div(divisor).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      vat = gross.minus(net);
    }
    netTotal = netTotal.plus(net);
    vatTotal = vatTotal.plus(vat);
    exemptTotal = exemptTotal.plus(exempt);
    notTaxedTotal = notTaxedTotal.plus(notTaxed);
    finalTotal = finalTotal.plus(gross);
    return {
      ...line,
      finalAmount: gross.toFixed(2),
      treatment,
      netAmount: net.toFixed(2),
      vatAmount: vat.toFixed(2),
      exemptAmount: exempt.toFixed(2),
      notTaxedAmount: notTaxed.toFixed(2),
    };
  });
  if (!finalTotal.eq(expectedTotal)) invalidAmount();
  return {
    lines,
    totals: {
      netAmount: netTotal.toFixed(2),
      vatAmount: vatTotal.toFixed(2),
      exemptAmount: exemptTotal.toFixed(2),
      notTaxedAmount: notTaxedTotal.toFixed(2),
      finalAmount: finalTotal.toFixed(2),
    },
  };
}
