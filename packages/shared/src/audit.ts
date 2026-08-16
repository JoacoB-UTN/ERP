import { z } from 'zod';
import { AuditAction } from './enums';
import type { PaginationMeta } from './api';

/**
 * Business/administrative audit trail — DTOs, query schema, and the
 * Spanish presentation layer for Gestión's /administracion/auditoria.
 * See docs/audit-architecture.md. Distinct from application logs.
 */

const auditActionValues = Object.values(AuditAction) as [AuditAction, ...AuditAction[]];

export const auditListQuerySchema = z.object({
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  userId: z.string().uuid('Identificador de usuario inválido.').optional(),
  action: z.enum(auditActionValues).optional(),
  entityType: z.string().trim().min(1).max(100).optional(),
  entityId: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type AuditListQuery = z.infer<typeof auditListQuerySchema>;

export const auditEntityHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type AuditEntityHistoryQuery = z.infer<typeof auditEntityHistoryQuerySchema>;

/**
 * Known, machine-readable entity types the audit trail (and the future
 * per-entity "Historial" tab, see section 53/55) understands today. Keep
 * this in sync with what backend services actually pass as `entityType` —
 * see CLAUDE.md's audit rules. GET /administration/audit/entity/:entityType/:id
 * rejects anything outside this list rather than allowing arbitrary
 * dynamic lookups.
 */
export const AUDITABLE_ENTITY_TYPES = [
  'User',
  'UserCompany',
  'Role',
  'Permission',
  'UserRole',
  'Company',
  'Branch',
  'Customer',
  'Product',
  'ProductCategory',
  'Brand',
  'Warehouse',
  'StockAdjustment',
  'PriceList',
  'SalesDocument',
] as const;
export type AuditableEntityType = (typeof AUDITABLE_ENTITY_TYPES)[number];

export interface AuditActorSummary {
  id: string;
  name: string | null;
}

export interface AuditLogSummary {
  id: string;
  occurredAt: string;
  action: AuditAction;
  entityType: string;
  entityId: string | null;
  user: AuditActorSummary | null;
  branchId: string | null;
}

export interface AuditListResponse {
  items: AuditLogSummary[];
  pagination: PaginationMeta;
}

export interface AuditLogDetail extends AuditLogSummary {
  companyId: string | null;
  userEmail: string | null;
  beforeData: unknown;
  afterData: unknown;
  metadata: unknown;
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface AuditDetailResponse {
  auditLog: AuditLogDetail;
}

/**
 * Per-entity history returns full detail per row (not the lean summary
 * the general admin list uses) — a customer's own "Historial" tab (and
 * any future per-entity "Historial" tab, see docs/customers.md) renders a
 * readable inline diff per event without an N+1 detail fetch per row.
 */
export interface AuditEntityHistoryResponse {
  items: AuditLogDetail[];
  pagination: PaginationMeta;
}

/** Stored audit action codes stay English/stable (see CLAUDE.md) — this is presentation only. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  CREATE: 'Creó',
  UPDATE: 'Modificó',
  DELETE: 'Eliminó',
  ACTIVATE: 'Activó',
  DEACTIVATE: 'Desactivó',
  ASSIGN: 'Asignó',
  UNASSIGN: 'Quitó',
  APPROVE: 'Aprobó',
  REJECT: 'Rechazó',
  CANCEL: 'Anuló',
  VOID: 'Invalidó',
  CONFIRM: 'Confirmó',
  LOGIN: 'Inició sesión',
  LOGOUT: 'Cerró sesión',
  PASSWORD_CHANGE: 'Cambió su contraseña',
  PASSWORD_RESET: 'Restableció su contraseña',
  SESSION_REVOKE: 'Revocó sesiones',
  PERMISSIONS_CHANGE: 'Modificó permisos',
  EXPORT: 'Exportó datos',
};

export const AUDIT_ENTITY_LABELS: Record<string, string> = {
  User: 'Usuario',
  UserCompany: 'Membresía de empresa',
  Role: 'Rol',
  Permission: 'Permiso',
  UserRole: 'Asignación de rol',
  Company: 'Empresa',
  Branch: 'Sucursal',
  Customer: 'Cliente',
  Product: 'Producto',
  // ProductVariant is presentation-only — variant changes are recorded
  // under entityType 'Product' via metadata, never as their own row (see
  // docs/products.md), but the label is registered for completeness.
  ProductVariant: 'Variante de producto',
  ProductCategory: 'Categoría de producto',
  Brand: 'Marca',
  Warehouse: 'Depósito',
  StockAdjustment: 'Ajuste de stock',
  PriceList: 'Lista de precios',
  // PriceListItem changes are recorded under entityType 'PriceList' via
  // metadata (see docs/pricing.md), never as their own row — same pattern
  // as ProductVariant — but the label is registered for completeness.
  PriceListItem: 'Precio',
  SalesDocument: 'Venta',
};

/** Friendly labels for the fields most likely to show up in before/after diffs. Unknown fields fall back to the raw key (section 50) — no attempt to translate everything. */
export const AUDIT_FIELD_LABELS: Record<string, string> = {
  name: 'Nombre',
  description: 'Descripción',
  active: 'Activo',
  isSystem: 'Es de sistema',
  legalName: 'Razón social / Nombre',
  tradeName: 'Nombre comercial',
  taxId: 'CUIT / Documento',
  taxCondition: 'Condición fiscal',
  documentType: 'Tipo de documento',
  customerType: 'Tipo de cliente',
  creditLimit: 'Límite de crédito',
  discountPercentage: 'Descuento predeterminado',
  email: 'Email',
  phone: 'Teléfono',
  mobile: 'Celular',
  website: 'Sitio web',
  notes: 'Notas',
  status: 'Estado',
  code: 'Código',
  productType: 'Tipo de producto',
  categoryId: 'Categoría',
  brandId: 'Marca',
  baseUnitId: 'Unidad de medida',
  trackInventory: 'Controla stock',
  trackLots: 'Control por lote',
  trackSerials: 'Control por número de serie',
  allowNegativeStock: 'Permite stock negativo',
  minimumStock: 'Stock mínimo',
  maximumStock: 'Stock máximo',
  reorderPoint: 'Punto de reposición',
  sku: 'SKU',
  allowsSales: 'Permite ventas',
  allowsPurchases: 'Permite compras',
  branchId: 'Sucursal',
  warehouseId: 'Depósito',
  reason: 'Motivo',
  number: 'Número',
  currencyId: 'Moneda',
  includesTax: 'Incluye impuestos',
  pricingMode: 'Tipo',
  basePriceListId: 'Lista base',
  adjustmentType: 'Tipo de ajuste',
  adjustmentValue: 'Valor del ajuste',
  isDefault: 'Predeterminada',
  price: 'Precio',
  effectiveFrom: 'Vigente desde',
  effectiveUntil: 'Vigente hasta',
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

export function auditEntityLabel(entityType: string): string {
  return AUDIT_ENTITY_LABELS[entityType] ?? entityType;
}

export function auditFieldLabel(field: string): string {
  return AUDIT_FIELD_LABELS[field] ?? field;
}
