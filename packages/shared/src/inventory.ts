import { z } from 'zod';
import { MovementType, StockAdjustmentStatus, ProductStatus } from './enums';
import type { WarehouseStatus } from './enums';
import { quantitySchema } from './decimal';
import type { PaginationMeta } from './api';

/**
 * Inventory ledger — DTOs, validation, and the Spanish presentation layer
 * for Gestión's /stock. See docs/inventory.md. StockMovement is the only
 * authoritative source of physical inventory; InventoryBalance is a
 * rebuildable projection (see CLAUDE.md).
 */

const movementTypeValues = Object.values(MovementType) as [MovementType, ...MovementType[]];
const stockAdjustmentStatusValues = Object.values(StockAdjustmentStatus) as [
  StockAdjustmentStatus,
  ...StockAdjustmentStatus[],
];
const productStatusValues = Object.values(ProductStatus) as [ProductStatus, ...ProductStatus[]];

/**
 * Signed-quantity convention per MovementType — see docs/inventory.md.
 * Used to derive movementType from a signed delta (adjustments) and to
 * validate manually-constructed movements server-side, never trusted
 * from a client payload directly (see CLAUDE.md).
 */
export const MOVEMENT_TYPE_SIGN: Record<MovementType, 1 | -1> = {
  INITIAL_BALANCE: 1,
  ADJUSTMENT_IN: 1,
  ADJUSTMENT_OUT: -1,
  TRANSFER_IN: 1,
  TRANSFER_OUT: -1,
  PURCHASE: 1,
  PURCHASE_RETURN: -1,
  SALE: -1,
  SALE_RETURN: 1,
  DELIVERY: -1,
  PRODUCTION_IN: 1,
  PRODUCTION_OUT: -1,
};

// ---------- Warehouses ----------

export const createWarehouseSchema = z.object({
  branchId: z.string().uuid().optional(),
  code: z.string().trim().min(1, 'El código es obligatorio.').max(30),
  name: z.string().trim().min(1, 'El nombre es obligatorio.').max(150),
  description: z.string().trim().max(500).optional(),
  allowsSales: z.boolean().default(true),
  allowsPurchases: z.boolean().default(true),
  allowNegativeStock: z.boolean().default(false),
});
export type CreateWarehouseInput = z.infer<typeof createWarehouseSchema>;

export const updateWarehouseSchema = z.object({
  branchId: z.string().uuid().nullable().optional(),
  code: z.string().trim().min(1, 'El código es obligatorio.').max(30).optional(),
  name: z.string().trim().min(1, 'El nombre es obligatorio.').max(150).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  allowsSales: z.boolean().optional(),
  allowsPurchases: z.boolean().optional(),
  allowNegativeStock: z.boolean().optional(),
});
export type UpdateWarehouseInput = z.infer<typeof updateWarehouseSchema>;

export interface WarehouseDto {
  id: string;
  branchId: string | null;
  branchName: string | null;
  code: string;
  name: string;
  description: string | null;
  allowsSales: boolean;
  allowsPurchases: boolean;
  allowNegativeStock: boolean;
  status: WarehouseStatus;
}
export interface WarehousesResponse {
  warehouses: WarehouseDto[];
}
export interface WarehouseDetailResponse {
  warehouse: WarehouseDto;
}

// ---------- Stock summary / lookup ----------

export const stockListQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  warehouseId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  brandId: z.string().uuid().optional(),
  status: z.enum(productStatusValues).optional(),
  /** AVAILABLE < Product.minimumStock — see docs/inventory.md for why AVAILABLE, not ON_HAND. */
  belowMinimum: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type StockListQuery = z.infer<typeof stockListQuerySchema>;

export interface StockRowDto {
  productId: string;
  variantId: string;
  productCode: string;
  sku: string | null;
  productName: string;
  variantName: string | null;
  productStatus: ProductStatus;
  warehouse: { id: string; code: string; name: string };
  onHand: string;
  reserved: string;
  available: string;
  incoming: string;
  minimumStock: string | null;
  belowMinimum: boolean;
}
export interface StockListResponse {
  items: StockRowDto[];
  pagination: PaginationMeta;
}

interface WarehouseBreakdownDto {
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  onHand: string;
  reserved: string;
  available: string;
  incoming: string;
}

export interface ProductStockResponse {
  productId: string;
  productName: string;
  productCode: string;
  variants: {
    variantId: string;
    variantName: string | null;
    sku: string | null;
    warehouses: WarehouseBreakdownDto[];
  }[];
}

export interface VariantStockResponse {
  variantId: string;
  productId: string;
  productCode: string;
  productName: string;
  variantName: string | null;
  sku: string | null;
  warehouses: WarehouseBreakdownDto[];
}

/**
 * Inventory-aware operational lookup — extends the plain product lookup
 * with `available` for a given warehouse (see docs/inventory.md's
 * Facturación preparation section). Deliberately a separate query from
 * ProductsService.lookup, not a modification to it — see CLAUDE.md.
 */
export const inventoryLookupQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  barcode: z.string().trim().min(1).max(100).optional(),
  warehouseId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type InventoryLookupQuery = z.infer<typeof inventoryLookupQuerySchema>;

export interface InventoryLookupItem {
  productId: string;
  variantId: string;
  productCode: string;
  sku: string | null;
  name: string;
  variantName: string | null;
  barcode: string | null;
  productType: string;
  active: boolean;
  /** null when no warehouseId was given — never fabricated (see docs/inventory.md). */
  available: string | null;
}
export interface InventoryLookupResponse {
  items: InventoryLookupItem[];
}

// ---------- Movements ----------

export const movementListQuerySchema = z.object({
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  warehouseId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  variantId: z.string().uuid().optional(),
  movementType: z.enum(movementTypeValues).optional(),
  referenceType: z.string().trim().max(100).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type MovementListQuery = z.infer<typeof movementListQuerySchema>;

export interface StockMovementDto {
  id: string;
  occurredAt: string;
  warehouse: { id: string; code: string; name: string };
  productId: string;
  productCode: string;
  productName: string;
  variantId: string;
  variantName: string | null;
  sku: string | null;
  movementType: MovementType;
  quantity: string;
  referenceType: string | null;
  referenceId: string | null;
  reason: string | null;
  notes: string | null;
  createdBy: { id: string; name: string | null } | null;
  createdAt: string;
}
export interface MovementListResponse {
  items: StockMovementDto[];
  pagination: PaginationMeta;
}
export interface MovementDetailResponse {
  movement: StockMovementDto;
}

// ---------- Initial balance ----------

const initialBalanceLineSchema = z
  .object({
    productVariantId: z.string().uuid('Variante inválida.'),
    quantity: quantitySchema,
  })
  .superRefine((data, ctx) => {
    if (Number(data.quantity) <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'La cantidad inicial debe ser mayor a cero.',
        path: ['quantity'],
      });
    }
  });
export type InitialBalanceLineInput = z.infer<typeof initialBalanceLineSchema>;

export const createInitialBalanceSchema = z.object({
  warehouseId: z.string().uuid('Elegí un depósito.'),
  occurredAt: z.coerce.date().optional(),
  notes: z.string().trim().max(1000).optional(),
  lines: z.array(initialBalanceLineSchema).min(1, 'Agregá al menos una línea.'),
});
export type CreateInitialBalanceInput = z.infer<typeof createInitialBalanceSchema>;

export interface InitialBalanceResponse {
  movements: StockMovementDto[];
}

// ---------- Stock adjustments ----------

const stockAdjustmentLineInputSchema = z
  .object({
    productVariantId: z.string().uuid('Variante inválida.'),
    quantityDelta: quantitySchema,
    reason: z.string().trim().max(200).optional(),
  })
  .superRefine((data, ctx) => {
    if (Number(data.quantityDelta) === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'La cantidad no puede ser cero.',
        path: ['quantityDelta'],
      });
    }
  });
export type StockAdjustmentLineInput = z.infer<typeof stockAdjustmentLineInputSchema>;

export const createStockAdjustmentSchema = z.object({
  warehouseId: z.string().uuid('Elegí un depósito.'),
  reason: z.string().trim().min(1, 'El motivo es obligatorio.').max(200),
  notes: z.string().trim().max(1000).optional(),
  occurredAt: z.coerce.date().optional(),
  lines: z.array(stockAdjustmentLineInputSchema).min(1, 'Agregá al menos una línea.'),
});
export type CreateStockAdjustmentInput = z.infer<typeof createStockAdjustmentSchema>;

/** Only valid while the adjustment is DRAFT — see docs/inventory.md. */
export const updateStockAdjustmentSchema = z.object({
  warehouseId: z.string().uuid().optional(),
  reason: z.string().trim().min(1, 'El motivo es obligatorio.').max(200).optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  occurredAt: z.coerce.date().optional(),
  lines: z.array(stockAdjustmentLineInputSchema).min(1, 'Agregá al menos una línea.').optional(),
});
export type UpdateStockAdjustmentInput = z.infer<typeof updateStockAdjustmentSchema>;

export const stockAdjustmentListQuerySchema = z.object({
  warehouseId: z.string().uuid().optional(),
  status: z.enum(stockAdjustmentStatusValues).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type StockAdjustmentListQuery = z.infer<typeof stockAdjustmentListQuerySchema>;

export interface StockAdjustmentLineDto {
  id: string;
  productVariantId: string;
  productId: string;
  productName: string;
  variantName: string | null;
  sku: string | null;
  quantityDelta: string;
  reason: string | null;
}

export interface StockAdjustmentSummary {
  id: string;
  number: string;
  warehouseId: string;
  warehouseName: string;
  reason: string;
  status: StockAdjustmentStatus;
  occurredAt: string;
  lineCount: number;
  createdBy: { id: string; name: string | null } | null;
}

export interface StockAdjustmentDetail extends StockAdjustmentSummary {
  notes: string | null;
  lines: StockAdjustmentLineDto[];
  createdAt: string;
  confirmedAt: string | null;
}

export interface StockAdjustmentListResponse {
  items: StockAdjustmentSummary[];
  pagination: PaginationMeta;
}
export interface StockAdjustmentDetailResponse {
  adjustment: StockAdjustmentDetail;
}

// ---------- Spanish presentation layer ----------

export const WAREHOUSE_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Activo',
  INACTIVE: 'Inactivo',
};

export const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  INITIAL_BALANCE: 'Saldo inicial',
  ADJUSTMENT_IN: 'Ajuste (entrada)',
  ADJUSTMENT_OUT: 'Ajuste (salida)',
  TRANSFER_IN: 'Transferencia (entrada)',
  TRANSFER_OUT: 'Transferencia (salida)',
  PURCHASE: 'Compra',
  PURCHASE_RETURN: 'Devolución a proveedor',
  SALE: 'Venta',
  SALE_RETURN: 'Devolución de venta',
  DELIVERY: 'Entrega',
  PRODUCTION_IN: 'Producción (entrada)',
  PRODUCTION_OUT: 'Producción (salida)',
};

export const RESERVATION_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Activa',
  PARTIALLY_CONSUMED: 'Parcialmente consumida',
  CONSUMED: 'Consumida',
  RELEASED: 'Liberada',
  EXPIRED: 'Expirada',
};

export const STOCK_ADJUSTMENT_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Borrador',
  CONFIRMED: 'Confirmado',
  CANCELLED: 'Cancelado',
};

export function warehouseStatusLabel(value: string): string {
  return WAREHOUSE_STATUS_LABELS[value] ?? value;
}
export function movementTypeLabel(value: string): string {
  return MOVEMENT_TYPE_LABELS[value] ?? value;
}
export function reservationStatusLabel(value: string): string {
  return RESERVATION_STATUS_LABELS[value] ?? value;
}
export function stockAdjustmentStatusLabel(value: string): string {
  return STOCK_ADJUSTMENT_STATUS_LABELS[value] ?? value;
}
