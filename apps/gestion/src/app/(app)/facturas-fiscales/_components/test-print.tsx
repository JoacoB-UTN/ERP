'use client';

import type { FiscalAuthorizationDto, FiscalDraftDto } from '@erp/shared';
import { FiscalTestPrintSheet } from './test-print-sheet';

export function FiscalTestPrint({
  draft,
  authorization: a,
  canPrint,
}: {
  draft: FiscalDraftDto;
  authorization: FiscalAuthorizationDto;
  canPrint: () => boolean;
}) {
  const eligible =
    a.environment === 'HOMOLOGATION' &&
    a.status === 'AUTHORIZED' &&
    a.draftId === draft.id &&
    a.draftRevision === draft.revision &&
    { A: 1, B: 6, C: 11 }[draft.invoiceType] === a.voucherType &&
    /^\d{14}$/.test(a.cae ?? '') &&
    /^\d{8}$/.test(a.expiresAt ?? '');
  if (!eligible) return null;
  return <FiscalTestPrintSheet document={{ kind: 'INVOICE', draft }} authorization={a} canPrint={canPrint} />;
}
