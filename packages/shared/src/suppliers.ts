import { z } from 'zod';
import { SupplierStatus, CustomerDocumentType, CustomerTaxCondition } from './enums';
import { normalizeTaxId, validateTaxIdForDocumentType } from './tax-id';
import type { PaginationMeta } from './api';

/**
 * Supplier master data — DTOs, validation, and the Spanish presentation
 * layer for Gestión's /compras/proveedores. See docs/purchases.md.
 *
 * Deliberately reuses CustomerDocumentType/CustomerTaxCondition rather than
 * minting SupplierDocumentType/SupplierTaxCondition twins with identical
 * values — see CLAUDE.md ("reuse Customer/fiscal enums... rather than
 * creating duplicate Argentina tax concepts") and docs/purchases.md's
 * documented naming deviation. Frontend code should import
 * customerDocumentTypeLabel/customerTaxConditionLabel from ./customers for
 * display — no separate supplier label maps exist for these two fields.
 */

const supplierStatusValues = Object.values(SupplierStatus) as [SupplierStatus, ...SupplierStatus[]];
const supplierDocumentTypeValues = Object.values(CustomerDocumentType) as [
  CustomerDocumentType,
  ...CustomerDocumentType[],
];
const supplierTaxConditionValues = Object.values(CustomerTaxCondition) as [
  CustomerTaxCondition,
  ...CustomerTaxCondition[],
];

function taxIdSuperRefine(
  data: { documentType?: CustomerDocumentType | null; taxId?: string | null },
  ctx: z.RefinementCtx,
) {
  if (!data.taxId) return;
  const normalized = normalizeTaxId(data.taxId);
  const result = validateTaxIdForDocumentType(data.documentType ?? null, normalized);
  if (!result.valid) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.message, path: ['taxId'] });
  }
}

export const createSupplierSchema = z
  .object({
    code: z.string().trim().max(30).optional(), // manual override; omitted -> auto-generated
    legalName: z.string().trim().min(1, 'La razón social es obligatoria.').max(200),
    tradeName: z.string().trim().max(200).optional(),
    documentType: z.enum(supplierDocumentTypeValues).optional(),
    taxId: z.string().trim().max(30).optional(),
    taxCondition: z.enum(supplierTaxConditionValues).optional(),
    email: z.union([z.string().trim().email('Email inválido.').max(200), z.literal('')]).optional(),
    phone: z.string().trim().max(50).optional(),
    address: z.string().trim().max(200).optional(),
    city: z.string().trim().max(100).optional(),
    province: z.string().trim().max(100).optional(),
    postalCode: z.string().trim().max(20).optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .superRefine(taxIdSuperRefine);
export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;

export const updateSupplierSchema = z
  .object({
    legalName: z.string().trim().min(1, 'La razón social es obligatoria.').max(200).optional(),
    tradeName: z.string().trim().max(200).nullable().optional(),
    documentType: z.enum(supplierDocumentTypeValues).nullable().optional(),
    taxId: z.string().trim().max(30).nullable().optional(),
    taxCondition: z.enum(supplierTaxConditionValues).nullable().optional(),
    email: z.union([z.string().trim().email('Email inválido.').max(200), z.literal('')]).nullable().optional(),
    phone: z.string().trim().max(50).nullable().optional(),
    address: z.string().trim().max(200).nullable().optional(),
    city: z.string().trim().max(100).nullable().optional(),
    province: z.string().trim().max(100).nullable().optional(),
    postalCode: z.string().trim().max(20).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .superRefine(taxIdSuperRefine);
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;

export const supplierListQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  status: z.enum(supplierStatusValues).optional(),
  sortBy: z.enum(['code', 'legalName', 'createdAt', 'updatedAt']).default('legalName'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type SupplierListQuery = z.infer<typeof supplierListQuerySchema>;

export const supplierLookupQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type SupplierLookupQuery = z.infer<typeof supplierLookupQuerySchema>;

// ---------- Response DTOs ----------

export interface SupplierSummary {
  id: string;
  code: string;
  legalName: string;
  tradeName: string | null;
  displayName: string;
  documentType: CustomerDocumentType | null;
  taxId: string | null;
  taxIdFormatted: string | null;
  taxCondition: CustomerTaxCondition | null;
  email: string | null;
  phone: string | null;
  status: SupplierStatus;
}

export interface SupplierDetail extends SupplierSummary {
  address: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierListResponse {
  items: SupplierSummary[];
  pagination: PaginationMeta;
}

export interface SupplierDetailResponse {
  supplier: SupplierDetail;
}

export interface SupplierLookupItem {
  id: string;
  code: string;
  displayName: string;
  legalName: string;
  taxId: string | null;
  status: SupplierStatus;
}

export interface SupplierLookupResponse {
  items: SupplierLookupItem[];
}

// ---------- Spanish presentation layer ----------

export const SUPPLIER_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Activo',
  INACTIVE: 'Inactivo',
};

export function supplierStatusLabel(value: string): string {
  return SUPPLIER_STATUS_LABELS[value] ?? value;
}
