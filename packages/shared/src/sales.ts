import { z } from 'zod';
import { SalesDocumentStatus, SalesDocumentType } from './enums';
import { quantitySchema } from './decimal';
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

export interface SalesDocumentDetailDto extends SalesDocumentSummaryDto {
  branchId: string | null;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  notes: string | null;
  lines: SalesDocumentLineDto[];
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
