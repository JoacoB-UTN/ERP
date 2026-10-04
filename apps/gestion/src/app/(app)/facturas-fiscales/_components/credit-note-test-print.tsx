'use client';

import type { FiscalAuthorizationDto, FiscalCreditNoteDraftDto } from '@erp/shared';
import { FiscalTestPrintSheet } from './test-print-sheet';

export function FiscalCreditNoteTestPrint({
  note,
  authorization: a,
  canPrint,
}: {
  note: FiscalCreditNoteDraftDto;
  authorization: FiscalAuthorizationDto;
  canPrint: () => boolean;
}) {
  const eligible =
    note.environment === 'HOMOLOGATION' &&
    a.environment === 'HOMOLOGATION' &&
    a.status === 'AUTHORIZED' &&
    a.draftId === note.id &&
    a.draftRevision === note.revision &&
    note.creditNoteType === a.voucherType &&
    { 3: 1, 8: 6, 13: 11 }[note.creditNoteType] === note.original.voucherType &&
    { A: 3, B: 8, C: 13 }[note.invoice.invoiceType] === note.creditNoteType &&
    a.pointOfSale === note.original.pointOfSale &&
    /^\d{14}$/.test(a.cae ?? '') &&
    /^\d{8}$/.test(a.expiresAt ?? '');
  if (!eligible) return null;
  return (
    <FiscalTestPrintSheet document={{ kind: 'CREDIT_NOTE', note }} authorization={a} canPrint={canPrint} />
  );
}
