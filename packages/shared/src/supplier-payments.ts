import { z } from 'zod';
import { SupplierPaymentStatus, PaymentMethod } from './enums';
import { moneySchema } from './decimal';
import type { PaginationMeta } from './api';

/**
 * Supplier Payments ("Pagos") — see docs/current-accounts.md. Symmetric
 * to customer-collections.ts. `amount` is the total paid; `applications`
 * says which PurchaseReceipt(s) it settles. Any remainder is an unapplied
 * advance to the supplier.
 */

const paymentStatusValues = Object.values(SupplierPaymentStatus) as [
  SupplierPaymentStatus,
  ...SupplierPaymentStatus[],
];
const paymentMethodValues = Object.values(PaymentMethod) as [PaymentMethod, ...PaymentMethod[]];

const applicationAmountSchema = moneySchema.refine((v) => Number(v) > 0, {
  message: 'El importe aplicado debe ser mayor a 0.',
});

const paymentApplicationInputSchema = z.object({
  purchaseReceiptId: z.string().uuid('Recepción inválida.'),
  amount: applicationAmountSchema,
});
export type PaymentApplicationInput = z.infer<typeof paymentApplicationInputSchema>;

/** Same reasoning as customer-collections.ts's identical helper. */
function assertNoDuplicateTargets(applications: PaymentApplicationInput[], ctx: z.RefinementCtx) {
  const seen = new Set<string>();
  applications.forEach((application, index) => {
    if (seen.has(application.purchaseReceiptId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Esta recepción ya tiene una aplicación en este pago.',
        path: ['applications', index, 'purchaseReceiptId'],
      });
    }
    seen.add(application.purchaseReceiptId);
  });
}

const paymentAmountSchema = moneySchema.refine((v) => Number(v) > 0, {
  message: 'El importe debe ser mayor a 0.',
});

export const createSupplierPaymentSchema = z
  .object({
    supplierId: z.string().uuid('Elegí un proveedor.'),
    branchId: z.string().uuid().optional(),
    currencyId: z.string().uuid('Elegí una moneda.'),
    occurredAt: z.coerce.date().optional(),
    amount: paymentAmountSchema,
    paymentMethod: z.enum(paymentMethodValues),
    externalReference: z.string().trim().max(100).optional(),
    notes: z.string().trim().max(1000).optional(),
    applications: z.array(paymentApplicationInputSchema).default([]),
  })
  .superRefine((data, ctx) => assertNoDuplicateTargets(data.applications, ctx));
export type CreateSupplierPaymentInput = z.infer<typeof createSupplierPaymentSchema>;

/** Only valid while the payment is DRAFT — see docs/current-accounts.md. Supplying `applications` fully replaces the existing ones. */
export const updateSupplierPaymentSchema = z
  .object({
    supplierId: z.string().uuid().optional(),
    currencyId: z.string().uuid().optional(),
    occurredAt: z.coerce.date().optional(),
    amount: paymentAmountSchema.optional(),
    paymentMethod: z.enum(paymentMethodValues).optional(),
    externalReference: z.string().trim().max(100).nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
    applications: z.array(paymentApplicationInputSchema).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.applications) assertNoDuplicateTargets(data.applications, ctx);
  });
export type UpdateSupplierPaymentInput = z.infer<typeof updateSupplierPaymentSchema>;

export const supplierPaymentListQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  status: z.enum(paymentStatusValues).optional(),
  supplierId: z.string().uuid().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type SupplierPaymentListQuery = z.infer<typeof supplierPaymentListQuerySchema>;

// ---------- Response DTOs ----------

export interface SupplierPaymentApplicationDto {
  id: string;
  purchaseReceiptId: string;
  purchaseReceiptNumber: string;
  amount: string;
}

export interface SupplierPaymentSummaryDto {
  id: string;
  number: string;
  status: SupplierPaymentStatus;
  occurredAt: string;
  supplier: { id: string; code: string; legalName: string };
  currencyCode: string;
  amount: string;
  appliedAmount: string;
  unappliedAmount: string;
  paymentMethod: PaymentMethod;
  createdBy: { id: string; name: string | null } | null;
}

export interface SupplierPaymentDetailDto extends SupplierPaymentSummaryDto {
  branchId: string | null;
  currencyId: string;
  externalReference: string | null;
  notes: string | null;
  applications: SupplierPaymentApplicationDto[];
  createdAt: string;
  confirmedAt: string | null;
  confirmedBy: { id: string; name: string | null } | null;
  cancelledAt: string | null;
  cancelledBy: { id: string; name: string | null } | null;
}

export interface SupplierPaymentListResponse {
  items: SupplierPaymentSummaryDto[];
  pagination: PaginationMeta;
}

export interface SupplierPaymentDetailResponse {
  payment: SupplierPaymentDetailDto;
}

// ---------- Spanish presentation layer ----------

export const SUPPLIER_PAYMENT_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Borrador',
  CONFIRMED: 'Confirmado',
  CANCELLED: 'Anulado',
};

export function supplierPaymentStatusLabel(value: string): string {
  return SUPPLIER_PAYMENT_STATUS_LABELS[value] ?? value;
}
