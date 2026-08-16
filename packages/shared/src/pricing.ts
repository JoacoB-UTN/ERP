import { z } from 'zod';
import { AdjustmentType, PriceChangeType, PricingMode, ProductStatus } from './enums';
import { moneySchema, adjustmentValueSchema } from './decimal';
import type { PaginationMeta } from './api';

/**
 * Pricing — PriceList/PriceListItem/PriceHistory DTOs, validation, and the
 * Spanish presentation layer for Gestión's /listas-de-precios. See
 * docs/pricing.md. Products never own an authoritative sale price (see
 * CLAUDE.md) — PriceListItem is the only place a sale price is stored,
 * and only through PricingService.
 */

const pricingModeValues = Object.values(PricingMode) as [PricingMode, ...PricingMode[]];
const adjustmentTypeValues = Object.values(AdjustmentType) as [AdjustmentType, ...AdjustmentType[]];
const productStatusValues = Object.values(ProductStatus) as [ProductStatus, ...ProductStatus[]];

// ---------- Currency ----------

export interface CurrencyDto {
  id: string;
  code: string;
  name: string;
  symbol: string;
  decimalPlaces: number;
  active: boolean;
}
export interface CurrenciesResponse {
  currencies: CurrencyDto[];
}

// ---------- Price lists ----------

const bulkAdjustScopeValues = ['ALL', 'CATEGORY', 'BRAND'] as const;

export const createPriceListSchema = z
  .object({
    code: z.string().trim().min(1, 'El código es obligatorio.').max(30),
    name: z.string().trim().min(1, 'El nombre es obligatorio.').max(150),
    description: z.string().trim().max(500).optional(),
    currencyId: z.string().uuid('Elegí una moneda.'),
    includesTax: z.boolean().default(false),
    pricingMode: z.enum(pricingModeValues).default('FIXED'),
    basePriceListId: z.string().uuid().optional(),
    adjustmentType: z.enum(adjustmentTypeValues).optional(),
    adjustmentValue: adjustmentValueSchema.optional(),
    isDefault: z.boolean().default(false),
  })
  .superRefine((data, ctx) => {
    if (data.pricingMode === 'DERIVED') {
      if (!data.basePriceListId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Elegí una lista base.', path: ['basePriceListId'] });
      }
      if (!data.adjustmentType) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Elegí un tipo de ajuste.', path: ['adjustmentType'] });
      }
      if (data.adjustmentValue === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Ingresá el valor del ajuste.',
          path: ['adjustmentValue'],
        });
      }
    } else if (data.basePriceListId || data.adjustmentType || data.adjustmentValue !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Una lista fija no admite lista base ni ajuste.',
        path: ['pricingMode'],
      });
    }
  });
export type CreatePriceListInput = z.infer<typeof createPriceListSchema>;

/**
 * `pricingMode` and `currencyId` are intentionally NOT editable after
 * creation — switching them would silently reinterpret existing
 * PriceListItem rows under different semantics (see docs/pricing.md's
 * historical-currency rule). Create a new list instead.
 * `basePriceListId`/`adjustmentType`/`adjustmentValue` ARE editable (a
 * "derived rule changed" is a normal, auditable operation) but only valid
 * when the list's pricingMode is already DERIVED — validated server-side
 * against the existing record, same pattern as ProductsService's
 * inventory-config cross-field validation.
 */
export const updatePriceListSchema = z.object({
  code: z.string().trim().min(1, 'El código es obligatorio.').max(30).optional(),
  name: z.string().trim().min(1, 'El nombre es obligatorio.').max(150).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  includesTax: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  basePriceListId: z.string().uuid().optional(),
  adjustmentType: z.enum(adjustmentTypeValues).optional(),
  adjustmentValue: adjustmentValueSchema.optional(),
});
export type UpdatePriceListInput = z.infer<typeof updatePriceListSchema>;

export interface PriceListDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  currencyId: string;
  currencyCode: string;
  currencySymbol: string;
  pricingMode: PricingMode;
  includesTax: boolean;
  basePriceListId: string | null;
  basePriceListName: string | null;
  adjustmentType: AdjustmentType | null;
  adjustmentValue: string | null;
  isDefault: boolean;
  active: boolean;
}
export interface PriceListsResponse {
  priceLists: PriceListDto[];
}
export interface PriceListDetailResponse {
  priceList: PriceListDto;
}

// ---------- Price list items (catalog + current price, joined at read time) ----------

export const priceListItemsQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  categoryId: z.string().uuid().optional(),
  brandId: z.string().uuid().optional(),
  status: z.enum(productStatusValues).optional(),
  hasPrice: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type PriceListItemsQuery = z.infer<typeof priceListItemsQuerySchema>;

/** `price: null` means "Sin precio" — never fabricated as "0" (see docs/pricing.md). */
export interface PriceListItemRowDto {
  variantId: string;
  productId: string;
  productCode: string;
  sku: string | null;
  productName: string;
  variantName: string | null;
  categoryName: string | null;
  brandName: string | null;
  price: string | null;
  effectiveFrom: string | null;
  source: 'FIXED' | 'DERIVED';
}
export interface PriceListItemsResponse {
  items: PriceListItemRowDto[];
  pagination: PaginationMeta;
}

// ---------- Setting prices (FIXED lists only) ----------

export const setPriceSchema = z.object({
  price: moneySchema,
  effectiveFrom: z.coerce.date().optional(),
  reason: z.string().trim().max(300).optional(),
});
export type SetPriceInput = z.infer<typeof setPriceSchema>;

const batchPriceLineSchema = z.object({
  productVariantId: z.string().uuid('Variante inválida.'),
  price: moneySchema,
});
export const setPricesBatchSchema = z.object({
  effectiveFrom: z.coerce.date().optional(),
  reason: z.string().trim().max(300).optional(),
  items: z.array(batchPriceLineSchema).min(1, 'Agregá al menos una línea.'),
});
export type SetPricesBatchInput = z.infer<typeof setPricesBatchSchema>;

export interface PriceSetResultDto {
  variantId: string;
  price: string;
  effectiveFrom: string;
}
export interface SetPriceResponse {
  result: PriceSetResultDto;
}
export interface SetPricesBatchResponse {
  results: PriceSetResultDto[];
}

// ---------- Bulk adjustment (FIXED lists only) ----------

export const bulkAdjustSchema = z
  .object({
    adjustmentType: z.enum(adjustmentTypeValues),
    value: adjustmentValueSchema,
    effectiveFrom: z.coerce.date(),
    reason: z.string().trim().max(300).optional(),
    scope: z.enum(bulkAdjustScopeValues).default('ALL'),
    categoryId: z.string().uuid().optional(),
    brandId: z.string().uuid().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.scope === 'CATEGORY' && !data.categoryId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Elegí una categoría.', path: ['categoryId'] });
    }
    if (data.scope === 'BRAND' && !data.brandId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Elegí una marca.', path: ['brandId'] });
    }
  });
export type BulkAdjustInput = z.infer<typeof bulkAdjustSchema>;

export interface BulkAdjustPreviewLineDto {
  variantId: string;
  productName: string;
  variantName: string | null;
  sku: string | null;
  currentPrice: string;
  newPrice: string;
}
/** No database changes happen while producing this — see docs/pricing.md. */
export interface BulkAdjustPreviewResponse {
  affectedCount: number;
  lines: BulkAdjustPreviewLineDto[];
}
export interface BulkAdjustResponse {
  affectedCount: number;
}

// ---------- PriceList administrative history (AuditLog, not PriceHistory — see docs/pricing.md) ----------

export const priceListHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type PriceListHistoryQuery = z.infer<typeof priceListHistoryQuerySchema>;

// ---------- Price history ----------

export const priceHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type PriceHistoryQuery = z.infer<typeof priceHistoryQuerySchema>;

export interface PriceHistoryEntryDto {
  id: string;
  oldPrice: string | null;
  newPrice: string;
  effectiveFrom: string;
  changeType: PriceChangeType;
  reason: string | null;
  changedBy: { id: string; name: string | null } | null;
  changedAt: string;
}
export interface PriceHistoryResponse {
  items: PriceHistoryEntryDto[];
  pagination: PaginationMeta;
}

// ---------- Operational lookup (future Facturación/POS — see docs/pricing.md) ----------

export const priceLookupQuerySchema = z.object({
  priceListId: z.string().uuid('Elegí una lista de precios.'),
  productVariantId: z.string().uuid('Variante inválida.'),
  date: z.coerce.date().optional(),
});
export type PriceLookupQuery = z.infer<typeof priceLookupQuerySchema>;

export interface PriceLookupResult {
  price: string;
  currencyCode: string;
  priceListId: string;
  priceListName: string;
  source: 'FIXED' | 'DERIVED';
  basePriceListId?: string;
  /** Compact display string, e.g. "-10%" or "+1500" — see docs/pricing.md. */
  adjustment?: string;
  /** The underlying FIXED price's effective date, propagated through any DERIVED chain. */
  effectiveFrom?: string;
}
export interface PriceLookupResponse {
  result: PriceLookupResult;
}

export const priceLookupBatchSchema = z.object({
  priceListId: z.string().uuid('Elegí una lista de precios.'),
  productVariantIds: z.array(z.string().uuid()).min(1).max(200),
  date: z.coerce.date().optional(),
});
export type PriceLookupBatchInput = z.infer<typeof priceLookupBatchSchema>;

/** `found: false` (never a fabricated "0") signals a missing price — see docs/pricing.md. */
export interface PriceLookupBatchItemDto {
  productVariantId: string;
  found: boolean;
  price: string | null;
  source: 'FIXED' | 'DERIVED' | null;
}
export interface PriceLookupBatchResponse {
  currencyCode: string;
  priceListId: string;
  items: PriceLookupBatchItemDto[];
}

// ---------- Product price view (Product detail "Precios" tab) ----------

export interface ProductPriceRowDto {
  priceListId: string;
  priceListName: string;
  priceListCode: string;
  currencyCode: string;
  price: string | null;
  effectiveFrom: string | null;
  source: 'FIXED' | 'DERIVED';
}
export interface ProductVariantPricesDto {
  variantId: string;
  variantName: string | null;
  sku: string | null;
  prices: ProductPriceRowDto[];
}
export interface ProductPricesResponse {
  productId: string;
  productName: string;
  variants: ProductVariantPricesDto[];
}

// ---------- Spanish presentation layer ----------

export const PRICING_MODE_LABELS: Record<string, string> = {
  FIXED: 'Fija',
  DERIVED: 'Derivada',
};

export const ADJUSTMENT_TYPE_LABELS: Record<string, string> = {
  PERCENTAGE_INCREASE: 'Aumento porcentual',
  PERCENTAGE_DECREASE: 'Descuento porcentual',
  FIXED_AMOUNT_INCREASE: 'Aumento fijo',
  FIXED_AMOUNT_DECREASE: 'Descuento fijo',
};

export const PRICE_CHANGE_TYPE_LABELS: Record<string, string> = {
  INITIAL: 'Carga inicial',
  MANUAL: 'Edición manual',
  BULK_ADJUSTMENT: 'Actualización masiva',
};

export function pricingModeLabel(value: string): string {
  return PRICING_MODE_LABELS[value] ?? value;
}
export function adjustmentTypeLabel(value: string): string {
  return ADJUSTMENT_TYPE_LABELS[value] ?? value;
}
export function priceChangeTypeLabel(value: string): string {
  return PRICE_CHANGE_TYPE_LABELS[value] ?? value;
}
