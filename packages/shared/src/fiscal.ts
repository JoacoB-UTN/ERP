import { z } from 'zod';
import type { FiscalAuthorizationDto } from './fiscal-authorization';

export const fiscalInvoiceTypeSchema = z.enum(['A', 'B', 'C']);
export const fiscalTaxTreatmentSchema = z.enum([
  'VAT_0',
  'VAT_10_5',
  'VAT_21',
  'VAT_27',
  'EXEMPT',
  'NOT_TAXED',
  'C_NO_VAT',
]);
export type FiscalInvoiceType = z.infer<typeof fiscalInvoiceTypeSchema>;
export type FiscalTaxTreatment = z.infer<typeof fiscalTaxTreatmentSchema>;
export const fiscalDraftInputSchema = z
  .object({
    invoiceType: fiscalInvoiceTypeSchema,
    amountInterpretation: z.literal('FINAL_AMOUNTS_INCLUDE_VAT'),
    lines: z
      .array(
        z
          .object({
            salesLineId: z.string().uuid(),
            treatment: fiscalTaxTreatmentSchema,
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();
export type FiscalDraftInput = z.infer<typeof fiscalDraftInputSchema>;
export const saveFiscalDraftSchema = fiscalDraftInputSchema
  .extend({
    expectedRevision: z.number().int().min(0).max(2147483646),
  })
  .strict();
export type SaveFiscalDraftInput = z.infer<typeof saveFiscalDraftSchema>;
export const refreshFiscalIdentitySchema = z
  .object({
    expectedRevision: z.number().int().min(1).max(2147483646),
    confirmIdentityRefresh: z.literal(true),
  })
  .strict();
export type RefreshFiscalIdentityInput = z.infer<typeof refreshFiscalIdentitySchema>;

export const fiscalDraftFilterSchema = z.enum(['ALL', 'PENDING', 'INVOICE_PENDING', 'CREDIT_NOTE_PENDING']);
export type FiscalDraftFilter = z.infer<typeof fiscalDraftFilterSchema>;
export const fiscalDraftsQuerySchema = z
  .object({
    filter: fiscalDraftFilterSchema.default('ALL'),
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export type FiscalDraftsQuery = z.infer<typeof fiscalDraftsQuerySchema>;
export interface FiscalSourceLine {
  salesLineId: string;
  description: string;
  quantity: string;
  finalAmount: string;
}
export interface FiscalCalculatedLine extends FiscalSourceLine {
  treatment: FiscalTaxTreatment;
  netAmount: string;
  vatAmount: string;
  exemptAmount: string;
  notTaxedAmount: string;
}
export interface FiscalBreakdown {
  lines: FiscalCalculatedLine[];
  totals: {
    netAmount: string;
    vatAmount: string;
    exemptAmount: string;
    notTaxedAmount: string;
    finalAmount: string;
  };
}
export interface FiscalSource {
  saleId: string;
  saleNumber: string;
  currencyCode: 'ARS';
  total: string;
  issuer: { legalName: string; taxId: string };
  recipient: { legalName: string; taxId: string | null; taxCondition: string };
  lines: FiscalSourceLine[];
}
export interface FiscalPreview extends FiscalBreakdown {
  source: FiscalSource;
  invoiceType: FiscalInvoiceType;
  amountInterpretation: 'FINAL_AMOUNTS_INCLUDE_VAT';
  authorizationAvailable: false;
  pendingRequirements: string[];
}
export interface FiscalDraftDto extends FiscalPreview {
  id: string;
  status: 'DRAFT';
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export interface FiscalSourceResponse {
  source: FiscalSource;
}
export interface FiscalPreviewResponse {
  preview: FiscalPreview;
}
export interface FiscalDraftResponse {
  draft: FiscalDraftDto;
}
export interface FiscalDraftForSaleResponse {
  draft: FiscalDraftDto | null;
}
export type FiscalAuthorizationSummary = Pick<
  FiscalAuthorizationDto,
  'status' | 'pointOfSale' | 'voucherType' | 'voucherNumber'
>;
export interface FiscalDraftListItem extends FiscalDraftDto {
  authorization: FiscalAuthorizationSummary | null;
  creditNote: {
    id: string;
    authorization: FiscalAuthorizationSummary | null;
  } | null;
}
export interface FiscalDraftsResponse {
  items: FiscalDraftListItem[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}
export const FISCAL_TAX_TREATMENT_LABELS: Record<FiscalTaxTreatment, string> = {
  VAT_0: 'Gravado al 0%',
  VAT_10_5: 'IVA 10,5%',
  VAT_21: 'IVA 21%',
  VAT_27: 'IVA 27%',
  EXEMPT: 'Exento',
  NOT_TAXED: 'No gravado',
  C_NO_VAT: 'Comprobante C (sin discriminar IVA)',
};
