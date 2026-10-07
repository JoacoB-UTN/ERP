import { BadRequestException } from '@nestjs/common';
import {
  isValidCuitChecksum,
  type FiscalCreditNoteSnapshot,
} from '@erp/shared';
import { Prisma } from '../generated/prisma/client';
import { validFiscalDate, type ArcaCreditNoteRequest } from './fiscal-request';
import {
  readFiscalRecipient,
  type ArcaRecipientDocument,
} from './fiscal-recipient';

const CONDITIONS: Record<string, number> = {
  RESPONSABLE_INSCRIPTO: 1,
  EXENTO: 4,
  CONSUMIDOR_FINAL: 5,
  MONOTRIBUTO: 6,
};
const TYPES = { A: [1, 3], B: [6, 8], C: [11, 13] } as const;
const Decimal = Prisma.Decimal.clone({ precision: 40 });
function invalid(): never {
  throw new BadRequestException(
    'La nota de crédito no coincide con la factura original autorizada. Revisá los datos fiscales guardados.',
  );
}
function cuit(value: string): string {
  const normalized = value.replace(/[-\s]/g, '');
  if (!/^\d{11}$/.test(normalized) || !isValidCuitChecksum(normalized))
    invalid();
  return normalized;
}
function amount(value: string): Prisma.Decimal {
  if (!/^\d{1,13}(?:\.\d{1,2})?$/.test(value)) invalid();
  return new Decimal(value);
}

/** Copies the authorized amounts; no pricing or tax recalculation is permitted. */
export function buildCreditNoteRequest(
  snapshot: FiscalCreditNoteSnapshot,
  date: string,
): Omit<ArcaCreditNoteRequest, 'voucherNumber' | 'recipientCuit'> &
  ArcaRecipientDocument {
  const { original, invoice, authorizedAmounts: amounts } = snapshot;
  const issuerCuit = cuit(original.issuerCuit);
  const recipient = readFiscalRecipient(
    invoice.source.recipient,
    snapshot.creditNoteType,
  );
  const recipientVatConditionId =
    CONDITIONS[invoice.source.recipient.taxCondition];
  const types = TYPES[invoice.invoiceType];
  if (
    !types ||
    original.voucherType !== types[0] ||
    snapshot.creditNoteType !== types[1] ||
    cuit(invoice.source.issuer.taxId) !== issuerCuit ||
    !recipientVatConditionId ||
    (invoice.invoiceType === 'A' &&
      ![1, 6].includes(recipientVatConditionId)) ||
    (invoice.invoiceType === 'B' &&
      ![4, 5].includes(recipientVatConditionId)) ||
    invoice.source.currencyCode !== 'ARS' ||
    !validFiscalDate(date) ||
    !validFiscalDate(original.date) ||
    date < original.date ||
    !/^\d{14}$/.test(original.cae) ||
    !Number.isInteger(original.pointOfSale) ||
    original.pointOfSale < 1 ||
    original.pointOfSale > 99999 ||
    !Number.isInteger(original.voucherNumber) ||
    original.voucherNumber < 1 ||
    original.voucherNumber > 99999999
  )
    invalid();

  const total = amount(amounts.total);
  const net = amount(amounts.net);
  const vat = amount(amounts.vat);
  const exempt = amount(amounts.exempt);
  const notTaxed = amount(amounts.notTaxed);
  if (
    !total.gt(0) ||
    !total.eq(net.plus(vat).plus(exempt).plus(notTaxed)) ||
    !total.eq(amount(invoice.source.total)) ||
    !total.eq(amount(invoice.totals.finalAmount)) ||
    !net.eq(amount(invoice.totals.netAmount)) ||
    !vat.eq(amount(invoice.totals.vatAmount)) ||
    !exempt.eq(amount(invoice.totals.exemptAmount)) ||
    !notTaxed.eq(amount(invoice.totals.notTaxedAmount))
  )
    invalid();

  let groupedNet = new Decimal(0);
  let groupedVat = new Decimal(0);
  const ids = new Set<number>();
  for (const row of amounts.iva) {
    if (![3, 4, 5, 6].includes(row.id) || ids.has(row.id)) invalid();
    ids.add(row.id);
    groupedNet = groupedNet.plus(amount(row.base));
    groupedVat = groupedVat.plus(amount(row.amount));
  }
  if (invoice.invoiceType === 'C') {
    if (
      amounts.iva.length ||
      !vat.isZero() ||
      !exempt.isZero() ||
      !notTaxed.isZero()
    )
      invalid();
  } else if (!groupedNet.eq(net) || !groupedVat.eq(vat)) invalid();

  return {
    issuerCuit,
    ...recipient,
    recipientVatConditionId,
    pointOfSale: original.pointOfSale,
    voucherType: snapshot.creditNoteType,
    date,
    total: amounts.total,
    net: amounts.net,
    vat: amounts.vat,
    exempt: amounts.exempt,
    notTaxed: amounts.notTaxed,
    iva: amounts.iva.map((row) => ({ ...row })),
    associated: {
      voucherType: original.voucherType,
      pointOfSale: original.pointOfSale,
      voucherNumber: original.voucherNumber,
      issuerCuit,
      date: original.date,
    },
  };
}
