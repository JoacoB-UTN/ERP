import { z } from 'zod';
import { PurchaseOrderStatus } from './enums';
import { quantitySchema, moneySchema } from './decimal';
import type { PaginationMeta } from './api';

/**
 * Purchase Orders — commercial intent only, see docs/purchases.md and
 * CLAUDE.md. A PurchaseOrder NEVER changes stock, at creation or
 * confirmation. `total` and each line's `lineTotal` are always computed
 * server-side from quantity*unitCost — never trusted from the client.
 */

const purchaseOrderStatusValues = Object.values(PurchaseOrderStatus) as [
  PurchaseOrderStatus,
  ...PurchaseOrderStatus[],
];

/** Quantity must be > 0 — a purchase order line always requests a positive amount. */
const orderQuantitySchema = quantitySchema.refine((v) => Number(v) > 0, {
  message: 'La cantidad debe ser mayor a 0.',
});

/**
 * `unitCost` IS accepted from the client here — unlike a Sales line's price
 * (always server-resolved via PricingService), a Purchase Order's cost is
 * the supplier's quote, which has no analogous pricing engine to resolve it
 * from. The server still computes/validates the line/document totals from
 * it — never trusts a client-supplied total (see docs/purchases.md).
 */
const purchaseOrderLineInputSchema = z.object({
  productVariantId: z.string().uuid('Variante inválida.'),
  quantity: orderQuantitySchema,
  unitCost: moneySchema,
});
export type PurchaseOrderLineInput = z.infer<typeof purchaseOrderLineInputSchema>;

export const createPurchaseOrderSchema = z.object({
  supplierId: z.string().uuid('Elegí un proveedor.'),
  branchId: z.string().uuid().optional(),
  currencyId: z.string().uuid('Elegí una moneda.'),
  orderDate: z.coerce.date().optional(),
  expectedDeliveryDate: z.coerce.date().optional(),
  notes: z.string().trim().max(1000).optional(),
  lines: z.array(purchaseOrderLineInputSchema).min(1, 'Agregá al menos una línea.'),
});
export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;

/** Only valid while the order is DRAFT — see docs/purchases.md. Supplying `lines` fully replaces the existing lines. */
export const updatePurchaseOrderSchema = z.object({
  supplierId: z.string().uuid().optional(),
  branchId: z.string().uuid().nullable().optional(),
  currencyId: z.string().uuid().optional(),
  orderDate: z.coerce.date().optional(),
  expectedDeliveryDate: z.coerce.date().nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  lines: z.array(purchaseOrderLineInputSchema).min(1, 'Agregá al menos una línea.').optional(),
});
export type UpdatePurchaseOrderInput = z.infer<typeof updatePurchaseOrderSchema>;

export const purchaseOrderListQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  status: z.enum(purchaseOrderStatusValues).optional(),
  supplierId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type PurchaseOrderListQuery = z.infer<typeof purchaseOrderListQuerySchema>;

// ---------- Response DTOs ----------

/**
 * `receivedQuantity`/`pendingQuantity` are always DERIVED at read time from
 * confirmed PurchaseReceiptLine history (SUM of quantity grouped by
 * purchaseOrderLineId) — never a stored mutable counter, see
 * docs/purchases.md's partial-receipt rule.
 */
export interface PurchaseOrderLineDto {
  id: string;
  productVariantId: string;
  productId: string;
  description: string;
  variantName: string | null;
  sku: string | null;
  quantity: string;
  unitCost: string;
  lineTotal: string;
  receivedQuantity: string;
  pendingQuantity: string;
}

export interface PurchaseOrderSummaryDto {
  id: string;
  number: string;
  status: PurchaseOrderStatus;
  orderDate: string;
  expectedDeliveryDate: string | null;
  supplier: { id: string; code: string; legalName: string };
  branch: { id: string; code: string; name: string } | null;
  currencyCode: string;
  total: string;
  lineCount: number;
  createdBy: { id: string; name: string | null } | null;
}

export interface PurchaseOrderDetailDto extends PurchaseOrderSummaryDto {
  currencyId: string;
  notes: string | null;
  lines: PurchaseOrderLineDto[];
  receipts: { id: string; number: string; status: string; receiptDate: string }[];
  createdAt: string;
  confirmedAt: string | null;
  confirmedBy: { id: string; name: string | null } | null;
  cancelledAt: string | null;
  cancelledBy: { id: string; name: string | null } | null;
}

export interface PurchaseOrderListResponse {
  items: PurchaseOrderSummaryDto[];
  pagination: PaginationMeta;
}

export interface PurchaseOrderDetailResponse {
  purchaseOrder: PurchaseOrderDetailDto;
}

// ---------- Spanish presentation layer ----------

export const PURCHASE_ORDER_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Borrador',
  CONFIRMED: 'Confirmada',
  CANCELLED: 'Anulada',
};

export function purchaseOrderStatusLabel(value: string): string {
  return PURCHASE_ORDER_STATUS_LABELS[value] ?? value;
}
