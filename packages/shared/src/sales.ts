import { z } from 'zod';
import { SalesDocumentStatus, SalesDocumentType, SalesTenderMethod } from './enums';
import { quantitySchema, moneySchema } from './decimal';
import type { PaginationMeta } from './api';

/**
 * Sales — the demo Sales Core (Prompt #10). An internal ERP sale
 * transaction, NOT a fiscal/electronic invoice — see docs/sales.md and
 * CLAUDE.md. `SalesDocumentLine` snapshots `description`/`unitPrice` at
 * sale time; neither is ever re-resolved from the current Product/
 * PriceList after the fact.
 */

const salesDocumentStatusValues = Object.values(SalesDocumentStatus) as [
  SalesDocumentStatus,
  ...SalesDocumentStatus[],
];

// ---------- Lines ----------

/** Quantity must be > 0 for a sale line — unlike inventory adjustments, there's no signed/negative case here. */
const saleQuantitySchema = quantitySchema.refine((v) => Number(v) > 0, {
  message: 'La cantidad debe ser mayor a 0.',
});

/** Defaults to 0 (no discount) — direction is implicit, always a discount. See docs/sales.md. */
const discountPercentageSchema = z
  .union([z.string(), z.number()])
  .optional()
  .transform((v) => (v === undefined || v === '' ? '0' : String(v).trim()))
  .refine((v) => /^\d+(\.\d+)?$/.test(v), { message: 'Debe ser un número válido.' })
  .refine((v) => Number(v) >= 0 && Number(v) <= 100, {
    message: 'El descuento debe estar entre 0% y 100%.',
  });

/**
 * `unitPrice` is deliberately NOT accepted here — the server always
 * resolves it via PricingService (see docs/sales.md and CLAUDE.md: never
 * trust a client-supplied price). The client requests a price by naming
 * the variant; the server decides what it costs.
 */
const saleLineInputSchema = z.object({
  productVariantId: z.string().uuid('Variante inválida.'),
  quantity: saleQuantitySchema,
  discountPercentage: discountPercentageSchema,
});
export type SaleLineInput = z.infer<typeof saleLineInputSchema>;

// ---------- Create / update (DRAFT only) ----------

export const createSaleSchema = z.object({
  customerId: z.string().uuid('Elegí un cliente.'),
  warehouseId: z.string().uuid('Elegí un depósito.'),
  priceListId: z.string().uuid('Elegí una lista de precios.'),
  branchId: z.string().uuid().optional(),
  notes: z.string().trim().max(1000).optional(),
  occurredAt: z.coerce.date().optional(),
  lines: z.array(saleLineInputSchema).min(1, 'Agregá al menos una línea.'),
});
export type CreateSaleInput = z.infer<typeof createSaleSchema>;

/** Only valid while the sale is DRAFT — see docs/sales.md. Supplying `lines` fully replaces the existing lines (all prices re-resolved). */
export const updateSaleSchema = z.object({
  customerId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  priceListId: z.string().uuid().optional(),
  branchId: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  occurredAt: z.coerce.date().optional(),
  lines: z.array(saleLineInputSchema).min(1, 'Agregá al menos una línea.').optional(),
});
export type UpdateSaleInput = z.infer<typeof updateSaleSchema>;

// ---------- Confirm (optional payment/tender) ----------

const salesTenderMethodValues = Object.values(SalesTenderMethod) as [
  SalesTenderMethod,
  ...SalesTenderMethod[],
];

/**
 * Optional payment/tender captured at checkout (POS or a plain
 * Facturación confirm) — see docs/pos.md. `amountReceived` only ever
 * applies to CASH; the server always sets `amountApplied` to the sale's
 * own total (full payment only, no partial/split payments in this MVP)
 * and computes change at read time — neither is ever accepted from the
 * client. Omitted entirely, `tender` stays absent on the confirmed sale,
 * matching today's plain Facturación/Gestión confirm behavior.
 */
export const confirmSaleTenderSchema = z
  .object({
    method: z.enum(salesTenderMethodValues),
    amountReceived: moneySchema.optional(),
    reference: z.string().trim().max(200).optional(),
  })
  .refine((v) => v.method === 'CASH' || v.amountReceived === undefined, {
    message: 'El importe recibido solo aplica a pagos en efectivo.',
    path: ['amountReceived'],
  });
export type ConfirmSaleTenderInput = z.infer<typeof confirmSaleTenderSchema>;

export const confirmSaleSchema = z.object({
  tender: confirmSaleTenderSchema.optional(),
});
export type ConfirmSaleInput = z.infer<typeof confirmSaleSchema>;

// ---------- List query ----------

export const salesListQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  status: z.enum(salesDocumentStatusValues).optional(),
  customerId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type SalesListQuery = z.infer<typeof salesListQuerySchema>;

// ---------- Response DTOs ----------

/** `price === null` never happens on a persisted line (PricingService rejects a missing price before a line is ever saved) — see docs/sales.md. */
export interface SalesDocumentLineDto {
  id: string;
  productVariantId: string;
  productId: string;
  description: string;
  variantName: string | null;
  sku: string | null;
  quantity: string;
  unitPrice: string;
  discountPercentage: string;
  discountAmount: string;
  netAmount: string;
  taxAmount: string;
  totalAmount: string;
}

export interface SalesDocumentSummaryDto {
  id: string;
  number: string;
  documentType: SalesDocumentType;
  status: SalesDocumentStatus;
  occurredAt: string;
  customer: { id: string; code: string; legalName: string };
  warehouse: { id: string; code: string; name: string };
  priceList: { id: string; code: string; name: string };
  currencyCode: string;
  total: string;
  lineCount: number;
  createdBy: { id: string; name: string | null } | null;
}

/**
 * Read-side view of a confirmed sale's payment/tender — see docs/pos.md.
 * `change` is computed here (amountReceived - amountApplied for CASH),
 * never stored, so it can never drift from its inputs. `null` when the
 * sale was confirmed without a tender (e.g. a plain Facturación/Gestión
 * draft confirm that never went through POS checkout).
 */
export interface SalesTenderDto {
  method: SalesTenderMethod;
  amountApplied: string;
  amountReceived: string | null;
  change: string | null;
  reference: string | null;
  createdAt: string;
}

export interface SalesDocumentDetailDto extends SalesDocumentSummaryDto {
  branchId: string | null;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  notes: string | null;
  lines: SalesDocumentLineDto[];
  tender: SalesTenderDto | null;
  createdAt: string;
  confirmedAt: string | null;
  confirmedBy: { id: string; name: string | null } | null;
  cancelledAt: string | null;
  cancelledBy: { id: string; name: string | null } | null;
}

export interface SalesListResponse {
  items: SalesDocumentSummaryDto[];
  pagination: PaginationMeta;
}
export interface SalesDetailResponse {
  salesDocument: SalesDocumentDetailDto;
}

// ---------- Spanish presentation layer ----------

export const SALES_DOCUMENT_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Borrador',
  CONFIRMED: 'Confirmada',
  CANCELLED: 'Cancelada',
};

export function salesDocumentStatusLabel(value: string): string {
  return SALES_DOCUMENT_STATUS_LABELS[value] ?? value;
}

export const SALES_TENDER_METHOD_LABELS: Record<string, string> = {
  CASH: 'Efectivo',
  CARD: 'Tarjeta',
  TRANSFER: 'Transferencia',
  OTHER: 'Otro',
};

export function salesTenderMethodLabel(value: string): string {
  return SALES_TENDER_METHOD_LABELS[value] ?? value;
}
