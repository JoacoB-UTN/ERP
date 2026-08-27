import { z } from 'zod';
import { PurchaseReceiptStatus } from './enums';
import { quantitySchema, moneySchema } from './decimal';
import type { PaginationMeta } from './api';

/**
 * Goods Receipts — the ONLY Purchases document that touches stock, see
 * docs/purchases.md and CLAUDE.md. Confirming creates real StockMovement
 * (PURCHASE) rows; cancelling a confirmed receipt creates a compensating
 * PURCHASE_RETURN reversal, never edits/deletes the original. A receipt may
 * optionally reference a confirmed PurchaseOrder for partial/multiple
 * receiving — see purchaseOrderId below.
 */

const purchaseReceiptStatusValues = Object.values(PurchaseReceiptStatus) as [
  PurchaseReceiptStatus,
  ...PurchaseReceiptStatus[],
];

const receiptQuantitySchema = quantitySchema.refine((v) => Number(v) > 0, {
  message: 'La cantidad debe ser mayor a 0.',
});

/**
 * `purchaseOrderLineId` is required when the receipt references a
 * PurchaseOrder (header `purchaseOrderId` set) — see the create schema's
 * superRefine below — and must be omitted for a direct receipt (no PO).
 * This is the explicit traceability edge back to the ordered line, never a
 * best-effort match by productVariantId alone (two lines of the same
 * variant on one order would otherwise be ambiguous).
 */
const purchaseReceiptLineInputSchema = z.object({
  productVariantId: z.string().uuid('Variante inválida.'),
  quantity: receiptQuantitySchema,
  unitCostSnapshot: moneySchema,
  purchaseOrderLineId: z.string().uuid().optional(),
});
export type PurchaseReceiptLineInput = z.infer<typeof purchaseReceiptLineInputSchema>;

function linesMatchPurchaseOrderRefine(
  data: { purchaseOrderId?: string | null; lines: PurchaseReceiptLineInput[] },
  ctx: z.RefinementCtx,
) {
  const hasOrder = !!data.purchaseOrderId;
  data.lines.forEach((line, index) => {
    if (hasOrder && !line.purchaseOrderLineId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Elegí la línea de la orden de compra que se está recibiendo.',
        path: ['lines', index, 'purchaseOrderLineId'],
      });
    }
    if (!hasOrder && line.purchaseOrderLineId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Una recepción directa no puede referenciar una línea de orden de compra.',
        path: ['lines', index, 'purchaseOrderLineId'],
      });
    }
  });
}

export const createPurchaseReceiptSchema = z
  .object({
    supplierId: z.string().uuid('Elegí un proveedor.'),
    warehouseId: z.string().uuid('Elegí un depósito.'),
    purchaseOrderId: z.string().uuid().optional(),
    branchId: z.string().uuid().optional(),
    currencyId: z.string().uuid().optional(), // required only when purchaseOrderId is absent — see PurchaseReceiptsService
    receiptDate: z.coerce.date().optional(),
    notes: z.string().trim().max(1000).optional(),
    lines: z.array(purchaseReceiptLineInputSchema).min(1, 'Agregá al menos una línea.'),
  })
  .superRefine(linesMatchPurchaseOrderRefine);
export type CreatePurchaseReceiptInput = z.infer<typeof createPurchaseReceiptSchema>;

/** Only valid while the receipt is DRAFT — see docs/purchases.md. Supplying `lines` fully replaces the existing lines. */
export const updatePurchaseReceiptSchema = z.object({
  warehouseId: z.string().uuid().optional(),
  receiptDate: z.coerce.date().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  lines: z.array(purchaseReceiptLineInputSchema).min(1, 'Agregá al menos una línea.').optional(),
});
export type UpdatePurchaseReceiptInput = z.infer<typeof updatePurchaseReceiptSchema>;

export const purchaseReceiptListQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  status: z.enum(purchaseReceiptStatusValues).optional(),
  supplierId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  purchaseOrderId: z.string().uuid().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type PurchaseReceiptListQuery = z.infer<typeof purchaseReceiptListQuerySchema>;

// ---------- Response DTOs ----------

export interface PurchaseReceiptLineDto {
  id: string;
  productVariantId: string;
  productId: string;
  description: string;
  variantName: string | null;
  sku: string | null;
  quantity: string;
  unitCostSnapshot: string;
  purchaseOrderLineId: string | null;
}

export interface PurchaseReceiptSummaryDto {
  id: string;
  number: string;
  status: PurchaseReceiptStatus;
  receiptDate: string;
  supplier: { id: string; code: string; legalName: string };
  warehouse: { id: string; code: string; name: string };
  purchaseOrder: { id: string; number: string } | null;
  currencyCode: string;
  lineCount: number;
  createdBy: { id: string; name: string | null } | null;
}

export interface PurchaseReceiptDetailDto extends PurchaseReceiptSummaryDto {
  branchId: string | null;
  currencyId: string;
  notes: string | null;
  lines: PurchaseReceiptLineDto[];
  createdAt: string;
  confirmedAt: string | null;
  confirmedBy: { id: string; name: string | null } | null;
  cancelledAt: string | null;
  cancelledBy: { id: string; name: string | null } | null;
}

export interface PurchaseReceiptListResponse {
  items: PurchaseReceiptSummaryDto[];
  pagination: PaginationMeta;
}

export interface PurchaseReceiptDetailResponse {
  purchaseReceipt: PurchaseReceiptDetailDto;
}

// ---------- Spanish presentation layer ----------

export const PURCHASE_RECEIPT_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Borrador',
  CONFIRMED: 'Confirmada',
  CANCELLED: 'Anulada',
};

export function purchaseReceiptStatusLabel(value: string): string {
  return PURCHASE_RECEIPT_STATUS_LABELS[value] ?? value;
}
