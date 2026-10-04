import { z } from 'zod';
import type { FiscalPreview } from './fiscal';

export const saveFiscalCreditNoteSchema = z
  .object({
    reason: z.string().trim().min(5).max(500),
    expectedRevision: z.number().int().min(0).max(2147483646),
  })
  .strict();
export type SaveFiscalCreditNoteInput = z.infer<typeof saveFiscalCreditNoteSchema>;
export interface FiscalCreditNoteSnapshot {
  original: {
    authorizationId: string;
    issuerCuit: string;
    pointOfSale: number;
    voucherType: number;
    voucherNumber: number;
    date: string;
    cae: string;
  };
  creditNoteType: 3 | 8 | 13;
  authorizedAmounts: {
    total: string;
    net: string;
    vat: string;
    exempt: string;
    notTaxed: string;
    iva: { id: number; base: string; amount: string }[];
  };
  invoice: Pick<FiscalPreview, 'source' | 'invoiceType' | 'lines' | 'totals'>;
}
export interface FiscalCreditNoteDraftDto extends FiscalCreditNoteSnapshot {
  id: string;
  environment: 'HOMOLOGATION';
  status: 'DRAFT';
  reason: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export interface FiscalCreditNoteResponse {
  draft: FiscalCreditNoteDraftDto | null;
}
