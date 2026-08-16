import { z } from 'zod';
import { ProductType, ProductStatus, ProductCodeType } from './enums';
import { optionalDecimalSchema } from './decimal';
import type { PaginationMeta } from './api';

/**
 * Product catalog — DTOs, validation, and the Spanish presentation layer
 * for Gestión's /productos. See docs/products.md. A Product describes WHAT
 * the company sells/buys/manages — never stock quantity or authoritative
 * price (see CLAUDE.md).
 */

const productTypeValues = Object.values(ProductType) as [ProductType, ...ProductType[]];
const productStatusValues = Object.values(ProductStatus) as [ProductStatus, ...ProductStatus[]];
const productCodeTypeValues = Object.values(ProductCodeType) as [ProductCodeType, ...ProductCodeType[]];

// ---------- Codes (barcodes / alternate codes) ----------

export const productCodeInputSchema = z.object({
  type: z.enum(productCodeTypeValues),
  code: z.string().trim().min(1, 'El código es obligatorio.').max(100),
  description: z.string().trim().max(200).optional(),
});
export type ProductCodeInput = z.infer<typeof productCodeInputSchema>;

export const updateProductCodeSchema = z.object({
  type: z.enum(productCodeTypeValues).optional(),
  code: z.string().trim().min(1, 'El código es obligatorio.').max(100).optional(),
  description: z.string().trim().max(200).nullable().optional(),
  active: z.boolean().optional(),
});
export type UpdateProductCodeInput = z.infer<typeof updateProductCodeSchema>;

// ---------- Variants ----------

/** Plain flat string->string map — deliberately not a formal attribute-definition engine yet (see docs/products.md). */
const productAttributesSchema = z
  .record(z.string().trim().min(1).max(60), z.string().trim().min(1).max(60))
  .refine((obj) => Object.keys(obj).length <= 20, { message: 'Demasiados atributos.' })
  .optional();

export const productVariantCreateInputSchema = z.object({
  name: z.string().trim().min(1, 'El nombre de la variante es obligatorio.').max(150),
  sku: z.string().trim().max(60).optional(),
  attributes: productAttributesSchema,
  codes: z.array(productCodeInputSchema).default([]),
});
export type ProductVariantCreateInput = z.infer<typeof productVariantCreateInputSchema>;

export const updateProductVariantSchema = z.object({
  name: z.string().trim().min(1, 'El nombre de la variante es obligatorio.').max(150).nullable().optional(),
  sku: z.string().trim().max(60).nullable().optional(),
  attributes: productAttributesSchema.nullable(),
});
export type UpdateProductVariantInput = z.infer<typeof updateProductVariantSchema>;

// ---------- Product create/update ----------

/**
 * Cross-field inventory-configuration rules shared by create (via
 * superRefine) — see docs/products.md:
 *   - SERVICE products may not explicitly request trackInventory.
 *   - trackLots/trackSerials both imply trackInventory (effective, not
 *     just the raw input — a SERVICE with no explicit trackInventory
 *     resolves to false, so trackLots would still be rejected).
 */
function inventoryConfigSuperRefine(
  data: {
    productType: ProductType;
    trackInventory?: boolean;
    trackLots: boolean;
    trackSerials: boolean;
  },
  ctx: z.RefinementCtx,
) {
  const effectiveTrackInventory = data.trackInventory ?? data.productType !== 'SERVICE';
  if (data.productType === 'SERVICE' && data.trackInventory === true) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Un servicio no puede controlar stock.',
      path: ['trackInventory'],
    });
  }
  if (data.trackLots && !effectiveTrackInventory) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'El control por lote requiere que el producto controle stock.',
      path: ['trackLots'],
    });
  }
  if (data.trackSerials && !effectiveTrackInventory) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'El control por número de serie requiere que el producto controle stock.',
      path: ['trackSerials'],
    });
  }
}

const baseProductFields = {
  code: z.string().trim().max(30).optional(), // manual override; omitted -> auto-generated (see docs/products.md)
  name: z.string().trim().min(1, 'El nombre es obligatorio.').max(200),
  description: z.string().trim().max(2000).optional(),
  productType: z.enum(productTypeValues).default('PRODUCT'),
  categoryId: z.string().uuid().optional(),
  brandId: z.string().uuid().optional(),
  baseUnitId: z.string().uuid('Elegí una unidad de medida.'),
  trackInventory: z.boolean().optional(),
  trackLots: z.boolean().default(false),
  trackSerials: z.boolean().default(false),
  allowNegativeStock: z.boolean().default(false),
  minimumStock: optionalDecimalSchema,
  maximumStock: optionalDecimalSchema,
  reorderPoint: optionalDecimalSchema,
  notes: z.string().trim().max(2000).optional(),
};

export const createProductSchema = z
  .object({
    ...baseProductFields,
    // Simple-product convenience fields — populate the auto-created
    // default variant (see docs/products.md). Mutually exclusive with
    // `variants`: a product either uses the simple path or the explicit
    // variants path, never both, to avoid ambiguous input.
    sku: z.string().trim().max(60).optional(),
    codes: z.array(productCodeInputSchema).default([]),
    variants: z.array(productVariantCreateInputSchema).default([]),
  })
  .superRefine((data, ctx) => {
    inventoryConfigSuperRefine(data, ctx);
    if (data.variants.length > 0 && (data.sku || data.codes.length > 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Si el producto tiene variantes, cargá el SKU y los códigos en cada variante.',
        path: ['sku'],
      });
    }
  })
  .transform((data) => ({
    ...data,
    trackInventory: data.trackInventory ?? data.productType !== 'SERVICE',
  }));
export type CreateProductInput = z.infer<typeof createProductSchema>;

/**
 * All fields optional/nullable-where-clearable, no cross-field defaulting
 * or SERVICE/lot/serial validation here — a PATCH payload only carries the
 * fields actually being changed, so that validation happens in
 * ProductsService against the merged (existing + patch) effective state,
 * not against this partial schema alone (see docs/products.md).
 */
export const updateProductSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio.').max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  productType: z.enum(productTypeValues).optional(),
  categoryId: z.string().uuid().nullable().optional(),
  brandId: z.string().uuid().nullable().optional(),
  baseUnitId: z.string().uuid().optional(),
  trackInventory: z.boolean().optional(),
  trackLots: z.boolean().optional(),
  trackSerials: z.boolean().optional(),
  allowNegativeStock: z.boolean().optional(),
  minimumStock: optionalDecimalSchema,
  maximumStock: optionalDecimalSchema,
  reorderPoint: optionalDecimalSchema,
  notes: z.string().trim().max(2000).nullable().optional(),
});
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

// ---------- Categories / Brands / Units ----------

export const createProductCategorySchema = z.object({
  parentId: z.string().uuid().optional(),
  code: z.string().trim().max(30).optional(),
  name: z.string().trim().min(1, 'El nombre es obligatorio.').max(150),
  description: z.string().trim().max(500).optional(),
});
export type CreateProductCategoryInput = z.infer<typeof createProductCategorySchema>;

export const updateProductCategorySchema = z.object({
  parentId: z.string().uuid().nullable().optional(),
  code: z.string().trim().max(30).nullable().optional(),
  name: z.string().trim().min(1, 'El nombre es obligatorio.').max(150).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  active: z.boolean().optional(),
});
export type UpdateProductCategoryInput = z.infer<typeof updateProductCategorySchema>;

export const createBrandSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio.').max(150),
  description: z.string().trim().max(500).optional(),
});
export type CreateBrandInput = z.infer<typeof createBrandSchema>;

export const updateBrandSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio.').max(150).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  active: z.boolean().optional(),
});
export type UpdateBrandInput = z.infer<typeof updateBrandSchema>;

export const createUnitOfMeasureSchema = z.object({
  code: z.string().trim().min(1, 'El código es obligatorio.').max(10),
  name: z.string().trim().min(1, 'El nombre es obligatorio.').max(100),
  symbol: z.string().trim().min(1, 'El símbolo es obligatorio.').max(10),
  decimalPlaces: z.coerce.number().int().min(0).max(6).default(0),
});
export type CreateUnitOfMeasureInput = z.infer<typeof createUnitOfMeasureSchema>;

export const updateUnitOfMeasureSchema = z.object({
  code: z.string().trim().min(1, 'El código es obligatorio.').max(10).optional(),
  name: z.string().trim().min(1, 'El nombre es obligatorio.').max(100).optional(),
  symbol: z.string().trim().min(1, 'El símbolo es obligatorio.').max(10).optional(),
  decimalPlaces: z.coerce.number().int().min(0).max(6).optional(),
  active: z.boolean().optional(),
});
export type UpdateUnitOfMeasureInput = z.infer<typeof updateUnitOfMeasureSchema>;

// ---------- List / lookup queries ----------

export const productListQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  status: z.enum(productStatusValues).optional(),
  productType: z.enum(productTypeValues).optional(),
  categoryId: z.string().uuid().optional(),
  brandId: z.string().uuid().optional(),
  trackInventory: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  sortBy: z.enum(['code', 'name', 'createdAt', 'updatedAt']).default('name'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ProductListQuery = z.infer<typeof productListQuerySchema>;

/**
 * `barcode` takes an exact-match fast path (no fuzzy search — see
 * docs/products.md); `search` falls back to the general ranked search.
 */
export const productLookupQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  barcode: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type ProductLookupQuery = z.infer<typeof productLookupQuerySchema>;

export const productHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ProductHistoryQuery = z.infer<typeof productHistoryQuerySchema>;

// ---------- Response DTOs ----------

export interface ProductCodeDto {
  id: string;
  type: ProductCodeType;
  code: string;
  description: string | null;
  active: boolean;
}

export interface ProductVariantDto {
  id: string;
  name: string | null;
  sku: string | null;
  attributes: Record<string, string> | null;
  active: boolean;
  codes: ProductCodeDto[];
}

export interface ProductCategoryDto {
  id: string;
  parentId: string | null;
  code: string | null;
  name: string;
  description: string | null;
  active: boolean;
}

export interface BrandDto {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
}

export interface UnitOfMeasureDto {
  id: string;
  code: string;
  name: string;
  symbol: string;
  decimalPlaces: number;
  active: boolean;
}

export interface ProductSummary {
  id: string;
  code: string;
  name: string;
  productType: ProductType;
  status: ProductStatus;
  trackInventory: boolean;
  categoryId: string | null;
  categoryName: string | null;
  brandId: string | null;
  brandName: string | null;
  /** The sole variant's SKU/barcode for a simple product; null for a multi-variant product with no single obvious value (see docs/products.md). */
  primarySku: string | null;
  primaryBarcode: string | null;
  /** true when at least one variant has a non-null `name` — see docs/products.md's "default variant" rule. */
  hasVariants: boolean;
  variantCount: number;
}

export interface ProductDetail extends ProductSummary {
  description: string | null;
  baseUnit: UnitOfMeasureDto;
  trackLots: boolean;
  trackSerials: boolean;
  allowNegativeStock: boolean;
  minimumStock: string | null;
  maximumStock: string | null;
  reorderPoint: string | null;
  notes: string | null;
  variants: ProductVariantDto[];
  createdAt: string;
  updatedAt: string;
}

export interface ProductListResponse {
  items: ProductSummary[];
  pagination: PaginationMeta;
}

export interface ProductDetailResponse {
  product: ProductDetail;
}

export interface ProductVariantResponse {
  variant: ProductVariantDto;
}

export interface ProductCodeResponse {
  code: ProductCodeDto;
}

/** Sellable/manageable-variant granularity — see docs/products.md. Never a full Product object (deliberately lean for POS/Facturación). */
export interface ProductLookupItem {
  productId: string;
  variantId: string;
  productCode: string;
  sku: string | null;
  name: string;
  variantName: string | null;
  barcode: string | null;
  productType: ProductType;
  active: boolean;
}

export interface ProductLookupResponse {
  items: ProductLookupItem[];
}

export interface ProductCategoriesResponse {
  categories: ProductCategoryDto[];
}
export interface ProductCategoryDetailResponse {
  category: ProductCategoryDto;
}
export interface BrandsResponse {
  brands: BrandDto[];
}
export interface BrandDetailResponse {
  brand: BrandDto;
}
export interface UnitsOfMeasureResponse {
  units: UnitOfMeasureDto[];
}
export interface UnitOfMeasureDetailResponse {
  unit: UnitOfMeasureDto;
}

// ---------- Spanish presentation layer ----------

export const PRODUCT_TYPE_LABELS: Record<string, string> = {
  PRODUCT: 'Producto',
  SERVICE: 'Servicio',
  KIT: 'Kit',
  MANUFACTURED: 'Producto elaborado',
};

export const PRODUCT_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Activo',
  INACTIVE: 'Inactivo',
};

export const PRODUCT_CODE_TYPE_LABELS: Record<string, string> = {
  BARCODE: 'Código de barras',
  SUPPLIER: 'Proveedor',
  INTERNAL: 'Interno',
  MARKETPLACE: 'Marketplace',
  OTHER: 'Otro',
};

export function productTypeLabel(value: string): string {
  return PRODUCT_TYPE_LABELS[value] ?? value;
}
export function productStatusLabel(value: string): string {
  return PRODUCT_STATUS_LABELS[value] ?? value;
}
export function productCodeTypeLabel(value: string): string {
  return PRODUCT_CODE_TYPE_LABELS[value] ?? value;
}
