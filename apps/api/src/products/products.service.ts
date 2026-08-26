import { Injectable } from '@nestjs/common';
import type {
  CreateProductInput,
  UpdateProductInput,
  ProductVariantCreateInput,
  UpdateProductVariantInput,
  ProductCodeInput,
  UpdateProductCodeInput,
  ProductListQuery,
  ProductListResponse,
  ProductLookupQuery,
  ProductLookupResponse,
  ProductLookupItem,
  ProductSummary,
  ProductDetail,
  ProductVariantDto,
  ProductCodeDto,
  UnitOfMeasureDto,
  ProductType,
  AuditEntityHistoryResponse,
} from '@erp/shared';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import type { RequestContext } from '../company-context/types';
import {
  ProductNotFoundException,
  ProductCodeAlreadyExistsException,
  ProductSkuAlreadyExistsException,
  ProductBarcodeAlreadyExistsException,
  ProductCategoryNotFoundException,
  BrandNotFoundException,
  UnitNotFoundException,
  ProductVariantNotFoundException,
  ProductCodeNotFoundException,
  ProductInvalidInventoryConfigException,
} from './products.exceptions';
import { Prisma } from '../generated/prisma/client';
import type {
  Product,
  ProductVariant,
  ProductCode,
  ProductCategory,
  Brand,
  UnitOfMeasure,
} from '../generated/prisma/client';

type VariantWithCodes = ProductVariant & { codes: ProductCode[] };
type ProductWithSummaryRelations = Product & {
  variants: VariantWithCodes[];
  category: ProductCategory | null;
  brand: Brand | null;
};
type ProductWithDetailRelations = ProductWithSummaryRelations & {
  baseUnit: UnitOfMeasure;
};

type AuditableProductFields = Record<
  | 'name'
  | 'description'
  | 'productType'
  | 'trackInventory'
  | 'trackLots'
  | 'trackSerials'
  | 'allowNegativeStock'
  | 'minimumStock'
  | 'maximumStock'
  | 'reorderPoint'
  | 'status',
  unknown
>;

function toCodeDto(c: ProductCode): ProductCodeDto {
  return {
    id: c.id,
    type: c.type,
    code: c.code,
    description: c.description,
    active: c.active,
  };
}

function toVariantDto(v: VariantWithCodes): ProductVariantDto {
  return {
    id: v.id,
    name: v.name,
    sku: v.sku,
    attributes: (v.attributes as Record<string, string> | null) ?? null,
    active: v.active,
    codes: v.codes.map(toCodeDto),
  };
}

function toUnitDto(u: UnitOfMeasure): UnitOfMeasureDto {
  return {
    id: u.id,
    code: u.code,
    name: u.name,
    symbol: u.symbol,
    decimalPlaces: u.decimalPlaces,
    active: u.active,
  };
}

/** true when at least one variant is explicitly named — see docs/products.md's "default variant" rule. */
function computeVariantAggregate(variants: VariantWithCodes[]): {
  primarySku: string | null;
  primaryBarcode: string | null;
  hasVariants: boolean;
  variantCount: number;
} {
  const hasVariants = variants.some((v) => v.name !== null);
  const variantCount = variants.length;
  if (variantCount !== 1) {
    return {
      primarySku: null,
      primaryBarcode: null,
      hasVariants,
      variantCount,
    };
  }
  const only = variants[0];
  const barcode =
    only.codes.find((c) => c.type === 'BARCODE' && c.active)?.code ?? null;
  return {
    primarySku: only.sku,
    primaryBarcode: barcode,
    hasVariants,
    variantCount,
  };
}

function toSummary(p: ProductWithSummaryRelations): ProductSummary {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    productType: p.productType,
    status: p.status,
    trackInventory: p.trackInventory,
    categoryId: p.categoryId,
    categoryName: p.category?.name ?? null,
    brandId: p.brandId,
    brandName: p.brand?.name ?? null,
    ...computeVariantAggregate(p.variants),
  };
}

function toDetail(p: ProductWithDetailRelations): ProductDetail {
  return {
    ...toSummary(p),
    description: p.description,
    baseUnit: toUnitDto(p.baseUnit),
    trackLots: p.trackLots,
    trackSerials: p.trackSerials,
    allowNegativeStock: p.allowNegativeStock,
    minimumStock: p.minimumStock?.toString() ?? null,
    maximumStock: p.maximumStock?.toString() ?? null,
    reorderPoint: p.reorderPoint?.toString() ?? null,
    notes: p.notes,
    variants: p.variants.map(toVariantDto),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function firstActiveBarcode(v: VariantWithCodes): string | null {
  return v.codes.find((c) => c.type === 'BARCODE' && c.active)?.code ?? null;
}

function toLookupItem(
  p: Product,
  v: ProductVariant,
  barcode: string | null,
): ProductLookupItem {
  return {
    productId: p.id,
    variantId: v.id,
    productCode: p.code,
    sku: v.sku,
    name: p.name,
    variantName: v.name,
    barcode,
    productType: p.productType,
    active: v.active && p.status === 'ACTIVE',
  };
}

/** Only the fields worth diffing in a plain UPDATE audit record — category/brand changes get their own dedicated metadata events instead (see docs/products.md, "especially important fields" mirrors docs/customers.md). */
function pickAuditFields(p: Product): AuditableProductFields {
  return {
    name: p.name,
    description: p.description,
    productType: p.productType,
    trackInventory: p.trackInventory,
    trackLots: p.trackLots,
    trackSerials: p.trackSerials,
    allowNegativeStock: p.allowNegativeStock,
    minimumStock: p.minimumStock?.toString() ?? null,
    maximumStock: p.maximumStock?.toString() ?? null,
    reorderPoint: p.reorderPoint?.toString() ?? null,
    status: p.status,
  };
}

function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: T,
): { before: Partial<T>; after: Partial<T> } {
  const changedBefore: Partial<T> = {};
  const changedAfter: Partial<T> = {};
  for (const key of Object.keys(before) as (keyof T)[]) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changedBefore[key] = before[key];
      changedAfter[key] = after[key];
    }
  }
  return { before: changedBefore, after: changedAfter };
}

const PRODUCT_SUMMARY_INCLUDE = {
  category: true,
  brand: true,
  variants: { include: { codes: true } },
} satisfies Prisma.ProductInclude;

const PRODUCT_DETAIL_INCLUDE = {
  ...PRODUCT_SUMMARY_INCLUDE,
  baseUnit: true,
} satisfies Prisma.ProductInclude;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly realtimePublisher: RealtimePublisher,
  ) {}

  async list(
    companyId: string,
    query: ProductListQuery,
  ): Promise<ProductListResponse> {
    const where: Prisma.ProductWhereInput = { companyId };
    if (query.status) where.status = query.status;
    if (query.productType) where.productType = query.productType;
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.brandId) where.brandId = query.brandId;
    if (query.trackInventory !== undefined)
      where.trackInventory = query.trackInventory;
    if (query.search) {
      const term = query.search.trim();
      where.OR = [
        { code: { contains: term, mode: 'insensitive' } },
        { name: { contains: term, mode: 'insensitive' } },
        { description: { contains: term, mode: 'insensitive' } },
        { brand: { name: { contains: term, mode: 'insensitive' } } },
        {
          variants: { some: { sku: { contains: term, mode: 'insensitive' } } },
        },
        {
          variants: {
            some: {
              codes: {
                some: { code: { contains: term, mode: 'insensitive' } },
              },
            },
          },
        },
      ];
    }

    const skip = (query.page - 1) * query.pageSize;
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        include: PRODUCT_SUMMARY_INCLUDE,
        orderBy: { [query.sortBy]: query.sortDir },
        skip,
        take: query.pageSize,
      }),
    ]);

    return {
      items: rows.map(toSummary),
      pagination: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  /**
   * Sellable-variant-granularity search for future Facturación/POS (see
   * docs/products.md). `barcode` takes an exact-match-only fast path — no
   * fuzzy fallback, since an exact scanner read should never be
   * second-guessed by a text search. `search` does an exact pass first
   * (code/SKU/barcode), then fills remaining slots with a fuzzy pass —
   * simple two-query ranking, not a scoring engine.
   */
  async lookup(
    companyId: string,
    query: ProductLookupQuery,
  ): Promise<ProductLookupResponse> {
    if (query.barcode) {
      const normalized = query.barcode.trim();
      const codeRow = await this.prisma.productCode.findFirst({
        where: {
          companyId,
          type: 'BARCODE',
          code: normalized,
          active: true,
          variant: { active: true, product: { companyId, status: 'ACTIVE' } },
        },
        include: { variant: { include: { product: true } } },
      });
      if (!codeRow) return { items: [] };
      return {
        items: [
          toLookupItem(codeRow.variant.product, codeRow.variant, normalized),
        ],
      };
    }

    const term = query.search?.trim();
    if (!term) {
      const rows = await this.prisma.productVariant.findMany({
        where: { active: true, product: { companyId, status: 'ACTIVE' } },
        include: { product: true, codes: true },
        orderBy: { product: { name: 'asc' } },
        take: query.limit,
      });
      return {
        items: rows.map((v) =>
          toLookupItem(v.product, v, firstActiveBarcode(v)),
        ),
      };
    }

    const exactRows = await this.prisma.productVariant.findMany({
      where: {
        active: true,
        product: { companyId, status: 'ACTIVE' },
        OR: [
          { sku: { equals: term, mode: 'insensitive' } },
          { product: { code: { equals: term, mode: 'insensitive' } } },
          { codes: { some: { type: 'BARCODE', active: true, code: term } } },
        ],
      },
      include: { product: true, codes: true },
      take: query.limit,
    });
    const exactIds = new Set(exactRows.map((v) => v.id));

    const remaining = query.limit - exactRows.length;
    const fuzzyRows =
      remaining > 0
        ? await this.prisma.productVariant.findMany({
            where: {
              active: true,
              product: { companyId, status: 'ACTIVE' },
              id: { notIn: [...exactIds] },
              OR: [
                { name: { contains: term, mode: 'insensitive' } },
                { sku: { contains: term, mode: 'insensitive' } },
                { product: { name: { contains: term, mode: 'insensitive' } } },
                { product: { code: { contains: term, mode: 'insensitive' } } },
                {
                  codes: {
                    some: { code: { contains: term, mode: 'insensitive' } },
                  },
                },
              ],
            },
            include: { product: true, codes: true },
            take: remaining,
          })
        : [];

    const all = [...exactRows, ...fuzzyRows];
    return {
      items: all.map((v) => toLookupItem(v.product, v, firstActiveBarcode(v))),
    };
  }

  async getById(companyId: string, id: string): Promise<ProductDetail> {
    const product = await this.prisma.product.findFirst({
      where: { id, companyId },
      include: PRODUCT_DETAIL_INCLUDE,
    });
    if (!product) throw new ProductNotFoundException();
    return toDetail(product);
  }

  async getHistory(
    ctx: RequestContext,
    productId: string,
    pagination: { page: number; pageSize: number },
  ): Promise<AuditEntityHistoryResponse> {
    await this.findScopedOrThrow(ctx.companyId, productId);
    return this.auditService.getEntityHistory(
      ctx.companyId,
      'Product',
      productId,
      pagination,
    );
  }

  async create(
    ctx: RequestContext,
    input: CreateProductInput,
  ): Promise<ProductDetail> {
    if (input.categoryId)
      await this.assertCategoryBelongsToCompany(
        ctx.companyId,
        input.categoryId,
      );
    if (input.brandId)
      await this.assertBrandBelongsToCompany(ctx.companyId, input.brandId);
    await this.assertUnitBelongsToCompany(ctx.companyId, input.baseUnitId);

    const manualCode = input.code?.trim();
    if (manualCode)
      await this.assertCodeAvailable(this.prisma, ctx.companyId, manualCode);

    const { skus, barcodes } = this.collectSkusAndBarcodes(input);
    if (new Set(skus).size !== skus.length)
      throw new ProductSkuAlreadyExistsException();
    if (new Set(barcodes).size !== barcodes.length)
      throw new ProductBarcodeAlreadyExistsException();
    for (const sku of skus)
      await this.assertSkuAvailable(this.prisma, ctx.companyId, sku);
    for (const barcode of barcodes)
      await this.assertBarcodeAvailable(this.prisma, ctx.companyId, barcode);

    const created = await this.prisma.$transaction(async (tx) => {
      const code = manualCode || (await this.nextCode(tx, ctx.companyId));

      const product = await tx.product.create({
        data: {
          tenantId: ctx.tenantId,
          companyId: ctx.companyId,
          code,
          name: input.name,
          description: input.description || null,
          productType: input.productType,
          categoryId: input.categoryId ?? null,
          brandId: input.brandId ?? null,
          baseUnitId: input.baseUnitId,
          trackInventory: input.trackInventory,
          trackLots: input.trackLots,
          trackSerials: input.trackSerials,
          allowNegativeStock: input.allowNegativeStock,
          minimumStock: input.minimumStock,
          maximumStock: input.maximumStock,
          reorderPoint: input.reorderPoint,
          notes: input.notes || null,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        },
      });

      if (input.variants.length > 0) {
        for (const v of input.variants) {
          const variant = await tx.productVariant.create({
            data: {
              productId: product.id,
              name: v.name,
              sku: v.sku || null,
              attributes: v.attributes,
            },
          });
          if (v.codes.length > 0) {
            await tx.productCode.createMany({
              data: v.codes.map((c) => ({
                companyId: ctx.companyId,
                productVariantId: variant.id,
                type: c.type,
                code: c.code,
                description: c.description || null,
              })),
            });
          }
        }
      } else {
        const variant = await tx.productVariant.create({
          data: { productId: product.id, name: null, sku: input.sku || null },
        });
        if (input.codes.length > 0) {
          await tx.productCode.createMany({
            data: input.codes.map((c) => ({
              companyId: ctx.companyId,
              productVariantId: variant.id,
              type: c.type,
              code: c.code,
              description: c.description || null,
            })),
          });
        }
      }

      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'CREATE',
          entityType: 'Product',
          entityId: product.id,
          after: {
            code: product.code,
            name: product.name,
            productType: product.productType,
            trackInventory: product.trackInventory,
            status: product.status,
          },
        },
        tx,
      );

      return product;
    });

    this.realtimePublisher.productUpdated(ctx.companyId, created.id);
    return this.getById(ctx.companyId, created.id);
  }

  async update(
    ctx: RequestContext,
    id: string,
    input: UpdateProductInput,
  ): Promise<ProductDetail> {
    const existing = await this.findScopedOrThrow(ctx.companyId, id);

    if (input.categoryId)
      await this.assertCategoryBelongsToCompany(
        ctx.companyId,
        input.categoryId,
      );
    if (input.brandId)
      await this.assertBrandBelongsToCompany(ctx.companyId, input.brandId);
    if (input.baseUnitId !== undefined)
      await this.assertUnitBelongsToCompany(ctx.companyId, input.baseUnitId);

    this.assertValidInventoryConfig({
      productType: input.productType ?? existing.productType,
      trackInventory: input.trackInventory ?? existing.trackInventory,
      trackLots: input.trackLots ?? existing.trackLots,
      trackSerials: input.trackSerials ?? existing.trackSerials,
    });

    const beforeSnapshot = pickAuditFields(existing);

    const data: Prisma.ProductUncheckedUpdateInput = { updatedBy: ctx.userId };
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined)
      data.description = input.description || null;
    if (input.productType !== undefined) data.productType = input.productType;
    if (input.categoryId !== undefined) data.categoryId = input.categoryId;
    if (input.brandId !== undefined) data.brandId = input.brandId;
    if (input.baseUnitId !== undefined) data.baseUnitId = input.baseUnitId;
    if (input.trackInventory !== undefined)
      data.trackInventory = input.trackInventory;
    if (input.trackLots !== undefined) data.trackLots = input.trackLots;
    if (input.trackSerials !== undefined)
      data.trackSerials = input.trackSerials;
    if (input.allowNegativeStock !== undefined)
      data.allowNegativeStock = input.allowNegativeStock;
    if (input.minimumStock !== undefined)
      data.minimumStock = input.minimumStock;
    if (input.maximumStock !== undefined)
      data.maximumStock = input.maximumStock;
    if (input.reorderPoint !== undefined)
      data.reorderPoint = input.reorderPoint;
    if (input.notes !== undefined) data.notes = input.notes || null;

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({
        where: { id: existing.id },
        data,
      });

      const afterSnapshot = pickAuditFields(updated);
      const diff = diffFields(beforeSnapshot, afterSnapshot);
      if (Object.keys(diff.before).length > 0) {
        await this.auditService.recordFromContext(
          ctx,
          {
            action: 'UPDATE',
            entityType: 'Product',
            entityId: id,
            before: diff.before,
            after: diff.after,
          },
          tx,
        );
      }

      if (
        input.categoryId !== undefined &&
        input.categoryId !== existing.categoryId
      ) {
        const [prevCategory, nextCategory] = await Promise.all([
          existing.categoryId
            ? tx.productCategory.findUnique({
                where: { id: existing.categoryId },
              })
            : null,
          input.categoryId
            ? tx.productCategory.findUnique({ where: { id: input.categoryId } })
            : null,
        ]);
        await this.auditService.recordFromContext(
          ctx,
          {
            action: 'UPDATE',
            entityType: 'Product',
            entityId: id,
            metadata: {
              change: 'category_changed',
              previousCategoryName: prevCategory?.name ?? null,
              newCategoryName: nextCategory?.name ?? null,
            },
          },
          tx,
        );
      }

      if (input.brandId !== undefined && input.brandId !== existing.brandId) {
        const [prevBrand, nextBrand] = await Promise.all([
          existing.brandId
            ? tx.brand.findUnique({ where: { id: existing.brandId } })
            : null,
          input.brandId
            ? tx.brand.findUnique({ where: { id: input.brandId } })
            : null,
        ]);
        await this.auditService.recordFromContext(
          ctx,
          {
            action: 'UPDATE',
            entityType: 'Product',
            entityId: id,
            metadata: {
              change: 'brand_changed',
              previousBrandName: prevBrand?.name ?? null,
              newBrandName: nextBrand?.name ?? null,
            },
          },
          tx,
        );
      }
    });

    this.realtimePublisher.productUpdated(ctx.companyId, id);
    return this.getById(ctx.companyId, id);
  }

  async deactivate(ctx: RequestContext, id: string): Promise<ProductDetail> {
    const existing = await this.findScopedOrThrow(ctx.companyId, id);
    if (existing.status === 'INACTIVE') return this.getById(ctx.companyId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: { status: 'INACTIVE', updatedBy: ctx.userId },
      });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'DEACTIVATE',
          entityType: 'Product',
          entityId: id,
          before: { status: 'ACTIVE' },
          after: { status: 'INACTIVE' },
        },
        tx,
      );
    });
    this.realtimePublisher.productUpdated(ctx.companyId, id);
    return this.getById(ctx.companyId, id);
  }

  async reactivate(ctx: RequestContext, id: string): Promise<ProductDetail> {
    const existing = await this.findScopedOrThrow(ctx.companyId, id);
    if (existing.status === 'ACTIVE') return this.getById(ctx.companyId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: { status: 'ACTIVE', updatedBy: ctx.userId },
      });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'ACTIVATE',
          entityType: 'Product',
          entityId: id,
          before: { status: 'INACTIVE' },
          after: { status: 'ACTIVE' },
        },
        tx,
      );
    });
    this.realtimePublisher.productUpdated(ctx.companyId, id);
    return this.getById(ctx.companyId, id);
  }

  // ---------- Variants ----------

  async addVariant(
    ctx: RequestContext,
    productId: string,
    input: ProductVariantCreateInput,
  ): Promise<ProductVariantDto> {
    await this.findScopedOrThrow(ctx.companyId, productId);
    if (input.sku)
      await this.assertSkuAvailable(this.prisma, ctx.companyId, input.sku);
    for (const c of input.codes.filter((c) => c.type === 'BARCODE')) {
      await this.assertBarcodeAvailable(this.prisma, ctx.companyId, c.code);
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const variant = await tx.productVariant.create({
        data: {
          productId,
          name: input.name,
          sku: input.sku || null,
          attributes: input.attributes,
        },
      });
      if (input.codes.length > 0) {
        await tx.productCode.createMany({
          data: input.codes.map((c) => ({
            companyId: ctx.companyId,
            productVariantId: variant.id,
            type: c.type,
            code: c.code,
            description: c.description || null,
          })),
        });
      }
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'UPDATE',
          entityType: 'Product',
          entityId: productId,
          metadata: {
            change: 'variant_added',
            variantId: variant.id,
            name: variant.name,
            sku: variant.sku,
          },
        },
        tx,
      );
      return variant;
    });
    this.realtimePublisher.productUpdated(ctx.companyId, productId);
    return this.getVariantDto(created.id);
  }

  async updateVariant(
    ctx: RequestContext,
    productId: string,
    variantId: string,
    input: UpdateProductVariantInput,
  ): Promise<ProductVariantDto> {
    await this.findScopedOrThrow(ctx.companyId, productId);
    const existing = await this.findVariantScopedOrThrow(productId, variantId);
    if (input.sku)
      await this.assertSkuAvailable(
        this.prisma,
        ctx.companyId,
        input.sku,
        variantId,
      );

    const data: Prisma.ProductVariantUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.sku !== undefined) data.sku = input.sku || null;
    if (input.attributes !== undefined)
      data.attributes = input.attributes ?? Prisma.JsonNull;

    const updated = await this.prisma.$transaction(async (tx) => {
      const variant = await tx.productVariant.update({
        where: { id: variantId },
        data,
      });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'UPDATE',
          entityType: 'Product',
          entityId: productId,
          metadata: {
            change: 'variant_updated',
            variantId,
            name: variant.name,
            previousName: existing.name,
          },
        },
        tx,
      );
      return variant;
    });
    this.realtimePublisher.productUpdated(ctx.companyId, productId);
    return this.getVariantDto(updated.id);
  }

  async deactivateVariant(
    ctx: RequestContext,
    productId: string,
    variantId: string,
  ): Promise<ProductVariantDto> {
    await this.findScopedOrThrow(ctx.companyId, productId);
    const existing = await this.findVariantScopedOrThrow(productId, variantId);
    if (!existing.active) return this.getVariantDto(variantId);
    await this.prisma.$transaction(async (tx) => {
      await tx.productVariant.update({
        where: { id: variantId },
        data: { active: false },
      });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'DEACTIVATE',
          entityType: 'Product',
          entityId: productId,
          metadata: {
            change: 'variant_deactivated',
            variantId,
            name: existing.name,
          },
        },
        tx,
      );
    });
    return this.getVariantDto(variantId);
  }

  async reactivateVariant(
    ctx: RequestContext,
    productId: string,
    variantId: string,
  ): Promise<ProductVariantDto> {
    await this.findScopedOrThrow(ctx.companyId, productId);
    const existing = await this.findVariantScopedOrThrow(productId, variantId);
    if (existing.active) return this.getVariantDto(variantId);
    if (existing.sku)
      await this.assertSkuAvailable(
        this.prisma,
        ctx.companyId,
        existing.sku,
        variantId,
      );
    await this.prisma.$transaction(async (tx) => {
      await tx.productVariant.update({
        where: { id: variantId },
        data: { active: true },
      });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'ACTIVATE',
          entityType: 'Product',
          entityId: productId,
          metadata: {
            change: 'variant_reactivated',
            variantId,
            name: existing.name,
          },
        },
        tx,
      );
    });
    return this.getVariantDto(variantId);
  }

  // ---------- Codes ----------

  async addCode(
    ctx: RequestContext,
    productId: string,
    variantId: string,
    input: ProductCodeInput,
  ): Promise<ProductCodeDto> {
    await this.findScopedOrThrow(ctx.companyId, productId);
    await this.findVariantScopedOrThrow(productId, variantId);
    if (input.type === 'BARCODE')
      await this.assertBarcodeAvailable(this.prisma, ctx.companyId, input.code);

    const created = await this.prisma.$transaction(async (tx) => {
      const code = await tx.productCode.create({
        data: {
          companyId: ctx.companyId,
          productVariantId: variantId,
          type: input.type,
          code: input.code,
          description: input.description || null,
        },
      });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'UPDATE',
          entityType: 'Product',
          entityId: productId,
          metadata: {
            change: 'code_added',
            variantId,
            codeId: code.id,
            type: code.type,
            code: code.code,
          },
        },
        tx,
      );
      return code;
    });
    return toCodeDto(created);
  }

  async updateCode(
    ctx: RequestContext,
    productId: string,
    variantId: string,
    codeId: string,
    input: UpdateProductCodeInput,
  ): Promise<ProductCodeDto> {
    await this.findScopedOrThrow(ctx.companyId, productId);
    await this.findVariantScopedOrThrow(productId, variantId);
    const existing = await this.prisma.productCode.findFirst({
      where: { id: codeId, productVariantId: variantId },
    });
    if (!existing) throw new ProductCodeNotFoundException();

    const mergedType = input.type ?? existing.type;
    const mergedCode = input.code ?? existing.code;
    const mergedActive = input.active ?? existing.active;
    if (mergedType === 'BARCODE' && mergedActive) {
      await this.assertBarcodeAvailable(
        this.prisma,
        ctx.companyId,
        mergedCode,
        codeId,
      );
    }

    const data: Prisma.ProductCodeUpdateInput = {};
    if (input.type !== undefined) data.type = input.type;
    if (input.code !== undefined) data.code = input.code;
    if (input.description !== undefined)
      data.description = input.description || null;
    if (input.active !== undefined) data.active = input.active;

    const updated = await this.prisma.$transaction(async (tx) => {
      const code = await tx.productCode.update({ where: { id: codeId }, data });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'UPDATE',
          entityType: 'Product',
          entityId: productId,
          metadata: {
            change: 'code_updated',
            variantId,
            codeId,
            type: code.type,
            code: code.code,
            previousCode: existing.code,
          },
        },
        tx,
      );
      return code;
    });
    return toCodeDto(updated);
  }

  async removeCode(
    ctx: RequestContext,
    productId: string,
    variantId: string,
    codeId: string,
  ): Promise<void> {
    await this.findScopedOrThrow(ctx.companyId, productId);
    await this.findVariantScopedOrThrow(productId, variantId);
    const existing = await this.prisma.productCode.findFirst({
      where: { id: codeId, productVariantId: variantId },
    });
    if (!existing) throw new ProductCodeNotFoundException();

    await this.prisma.$transaction(async (tx) => {
      await tx.productCode.delete({ where: { id: codeId } });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'UPDATE',
          entityType: 'Product',
          entityId: productId,
          metadata: {
            change: 'code_removed',
            variantId,
            codeId,
            type: existing.type,
            code: existing.code,
          },
        },
        tx,
      );
    });
  }

  // ---------- Internal helpers ----------

  private async findScopedOrThrow(
    companyId: string,
    id: string,
  ): Promise<Product> {
    const product = await this.prisma.product.findFirst({
      where: { id, companyId },
    });
    if (!product) throw new ProductNotFoundException();
    return product;
  }

  private async findVariantScopedOrThrow(
    productId: string,
    variantId: string,
  ): Promise<ProductVariant> {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, productId },
    });
    if (!variant) throw new ProductVariantNotFoundException();
    return variant;
  }

  private async getVariantDto(variantId: string): Promise<ProductVariantDto> {
    const variant = await this.prisma.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      include: { codes: true },
    });
    return toVariantDto(variant);
  }

  private collectSkusAndBarcodes(input: CreateProductInput): {
    skus: string[];
    barcodes: string[];
  } {
    const skus: string[] = [];
    const barcodes: string[] = [];
    if (input.variants.length > 0) {
      for (const v of input.variants) {
        if (v.sku) skus.push(v.sku);
        for (const c of v.codes)
          if (c.type === 'BARCODE') barcodes.push(c.code);
      }
    } else {
      if (input.sku) skus.push(input.sku);
      for (const c of input.codes)
        if (c.type === 'BARCODE') barcodes.push(c.code);
    }
    return { skus, barcodes };
  }

  /** Only ACTIVE variants count as a conflict — see docs/products.md. */
  private async assertSkuAvailable(
    client: PrismaService | Prisma.TransactionClient,
    companyId: string,
    sku: string,
    excludeVariantId?: string,
  ): Promise<void> {
    const conflict = await client.productVariant.findFirst({
      where: {
        sku,
        active: true,
        product: { companyId },
        ...(excludeVariantId ? { id: { not: excludeVariantId } } : {}),
      },
    });
    if (conflict) throw new ProductSkuAlreadyExistsException();
  }

  /** Only ACTIVE barcodes count as a conflict — see docs/products.md. */
  private async assertBarcodeAvailable(
    client: PrismaService | Prisma.TransactionClient,
    companyId: string,
    code: string,
    excludeCodeId?: string,
  ): Promise<void> {
    const conflict = await client.productCode.findFirst({
      where: {
        companyId,
        type: 'BARCODE',
        code,
        active: true,
        ...(excludeCodeId ? { id: { not: excludeCodeId } } : {}),
      },
    });
    if (conflict) throw new ProductBarcodeAlreadyExistsException();
  }

  private async assertCodeAvailable(
    client: PrismaService | Prisma.TransactionClient,
    companyId: string,
    code: string,
  ): Promise<void> {
    const conflict = await client.product.findFirst({
      where: { companyId, code },
    });
    if (conflict) throw new ProductCodeAlreadyExistsException();
  }

  private async assertCategoryBelongsToCompany(
    companyId: string,
    categoryId: string,
  ): Promise<void> {
    const found = await this.prisma.productCategory.findFirst({
      where: { id: categoryId, companyId },
    });
    if (!found) throw new ProductCategoryNotFoundException();
  }

  private async assertBrandBelongsToCompany(
    companyId: string,
    brandId: string,
  ): Promise<void> {
    const found = await this.prisma.brand.findFirst({
      where: { id: brandId, companyId },
    });
    if (!found) throw new BrandNotFoundException();
  }

  private async assertUnitBelongsToCompany(
    companyId: string,
    unitId: string,
  ): Promise<void> {
    const found = await this.prisma.unitOfMeasure.findFirst({
      where: { id: unitId, companyId },
    });
    if (!found) throw new UnitNotFoundException();
  }

  /**
   * Re-validates the SERVICE / trackLots / trackSerials rules against the
   * MERGED (existing + patch) state — a partial PATCH can't be validated
   * by the static Zod schema alone, since it might only touch one of the
   * interacting fields (see docs/products.md).
   */
  private assertValidInventoryConfig(effective: {
    productType: ProductType;
    trackInventory: boolean;
    trackLots: boolean;
    trackSerials: boolean;
  }): void {
    if (effective.productType === 'SERVICE' && effective.trackInventory) {
      throw new ProductInvalidInventoryConfigException(
        'Un servicio no puede controlar stock.',
      );
    }
    if (effective.trackLots && !effective.trackInventory) {
      throw new ProductInvalidInventoryConfigException(
        'El control por lote requiere que el producto controle stock.',
      );
    }
    if (effective.trackSerials && !effective.trackInventory) {
      throw new ProductInvalidInventoryConfigException(
        'El control por número de serie requiere que el producto controle stock.',
      );
    }
  }

  /** Atomic per-company counter — see ProductCodeSequence in schema.prisma. */
  private async nextCode(
    tx: Prisma.TransactionClient,
    companyId: string,
  ): Promise<string> {
    const seq = await tx.productCodeSequence.upsert({
      where: { companyId },
      create: { companyId, lastValue: 1 },
      update: { lastValue: { increment: 1 } },
    });
    return String(seq.lastValue).padStart(6, '0');
  }
}
