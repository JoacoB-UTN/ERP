import { BadRequestException } from '@nestjs/common';
import { isValidCuitChecksum, type FiscalSource } from '@erp/shared';

export type ArcaRecipientDocument = {
  recipientDocumentType: 80 | 96;
  recipientDocumentNumber: string;
};
export type ArcaRecipientIdentity =
  | (ArcaRecipientDocument & { recipientCuit?: never })
  | {
      recipientCuit: string;
      recipientDocumentType?: never;
      recipientDocumentNumber?: never;
    };

function invalid(): never {
  throw new BadRequestException(
    'Revisá el tipo y número de documento del receptor. DNI requiere consumidor final y comprobante B en homologación.',
  );
}
function cuit(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{11}$/.test(value) ||
    !isValidCuitChecksum(value)
  )
    invalid();
  return value;
}
function dni(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{1,11}$/.test(value)) invalid();
  const normalized = value.replace(/^0+/, '');
  if (!normalized) invalid();
  return normalized;
}

/** Read saved requests without guessing a missing/contradictory representation. */
export function readArcaRecipient(request: unknown): ArcaRecipientDocument {
  if (!request || typeof request !== 'object' || Array.isArray(request))
    invalid();
  const record = request as Record<string, unknown>;
  const legacy = Object.hasOwn(record, 'recipientCuit');
  const hasType = Object.hasOwn(record, 'recipientDocumentType');
  const hasNumber = Object.hasOwn(record, 'recipientDocumentNumber');
  if (legacy) {
    if (hasType || hasNumber) invalid();
    return {
      recipientDocumentType: 80,
      recipientDocumentNumber: cuit(record.recipientCuit),
    };
  }
  if (!hasType || !hasNumber) invalid();
  if (record.recipientDocumentType === 80)
    return {
      recipientDocumentType: 80,
      recipientDocumentNumber: cuit(record.recipientDocumentNumber),
    };
  if (
    record.recipientDocumentType !== 96 ||
    ![6, 8].includes(record.voucherType as number) ||
    record.recipientVatConditionId !== 5
  )
    invalid();
  return {
    recipientDocumentType: 96,
    recipientDocumentNumber: dni(record.recipientDocumentNumber),
  };
}

/** Only legacy snapshots with no saved type retain the previous CUIT meaning. */
export function readFiscalRecipient(
  recipient: FiscalSource['recipient'],
  voucherType: number,
): ArcaRecipientDocument {
  if (recipient.documentType === undefined || recipient.documentType === 'CUIT')
    return readArcaRecipient({
      recipientDocumentType: 80,
      recipientDocumentNumber: (recipient.taxId ?? '').replace(/[-\s]/g, ''),
    });
  if (recipient.documentType !== 'DNI') invalid();
  return readArcaRecipient({
    recipientDocumentType: 96,
    recipientDocumentNumber: recipient.taxId,
    recipientVatConditionId:
      recipient.taxCondition === 'CONSUMIDOR_FINAL' ? 5 : null,
    voucherType,
  });
}
