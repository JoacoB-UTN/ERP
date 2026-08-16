import { z } from 'zod';
import {
  CustomerType,
  CustomerStatus,
  CustomerDocumentType,
  CustomerTaxCondition,
  CustomerAddressType,
} from './enums';
import { normalizeTaxId, validateTaxIdForDocumentType } from './tax-id';
import { optionalDecimalSchema, percentageSchema } from './decimal';
import type { PaginationMeta } from './api';

/**
 * Customer master data — DTOs, validation, and the Spanish presentation
 * layer for Gestión's /clientes. See docs/customers.md. This is a master
 * module only: no balances, no sales documents (see CLAUDE.md).
 */

const customerTypeValues = Object.values(CustomerType) as [CustomerType, ...CustomerType[]];
const customerStatusValues = Object.values(CustomerStatus) as [CustomerStatus, ...CustomerStatus[]];
const customerDocumentTypeValues = Object.values(CustomerDocumentType) as [
  CustomerDocumentType,
  ...CustomerDocumentType[],
];
const customerTaxConditionValues = Object.values(CustomerTaxCondition) as [
  CustomerTaxCondition,
  ...CustomerTaxCondition[],
];
const customerAddressTypeValues = Object.values(CustomerAddressType) as [
  CustomerAddressType,
  ...CustomerAddressType[],
];

// ---------- Addresses ----------

export const customerAddressInputSchema = z.object({
  type: z.enum(customerAddressTypeValues),
  label: z.string().trim().max(100).optional(),
  street: z.string().trim().min(1, 'La calle es obligatoria.').max(200),
  number: z.string().trim().max(20).optional(),
  floor: z.string().trim().max(20).optional(),
  unit: z.string().trim().max(20).optional(),
  city: z.string().trim().min(1, 'La localidad es obligatoria.').max(100),
  province: z.string().trim().min(1, 'La provincia es obligatoria.').max(100),
  postalCode: z.string().trim().min(1, 'El código postal es obligatorio.').max(20),
  countryCode: z.string().trim().length(2, 'Usá el código de país de 2 letras (ej. AR).').default('AR'),
  additionalInfo: z.string().trim().max(300).optional(),
  isDefault: z.boolean().default(false),
});
export type CustomerAddressInput = z.infer<typeof customerAddressInputSchema>;

export const updateCustomerAddressSchema = customerAddressInputSchema.partial();
export type UpdateCustomerAddressInput = z.infer<typeof updateCustomerAddressSchema>;

// ---------- Contacts ----------

export const customerContactInputSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio.').max(150),
  role: z.string().trim().max(100).optional(),
  email: z.union([z.string().trim().email('Email inválido.').max(200), z.literal('')]).optional(),
  phone: z.string().trim().max(50).optional(),
  mobile: z.string().trim().max(50).optional(),
  notes: z.string().trim().max(500).optional(),
  isPrimary: z.boolean().default(false),
});
export type CustomerContactInput = z.infer<typeof customerContactInputSchema>;

export const updateCustomerContactSchema = customerContactInputSchema.partial();
export type UpdateCustomerContactInput = z.infer<typeof updateCustomerContactSchema>;

// ---------- Customer create/update ----------

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

export const createCustomerSchema = z
  .object({
    code: z.string().trim().max(30).optional(), // manual override; omitted -> auto-generated (see docs/customers.md)
    customerType: z.enum(customerTypeValues).default('COMPANY'),
    legalName: z.string().trim().min(1, 'La razón social / nombre es obligatorio.').max(200),
    tradeName: z.string().trim().max(200).optional(),
    documentType: z.enum(customerDocumentTypeValues).optional(),
    taxId: z.string().trim().max(30).optional(),
    taxCondition: z.enum(customerTaxConditionValues).optional(),
    email: z.union([z.string().trim().email('Email inválido.').max(200), z.literal('')]).optional(),
    phone: z.string().trim().max(50).optional(),
    mobile: z.string().trim().max(50).optional(),
    website: z.string().trim().max(200).optional(),
    creditLimit: optionalDecimalSchema,
    discountPercentage: percentageSchema,
    notes: z.string().trim().max(2000).optional(),
    addresses: z.array(customerAddressInputSchema).default([]),
    contacts: z.array(customerContactInputSchema).default([]),
    categoryIds: z.array(z.string().uuid()).default([]),
  })
  .superRefine(taxIdSuperRefine);
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

export const updateCustomerSchema = z
  .object({
    customerType: z.enum(customerTypeValues).optional(),
    legalName: z.string().trim().min(1, 'La razón social / nombre es obligatorio.').max(200).optional(),
    tradeName: z.string().trim().max(200).nullable().optional(),
    documentType: z.enum(customerDocumentTypeValues).nullable().optional(),
    taxId: z.string().trim().max(30).nullable().optional(),
    taxCondition: z.enum(customerTaxConditionValues).nullable().optional(),
    email: z.union([z.string().trim().email('Email inválido.').max(200), z.literal('')]).nullable().optional(),
    phone: z.string().trim().max(50).nullable().optional(),
    mobile: z.string().trim().max(50).nullable().optional(),
    website: z.string().trim().max(200).nullable().optional(),
    creditLimit: optionalDecimalSchema,
    discountPercentage: percentageSchema,
    notes: z.string().trim().max(2000).nullable().optional(),
    categoryIds: z.array(z.string().uuid()).optional(),
  })
  .superRefine(taxIdSuperRefine);
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

// ---------- Categories ----------

export const createCustomerCategorySchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio.').max(100),
  description: z.string().trim().max(500).optional(),
});
export type CreateCustomerCategoryInput = z.infer<typeof createCustomerCategorySchema>;

export const updateCustomerCategorySchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio.').max(100).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  active: z.boolean().optional(),
});
export type UpdateCustomerCategoryInput = z.infer<typeof updateCustomerCategorySchema>;

export interface CustomerCategoryDto {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
}
export interface CustomerCategoriesResponse {
  categories: CustomerCategoryDto[];
}
export interface CustomerCategoryDetailResponse {
  category: CustomerCategoryDto;
}

// ---------- List / lookup queries ----------

export const customerListQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  status: z.enum(customerStatusValues).optional(),
  customerType: z.enum(customerTypeValues).optional(),
  taxCondition: z.enum(customerTaxConditionValues).optional(),
  categoryId: z.string().uuid().optional(),
  province: z.string().trim().min(1).max(100).optional(),
  sortBy: z.enum(['code', 'legalName', 'createdAt', 'updatedAt']).default('legalName'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type CustomerListQuery = z.infer<typeof customerListQuerySchema>;

export const customerLookupQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type CustomerLookupQuery = z.infer<typeof customerLookupQuerySchema>;

export const customerHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type CustomerHistoryQuery = z.infer<typeof customerHistoryQuerySchema>;

// ---------- Response DTOs ----------

export interface CustomerAddressDto {
  id: string;
  type: CustomerAddressType;
  label: string | null;
  street: string;
  number: string | null;
  floor: string | null;
  unit: string | null;
  city: string;
  province: string;
  postalCode: string;
  countryCode: string;
  additionalInfo: string | null;
  isDefault: boolean;
}

export interface CustomerContactDto {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  notes: string | null;
  isPrimary: boolean;
}

export interface CustomerSummary {
  id: string;
  code: string;
  customerType: CustomerType;
  legalName: string;
  tradeName: string | null;
  /** tradeName if set, otherwise legalName — computed once server-side so every list/lookup/detail surface agrees (see docs/customers.md). */
  displayName: string;
  documentType: CustomerDocumentType | null;
  taxId: string | null;
  taxIdFormatted: string | null;
  taxCondition: CustomerTaxCondition | null;
  email: string | null;
  phone: string | null;
  status: CustomerStatus;
}

export interface CustomerDetail extends CustomerSummary {
  mobile: string | null;
  website: string | null;
  creditLimit: string | null;
  discountPercentage: string | null;
  notes: string | null;
  addresses: CustomerAddressDto[];
  contacts: CustomerContactDto[];
  categories: CustomerCategoryDto[];
  createdAt: string;
  updatedAt: string;
}

export interface CustomerListResponse {
  items: CustomerSummary[];
  pagination: PaginationMeta;
}

export interface CustomerDetailResponse {
  customer: CustomerDetail;
}

export interface CustomerAddressResponse {
  address: CustomerAddressDto;
}

export interface CustomerContactResponse {
  contact: CustomerContactDto;
}

export interface CustomerLookupItem {
  id: string;
  code: string;
  displayName: string;
  legalName: string;
  taxId: string | null;
  taxCondition: CustomerTaxCondition | null;
  status: CustomerStatus;
}

export interface CustomerLookupResponse {
  items: CustomerLookupItem[];
}

// ---------- Spanish presentation layer ----------

export const CUSTOMER_TYPE_LABELS: Record<string, string> = {
  COMPANY: 'Empresa',
  INDIVIDUAL: 'Persona',
  FINAL_CONSUMER: 'Consumidor final',
  FOREIGN: 'Cliente del exterior',
};

export const CUSTOMER_DOCUMENT_TYPE_LABELS: Record<string, string> = {
  CUIT: 'CUIT',
  CUIL: 'CUIL',
  DNI: 'DNI',
  PASSPORT: 'Pasaporte',
  OTHER: 'Otro',
};

export const CUSTOMER_TAX_CONDITION_LABELS: Record<string, string> = {
  RESPONSABLE_INSCRIPTO: 'Responsable Inscripto',
  MONOTRIBUTO: 'Monotributo',
  EXENTO: 'Exento',
  CONSUMIDOR_FINAL: 'Consumidor Final',
  NO_RESPONSABLE: 'No Responsable',
  EXTERIOR: 'Cliente del Exterior',
  OTHER: 'Otro',
};

export const CUSTOMER_ADDRESS_TYPE_LABELS: Record<string, string> = {
  FISCAL: 'Domicilio fiscal',
  BILLING: 'Facturación',
  SHIPPING: 'Entrega',
  OTHER: 'Otro',
};

export const CUSTOMER_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Activo',
  INACTIVE: 'Inactivo',
};

export function customerTypeLabel(value: string): string {
  return CUSTOMER_TYPE_LABELS[value] ?? value;
}
export function customerDocumentTypeLabel(value: string): string {
  return CUSTOMER_DOCUMENT_TYPE_LABELS[value] ?? value;
}
export function customerTaxConditionLabel(value: string): string {
  return CUSTOMER_TAX_CONDITION_LABELS[value] ?? value;
}
export function customerAddressTypeLabel(value: string): string {
  return CUSTOMER_ADDRESS_TYPE_LABELS[value] ?? value;
}
export function customerStatusLabel(value: string): string {
  return CUSTOMER_STATUS_LABELS[value] ?? value;
}

/** Argentina's 24 provinces/CABA — a plain reference list for the address form's province field, not a validated/authoritative geo dataset. */
export const ARGENTINA_PROVINCES = [
  'Buenos Aires',
  'Ciudad Autónoma de Buenos Aires',
  'Catamarca',
  'Chaco',
  'Chubut',
  'Córdoba',
  'Corrientes',
  'Entre Ríos',
  'Formosa',
  'Jujuy',
  'La Pampa',
  'La Rioja',
  'Mendoza',
  'Misiones',
  'Neuquén',
  'Río Negro',
  'Salta',
  'San Juan',
  'San Luis',
  'Santa Cruz',
  'Santa Fe',
  'Santiago del Estero',
  'Tierra del Fuego',
  'Tucumán',
] as const;
