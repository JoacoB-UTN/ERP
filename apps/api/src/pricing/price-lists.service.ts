import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import type {
  PriceList,
  Currency,
  Product,
  ProductVariant,
} from '../generated/prisma/client';
import type {
  CreatePriceListInput,
  UpdatePriceListInput,
  PriceListDto,
  PriceListItemsQuery,
  PriceListItemsResponse,
  PriceListItemRowDto,
  ProductPricesResponse,
  ProductVariantPricesDto,
  CurrencyDto,
  PriceListHistoryQuery,
  AuditEntityHistoryResponse,
} from '@erp/shared';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../company-context/types';
import { PricingService } from './pricing.service';
import { ProductNotFoundException } from '../products/products.exceptions';
import {
  PriceListNotFoundException,
  PriceListCodeAlreadyExistsException,
  PriceListNameAlreadyExistsException,
  PriceListCycleException,
  PriceListCurrencyMismatchException,
  PriceListNotDerivedException,
  CurrencyNotFoundException,
} from './pricing.exceptions';

type PriceListWithRelations = PriceList & {
  currency: Currency;
  basePriceList: { name: string } | null;
};
type VariantWithCatalog = ProductVariant & {
  product: Product & {
    category: { name: string } | null;
    brand: { name: string } | null;
  };
};

const PRICE_LIST_INCLUDE = {
  currency: true,
  basePriceList: { select: { name: true } },
} satisfies Prisma.PriceListInclude;

const VARIANT_CATALOG_INCLUDE = {
  product: {
    include: {
      category: { select: { name: true } },
      brand: { select: { name: true } },
    },
  },
} satisfies Prisma.ProductVariantInclude;

function toDto(p: PriceListWithRelations): PriceListDto {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    description: p.description,
    currencyId: p.currencyId,
    currencyCode: p.currency.code,
    currencySymbol: p.currency.symbol,
    pricingMode: p.pricingMode,
    includesTax: p.includesTax,
    basePriceListId: p.basePriceListId,
    basePriceListName: p.basePriceList?.name ?? null,
    adjustmentType: p.adjustmentType,
    adjustmentValue: p.adjustmentValue ? p.adjustmentValue.toString() : null,
    isDefault: p.isDefault,
    active: p.active,
  };
}

type AuditableFields = Record<
  | 'code'
  | 'name'
  | 'description'
  | 'includesTax'
  | 'basePriceListId'
  | 'adjustmentType'
  | 'adjustmentValue'
  | 'isDefault',
  unknown
>;

function pickAuditFields(p: PriceList): AuditableFields {
  return {
    code: p.code,
    name: p.name,
    description: p.description,
    includesTax: p.includesTax,
    basePriceListId: p.basePriceListId,
    adjustmentType: p.adjustmentType,
    adjustmentValue: p.adjustmentValue ? p.adjustmentValue.toString() : null,
    isDefault: p.isDefault,
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

/**
 * PriceList master CRUD — see docs/pricing.md. The composition layer that
 * joins catalog data (Product/ProductVariant) with resolved pricing
 * (PricingService) also lives here, deliberately kept separate from
 * ProductsService (see CLAUDE.md — never tightly couple the two modules).
 */
@Injectable()
export class PriceListsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly pricingService: PricingService,
  ) {}

  // ---------- CRUD ----------

  async list(companyId: string): Promise<PriceListDto[]> {
    const rows = await this.prisma.priceList.findMany({
      where: { companyId },
      include: PRICE_LIST_INCLUDE,
      orderBy: { name: 'asc' },
    });
    return rows.map(toDto);
  }

  async getById(companyId: string, id: string): Promise<PriceListDto> {
    const list = await this.prisma.priceList.findFirst({
      where: { id, companyId },
      include: PRICE_LIST_INCLUDE,
    });
    if (!list) throw new PriceListNotFoundException();
    return toDto(list);
  }

  async create(
    ctx: RequestContext,
    input: CreatePriceListInput,
  ): Promise<PriceListDto> {
    const currency = await this.prisma.currency.findFirst({
      where: { id: input.currencyId, active: true },
    });
    if (!currency) throw new CurrencyNotFoundException();

    const codeConflict = await this.prisma.priceList.findUnique({
      where: { companyId_code: { companyId: ctx.companyId, code: input.code } },
    });
    if (codeConflict) throw new PriceListCodeAlreadyExistsException();
    const nameConflict = await this.prisma.priceList.findUnique({
      where: { companyId_name: { companyId: ctx.companyId, name: input.name } },
    });
    if (nameConflict) throw new PriceListNameAlreadyExistsException();

    if (input.pricingMode === 'DERIVED') {
      await this.assertValidBase(
        ctx.companyId,
        null,
        input.basePriceListId!,
        input.currencyId,
      );
    }

    const created = await this.prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.priceList.updateMany({
          where: { companyId: ctx.companyId, isDefault: true },
          data: { isDefault: false },
        });
      }
      const list = await tx.priceList.create({
        data: {
          tenantId: ctx.tenantId,
          companyId: ctx.companyId,
          code: input.code,
          name: input.name,
          description: input.description || null,
          currencyId: input.currencyId,
          includesTax: input.includesTax,
          pricingMode: input.pricingMode,
          basePriceListId:
            input.pricingMode === 'DERIVED' ? input.basePriceListId : null,
          adjustmentType:
            input.pricingMode === 'DERIVED' ? input.adjustmentType : null,
          adjustmentValue:
            input.pricingMode === 'DERIVED' ? input.adjustmentValue : null,
          isDefault: input.isDefault,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        },
      });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'CREATE',
          entityType: 'PriceList',
          entityId: list.id,
          after: {
            code: list.code,
            name: list.name,
            pricingMode: list.pricingMode,
            currencyId: list.currencyId,
            isDefault: list.isDefault,
          },
        },
        tx,
      );
      return list;
    });
    return this.getById(ctx.companyId, created.id);
  }

  async update(
    ctx: RequestContext,
    id: string,
    input: UpdatePriceListInput,
  ): Promise<PriceListDto> {
    const existing = await this.findScopedOrThrow(ctx.companyId, id);

    if (input.code !== undefined && input.code !== existing.code) {
      const conflict = await this.prisma.priceList.findUnique({
        where: {
          companyId_code: { companyId: ctx.companyId, code: input.code },
        },
      });
      if (conflict) throw new PriceListCodeAlreadyExistsException();
    }
    if (input.name !== undefined && input.name !== existing.name) {
      const conflict = await this.prisma.priceList.findUnique({
        where: {
          companyId_name: { companyId: ctx.companyId, name: input.name },
        },
      });
      if (conflict) throw new PriceListNameAlreadyExistsException();
    }

    const touchesDerivedFields =
      input.basePriceListId !== undefined ||
      input.adjustmentType !== undefined ||
      input.adjustmentValue !== undefined;
    if (touchesDerivedFields && existing.pricingMode !== 'DERIVED') {
      throw new PriceListNotDerivedException();
    }
    if (
      existing.pricingMode === 'DERIVED' &&
      input.basePriceListId !== undefined
    ) {
      await this.assertValidBase(
        ctx.companyId,
        existing.id,
        input.basePriceListId,
        existing.currencyId,
      );
    }

    const beforeSnapshot = pickAuditFields(existing);

    const data: Prisma.PriceListUncheckedUpdateInput = {
      updatedBy: ctx.userId,
    };
    if (input.code !== undefined) data.code = input.code;
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined)
      data.description = input.description || null;
    if (input.includesTax !== undefined) data.includesTax = input.includesTax;
    if (input.basePriceListId !== undefined)
      data.basePriceListId = input.basePriceListId;
    if (input.adjustmentType !== undefined)
      data.adjustmentType = input.adjustmentType;
    if (input.adjustmentValue !== undefined)
      data.adjustmentValue = input.adjustmentValue;

    await this.prisma.$transaction(async (tx) => {
      if (input.isDefault === true) {
        await tx.priceList.updateMany({
          where: { companyId: ctx.companyId, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
        data.isDefault = true;
      } else if (input.isDefault === false) {
        data.isDefault = false;
      }

      const updated = await tx.priceList.update({
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
            entityType: 'PriceList',
            entityId: id,
            before: diff.before,
            after: diff.after,
          },
          tx,
        );
      }
    });
    return this.getById(ctx.companyId, id);
  }

  async deactivate(ctx: RequestContext, id: string): Promise<PriceListDto> {
    const existing = await this.findScopedOrThrow(ctx.companyId, id);
    if (!existing.active) return this.getById(ctx.companyId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.priceList.update({
        where: { id },
        data: { active: false, updatedBy: ctx.userId },
      });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'DEACTIVATE',
          entityType: 'PriceList',
          entityId: id,
          before: { active: true },
          after: { active: false },
        },
        tx,
      );
    });
    return this.getById(ctx.companyId, id);
  }

  async reactivate(ctx: RequestContext, id: string): Promise<PriceListDto> {
    const existing = await this.findScopedOrThrow(ctx.companyId, id);
    if (existing.active) return this.getById(ctx.companyId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.priceList.update({
        where: { id },
        data: { active: true, updatedBy: ctx.userId },
      });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'ACTIVATE',
          entityType: 'PriceList',
          entityId: id,
          before: { active: false },
          after: { active: true },
        },
        tx,
      );
    });
    return this.getById(ctx.companyId, id);
  }

  /** Administrative history (created/updated/deactivated/...) — distinct from PricingService.getPriceHistory's commercial price evolution. See docs/pricing.md. */
  async getHistory(
    companyId: string,
    id: string,
    query: PriceListHistoryQuery,
  ): Promise<AuditEntityHistoryResponse> {
    await this.findScopedOrThrow(companyId, id);
    return this.auditService.getEntityHistory(
      companyId,
      'PriceList',
      id,
      query,
    );
  }

  // ---------- Items (catalog + resolved price, composed at read time) ----------

  async listItems(
    companyId: string,
    priceListId: string,
    query: PriceListItemsQuery,
  ): Promise<PriceListItemsResponse> {
    await this.pricingService.loadPriceList(companyId, priceListId);

    const searchOr = query.search
      ? [
          {
            product: {
              code: { contains: query.search, mode: 'insensitive' as const },
            },
          },
          {
            product: {
              name: { contains: query.search, mode: 'insensitive' as const },
            },
          },
          { sku: { contains: query.search, mode: 'insensitive' as const } },
        ]
      : undefined;

    const where: Prisma.ProductVariantWhereInput = {
      active: true,
      product: {
        companyId,
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        ...(query.brandId ? { brandId: query.brandId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      ...(searchOr ? { OR: searchOr } : {}),
    };

    if (query.hasPrice !== undefined) {
      // Computed filter — same documented trade-off as InventoryService.listStock's
      // belowMinimum: fetch the already-filtered candidate set, resolve price in
      // application code, filter, THEN paginate in memory.
      const candidates = await this.prisma.productVariant.findMany({
        where,
        include: VARIANT_CATALOG_INCLUDE,
        orderBy: { product: { name: 'asc' } },
      });
      const rows = await Promise.all(
        candidates.map((v) => this.toItemRow(companyId, priceListId, v)),
      );
      const filtered = rows.filter((r) =>
        query.hasPrice ? r.price !== null : r.price === null,
      );
      const start = (query.page - 1) * query.pageSize;
      return {
        items: filtered.slice(start, start + query.pageSize),
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          total: filtered.length,
        },
      };
    }

    const skip = (query.page - 1) * query.pageSize;
    const [total, variants] = await this.prisma.$transaction([
      this.prisma.productVariant.count({ where }),
      this.prisma.productVariant.findMany({
        where,
        include: VARIANT_CATALOG_INCLUDE,
        orderBy: { product: { name: 'asc' } },
        skip,
        take: query.pageSize,
      }),
    ]);
    const items = await Promise.all(
      variants.map((v) => this.toItemRow(companyId, priceListId, v)),
    );
    return {
      items,
      pagination: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  private async toItemRow(
    companyId: string,
    priceListId: string,
    variant: VariantWithCatalog,
  ): Promise<PriceListItemRowDto> {
    const resolved = await this.pricingService.resolvePrice(
      companyId,
      priceListId,
      variant.id,
    );
    return {
      variantId: variant.id,
      productId: variant.product.id,
      productCode: variant.product.code,
      sku: variant.sku,
      productName: variant.product.name,
      variantName: variant.name,
      categoryName: variant.product.category?.name ?? null,
      brandName: variant.product.brand?.name ?? null,
      price: resolved ? resolved.price.toString() : null,
      effectiveFrom: resolved?.effectiveFrom ?? null,
      source: resolved?.source ?? 'FIXED',
    };
  }

  // ---------- Product price view (Product detail "Precios" tab) ----------

  async getProductPrices(
    companyId: string,
    productId: string,
  ): Promise<ProductPricesResponse> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, companyId },
      include: { variants: true },
    });
    if (!product) throw new ProductNotFoundException();

    const activeLists = await this.prisma.priceList.findMany({
      where: { companyId, active: true },
      include: PRICE_LIST_INCLUDE,
      orderBy: { name: 'asc' },
    });

    const variants: ProductVariantPricesDto[] = [];
    for (const variant of product.variants.filter((v) => v.active)) {
      const prices = await Promise.all(
        activeLists.map(async (list) => {
          const resolved = await this.pricingService.resolvePrice(
            companyId,
            list.id,
            variant.id,
          );
          return {
            priceListId: list.id,
            priceListName: list.name,
            priceListCode: list.code,
            currencyCode: list.currency.code,
            price: resolved ? resolved.price.toString() : null,
            effectiveFrom: resolved?.effectiveFrom ?? null,
            source: resolved?.source ?? list.pricingMode,
          };
        }),
      );
      variants.push({
        variantId: variant.id,
        variantName: variant.name,
        sku: variant.sku,
        prices,
      });
    }

    return { productId: product.id, productName: product.name, variants };
  }

  // ---------- Currencies ----------

  async listCurrencies(): Promise<CurrencyDto[]> {
    const rows = await this.prisma.currency.findMany({
      where: { active: true },
      orderBy: { code: 'asc' },
    });
    return rows.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      symbol: c.symbol,
      decimalPlaces: c.decimalPlaces,
      active: c.active,
    }));
  }

  // ---------- Internal ----------

  private async findScopedOrThrow(
    companyId: string,
    id: string,
  ): Promise<PriceList> {
    const list = await this.prisma.priceList.findFirst({
      where: { id, companyId },
    });
    if (!list) throw new PriceListNotFoundException();
    return list;
  }

  /** Validates the proposed base belongs to the same company/currency and introduces no cycle. `listId` is null when creating a brand-new list. */
  private async assertValidBase(
    companyId: string,
    listId: string | null,
    baseId: string,
    currencyId: string,
  ): Promise<void> {
    const base = await this.prisma.priceList.findFirst({
      where: { id: baseId, companyId },
    });
    if (!base) throw new PriceListNotFoundException();
    if (base.currencyId !== currencyId)
      throw new PriceListCurrencyMismatchException();
    await this.assertNoCycle(companyId, listId, baseId);
  }

  private async assertNoCycle(
    companyId: string,
    listId: string | null,
    baseId: string,
  ): Promise<void> {
    if (listId && baseId === listId) throw new PriceListCycleException();
    const visited = new Set<string>(listId ? [listId] : []);
    let currentId: string | null = baseId;
    let iterations = 0;
    while (currentId) {
      if (visited.has(currentId)) throw new PriceListCycleException();
      visited.add(currentId);
      iterations += 1;
      if (iterations > 50) throw new PriceListCycleException();
      const current: { basePriceListId: string | null } | null =
        await this.prisma.priceList.findFirst({
          where: { id: currentId, companyId },
          select: { basePriceListId: true },
        });
      if (!current) throw new PriceListNotFoundException();
      currentId = current.basePriceListId;
    }
  }
}
