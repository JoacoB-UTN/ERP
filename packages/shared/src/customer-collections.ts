import { z } from 'zod';
import { CustomerCollectionStatus, PaymentMethod } from './enums';
import { moneySchema } from './decimal';
import type { PaginationMeta } from './api';

/**
 * Customer Collections ("Cobros") — see docs/current-accounts.md.
 * `amount` is the total collected; `applications` says which
 * SalesDocument(s) it pays down. SUM(applications) is never required to
 * equal `amount` — any remainder is unapplied customer credit/advance.
 */

const collectionStatusValues = Object.values(CustomerCollectionStatus) as [
  CustomerCollectionStatus,
  ...CustomerCollectionStatus[],
];
const paymentMethodValues = Object.values(PaymentMethod) as [PaymentMethod, ...PaymentMethod[]];

const applicationAmountSchema = moneySchema.refine((v) => Number(v) > 0, {
  message: 'El importe aplicado debe ser mayor a 0.',
});

const collectionApplicationInputSchema = z.object({
  salesDocumentId: z.string().uuid('Venta inválida.'),
  amount: applicationAmountSchema,
});
export type CollectionApplicationInput = z.infer<typeof collectionApplicationInputSchema>;

/** Rejects an obviously-duplicated target within one request — see docs/current-accounts.md's "never accidentally double counted" rule. The DB's own unique constraint is the authoritative guard; this is the early, friendly validation error. */
function assertNoDuplicateTargets(
  applications: CollectionApplicationInput[],
  ctx: z.RefinementCtx,
) {
  const seen = new Set<string>();
  applications.forEach((application, index) => {
    if (seen.has(application.salesDocumentId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Esta venta ya tiene una aplicación en este cobro.',
        path: ['applications', index, 'salesDocumentId'],
      });
    }
    seen.add(application.salesDocumentId);
  });
}

const collectionAmountSchema = moneySchema.refine((v) => Number(v) > 0, {
  message: 'El importe debe ser mayor a 0.',
});

export const createCustomerCollectionSchema = z
  .object({
    customerId: z.string().uuid('Elegí un cliente.'),
    branchId: z.string().uuid().optional(),
    currencyId: z.string().uuid('Elegí una moneda.'),
    occurredAt: z.coerce.date().optional(),
    amount: collectionAmountSchema,
    paymentMethod: z.enum(paymentMethodValues),
    externalReference: z.string().trim().max(100).optional(),
    notes: z.string().trim().max(1000).optional(),
    applications: z.array(collectionApplicationInputSchema).default([]),
  })
  .superRefine((data, ctx) => assertNoDuplicateTargets(data.applications, ctx));
export type CreateCustomerCollectionInput = z.infer<typeof createCustomerCollectionSchema>;

/** Only valid while the collection is DRAFT — see docs/current-accounts.md. Supplying `applications` fully replaces the existing ones. */
export const updateCustomerCollectionSchema = z
  .object({
    customerId: z.string().uuid().optional(),
    currencyId: z.string().uuid().optional(),
    occurredAt: z.coerce.date().optional(),
    amount: collectionAmountSchema.optional(),
    paymentMethod: z.enum(paymentMethodValues).optional(),
    externalReference: z.string().trim().max(100).nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
    applications: z.array(collectionApplicationInputSchema).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.applications) assertNoDuplicateTargets(data.applications, ctx);
  });
export type UpdateCustomerCollectionInput = z.infer<typeof updateCustomerCollectionSchema>;

export const customerCollectionListQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  status: z.enum(collectionStatusValues).optional(),
  customerId: z.string().uuid().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type CustomerCollectionListQuery = z.infer<typeof customerCollectionListQuerySchema>;

// ---------- Response DTOs ----------

export interface CustomerCollectionApplicationDto {
  id: string;
  salesDocumentId: string;
  salesDocumentNumber: string;
  amount: string;
}

export interface CustomerCollectionSummaryDto {
  id: string;
  number: string;
  status: CustomerCollectionStatus;
  occurredAt: string;
  customer: { id: string; code: string; legalName: string };
  currencyCode: string;
  amount: string;
  appliedAmount: string;
  unappliedAmount: string;
  paymentMethod: PaymentMethod;
  createdBy: { id: string; name: string | null } | null;
}

export interface CustomerCollectionDetailDto extends CustomerCollectionSummaryDto {
  branchId: string | null;
  currencyId: string;
  externalReference: string | null;
  notes: string | null;
  applications: CustomerCollectionApplicationDto[];
  createdAt: string;
  confirmedAt: string | null;
  confirmedBy: { id: string; name: string | null } | null;
  cancelledAt: string | null;
  cancelledBy: { id: string; name: string | null } | null;
}

export interface CustomerCollectionListResponse {
  items: CustomerCollectionSummaryDto[];
  pagination: PaginationMeta;
}

export interface CustomerCollectionDetailResponse {
  collection: CustomerCollectionDetailDto;
}

// ---------- Spanish presentation layer ----------

export const CUSTOMER_COLLECTION_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Borrador',
  CONFIRMED: 'Confirmado',
  CANCELLED: 'Anulado',
};

export function customerCollectionStatusLabel(value: string): string {
  return CUSTOMER_COLLECTION_STATUS_LABELS[value] ?? value;
}
