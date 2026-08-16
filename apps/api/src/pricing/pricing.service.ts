import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import type {
  PriceList,
  PriceListItem,
  PriceHistory,
  Currency,
  ProductVariant,
  Product,
} from '../generated/prisma/client';
import type {
  AdjustmentType,
  PriceChangeType,
  SetPriceInput,
  SetPricesBatchInput,
  BulkAdjustInput,
  PriceHistoryQuery,
  PriceHistoryResponse,
  PriceHistoryEntryDto,
  PriceSetResultDto,
  BulkAdjustPreviewResponse,
  BulkAdjustResponse,
  PriceLookupResult,
  PriceLookupBatchItemDto,
} from '@erp/shared';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../company-context/types';
import { ProductVariantNotFoundException } from '../products/products.exceptions';
import {
  PriceListNotFoundException,
  PriceListInactiveException,
  PriceListNotFixedException,
  PriceListCycleException,
  PriceNotFoundException,
  PriceValidityOverlapException,
} from './pricing.exceptions';

type VariantWithProduct = ProductVariant & { product: Product };
type PriceListWithCurrency = PriceList & { currency: Currency };

const VARIANT_INCLUDE = {
  product: true,
} satisfies Prisma.ProductVariantInclude;

/** Defensive depth guard on top of create/update-time cycle rejection — see docs/pricing.md. */
const MAX_DERIVATION_DEPTH = 10;

interface ResolvedPriceInternal {
  price: Prisma.Decimal;
  source: 'FIXED' | 'DERIVED';
  priceListId: string;
  priceListName: string;
  currencyCode: string;
  basePriceListId?: string;
  adjustment?: string;
  /** The underlying FIXED price's effective date, propagated through any DERIVED chain. */
  effectiveFrom?: string;
}

function applyAdjustment(
  base: Prisma.Decimal,
  type: AdjustmentType,
  value: string | Prisma.Decimal,
): Prisma.Decimal {
  const v = new Prisma.Decimal(value);
  switch (type) {
    case 'PERCENTAGE_INCREASE':
      return base.mul(v.div(100).add(1));
    case 'PERCENTAGE_DECREASE':
      return base.mul(new Prisma.Decimal(1).sub(v.div(100)));
    case 'FIXED_AMOUNT_INCREASE':
      return base.add(v);
    case 'FIXED_AMOUNT_DECREASE':
      return base.sub(v);
  }
}

function formatAdjustment(type: AdjustmentType, value: Prisma.Decimal): string {
  switch (type) {
    case 'PERCENTAGE_INCREASE':
      return `+${value.toString()}%`;
    case 'PERCENTAGE_DECREASE':
      return `-${value.toString()}%`;
    case 'FIXED_AMOUNT_INCREASE':
      return `+${value.toString()}`;
    case 'FIXED_AMOUNT_DECREASE':
      return `-${value.toString()}`;
  }
}

function toLookupResult(r: ResolvedPriceInternal): PriceLookupResult {
  return {
    price: r.price.toString(),
    currencyCode: r.currencyCode,
    priceListId: r.priceListId,
    priceListName: r.priceListName,
    source: r.source,
    ...(r.basePriceListId ? { basePriceListId: r.basePriceListId } : {}),
    ...(r.adjustment ? { adjustment: r.adjustment } : {}),
    ...(r.effectiveFrom ? { effectiveFrom: r.effectiveFrom } : {}),
  };
}

function toHistoryDto(
  h: PriceHistory,
  changedByName: string | null,
): PriceHistoryEntryDto {
  return {
    id: h.id,
    oldPrice: h.oldPrice ? h.oldPrice.toString() : null,
    newPrice: h.newPrice.toString(),
    effectiveFrom: h.effectiveFrom.toISOString().slice(0, 10),
    changeType: h.changeType,
    reason: h.reason,
    changedBy: h.changedBy ? { id: h.changedBy, name: changedByName } : null,
    changedAt: h.changedAt.toISOString(),
  };
}

/** DATE semantics, not timestamp — a price is effective for a whole business day. See docs/pricing.md. */
function startOfDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/**
 * The pricing resolution + mutation engine — see docs/pricing.md and
 * CLAUDE.md. `PriceListItem` rows are never written directly by a
 * controller; every mutation goes through here so Decimal handling,
 * validity-range rules, PriceHistory, and audit stay together. FIXED
 * lists hold explicit rows; DERIVED lists are resolved recursively at
 * read time and never materialized.
 */
@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  // ---------- Scoped loaders (also reused by PriceListsService) ----------

  async loadPriceList(
    companyId: string,
    id: string,
  ): Promise<PriceListWithCurrency> {
    const list = await this.prisma.priceList.findFirst({
      where: { id, companyId },
      include: { currency: true },
    });
    if (!list) throw new PriceListNotFoundException();
    return list;
  }

  async loadVariant(
    companyId: string,
    id: string,
  ): Promise<VariantWithProduct> {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id, product: { companyId } },
      include: VARIANT_INCLUDE,
    });
    if (!variant) throw new ProductVariantNotFoundException();
    return variant;
  }

  // ---------- Resolution ----------

  /**
   * Core resolver — tolerant of "no price" (returns null), used by both
   * admin views (product price tab, item listing) and the operational
   * wrapper below. Deliberately does NOT check PriceList.active —
   * administration/history may still resolve an inactive list; only
   * `getPrice`/`getPrices` (operational lookup) reject that.
   */
  async resolvePrice(
    companyId: string,
    priceListId: string,
    productVariantId: string,
    date: Date = new Date(),
  ): Promise<ResolvedPriceInternal | null> {
    const list = await this.loadPriceList(companyId, priceListId);
    return this.resolveRecursive(
      companyId,
      list,
      productVariantId,
      date,
      new Set(),
      0,
    );
  }

  private async resolveRecursive(
    companyId: string,
    list: PriceListWithCurrency,
    productVariantId: string,
    date: Date,
    visited: Set<string>,
    depth: number,
  ): Promise<ResolvedPriceInternal | null> {
    if (depth > MAX_DERIVATION_DEPTH || visited.has(list.id)) {
      // Real cycles are rejected at create/update time (PriceListsService) — this only
      // protects resolution itself in case that invariant is ever violated.
      throw new PriceListCycleException();
    }
    visited.add(list.id);

    if (list.pricingMode === 'FIXED') {
      const item = await this.prisma.priceListItem.findFirst({
        where: {
          companyId,
          priceListId: list.id,
          productVariantId,
          active: true,
          effectiveFrom: { lte: date },
          OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: date } }],
        },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (!item) return null;
      return {
        price: item.price,
        source: 'FIXED',
        priceListId: list.id,
        priceListName: list.name,
        currencyCode: list.currency.code,
        effectiveFrom: item.effectiveFrom.toISOString().slice(0, 10),
      };
    }

    // DERIVED
    if (!list.basePriceListId || !list.adjustmentType || !list.adjustmentValue)
      return null;
    const base = await this.loadPriceList(companyId, list.basePriceListId);
    const baseResolved = await this.resolveRecursive(
      companyId,
      base,
      productVariantId,
      date,
      visited,
      depth + 1,
    );
    if (!baseResolved) return null;

    const adjustedRaw = applyAdjustment(
      baseResolved.price,
      list.adjustmentType,
      list.adjustmentValue,
    );
    // Zero is a legitimate price; negative never is (see docs/pricing.md).
    const floored = Prisma.Decimal.max(adjustedRaw, 0);
    const rounded = floored.toDecimalPlaces(
      list.currency.decimalPlaces,
      Prisma.Decimal.ROUND_HALF_UP,
    );

    return {
      price: rounded,
      source: 'DERIVED',
      priceListId: list.id,
      priceListName: list.name,
      currencyCode: list.currency.code,
      basePriceListId: base.id,
      adjustment: formatAdjustment(list.adjustmentType, list.adjustmentValue),
      effectiveFrom: baseResolved.effectiveFrom,
    };
  }

  /** Operational entrypoint — rejects an inactive list and never returns zero for a missing price. See docs/pricing.md. */
  async getPrice(
    companyId: string,
    priceListId: string,
    productVariantId: string,
    date?: Date,
  ): Promise<PriceLookupResult> {
    const list = await this.loadPriceList(companyId, priceListId);
    if (!list.active) throw new PriceListInactiveException();
    const resolved = await this.resolveRecursive(
      companyId,
      list,
      productVariantId,
      date ?? new Date(),
      new Set(),
      0,
    );
    if (!resolved) throw new PriceNotFoundException();
    return toLookupResult(resolved);
  }

  /** Batch operational lookup — never fails the whole batch for one missing price; each item reports `found`, never a fabricated "0". */
  async getPrices(
    companyId: string,
    priceListId: string,
    productVariantIds: string[],
    date?: Date,
  ): Promise<{ currencyCode: string; items: PriceLookupBatchItemDto[] }> {
    const list = await this.loadPriceList(companyId, priceListId);
    if (!list.active) throw new PriceListInactiveException();
    const effectiveDate = date ?? new Date();
    const items: PriceLookupBatchItemDto[] = [];
    for (const productVariantId of productVariantIds) {
      const resolved = await this.resolveRecursive(
        companyId,
        list,
        productVariantId,
        effectiveDate,
        new Set(),
        0,
      );
      items.push({
        productVariantId,
        found: resolved !== null,
        price: resolved
          ? resolved.price.toFixed(list.currency.decimalPlaces)
          : null,
        source: resolved?.source ?? null,
      });
    }
    return { currencyCode: list.currency.code, items };
  }

  // ---------- Mutations (FIXED lists only) ----------

  /**
   * Setting a new current price automatically closes the prior open-ended
   * validity period in the same transaction ("Prefer B" from
   * docs/inventory.md's precedent — see docs/pricing.md for the full
   * decision). Shared by setPrice/setPrices/bulk-adjust confirmation so
   * every price mutation goes through identical overlap/history logic.
   */
  private async applyPriceChange(
    tx: Prisma.TransactionClient,
    ctx: RequestContext,
    list: PriceList,
    productVariantId: string,
    price: string,
    effectiveFrom: Date,
    changeType: PriceChangeType,
    reason?: string,
  ): Promise<PriceListItem> {
    const priceDecimal = new Prisma.Decimal(price);

    const overlapping = await tx.priceListItem.findMany({
      where: {
        companyId: ctx.companyId,
        priceListId: list.id,
        productVariantId,
        active: true,
        OR: [
          { effectiveUntil: null },
          { effectiveUntil: { gte: effectiveFrom } },
        ],
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    let oldPrice: Prisma.Decimal | null = null;

    if (overlapping.length > 0) {
      const [mostRecent, ...rest] = overlapping;
      if (rest.length > 0) {
        // More than one currently-active row could overlap — this service never produces
        // that state on its own; refuse rather than guess which one to close.
        throw new PriceValidityOverlapException();
      }
      if (mostRecent.effectiveFrom.getTime() === effectiveFrom.getTime()) {
        // Same-day correction — supersede in place rather than compute an adjacent boundary.
        oldPrice = mostRecent.price;
        await tx.priceListItem.update({
          where: { id: mostRecent.id },
          data: { active: false, updatedBy: ctx.userId },
        });
      } else if (mostRecent.effectiveFrom.getTime() < effectiveFrom.getTime()) {
        if (mostRecent.effectiveUntil !== null) {
          // A bounded row that still overlaps [effectiveFrom, ...) is an ambiguous state — reject.
          throw new PriceValidityOverlapException();
        }
        oldPrice = mostRecent.price;
        const closeDate = new Date(effectiveFrom);
        closeDate.setUTCDate(closeDate.getUTCDate() - 1);
        await tx.priceListItem.update({
          where: { id: mostRecent.id },
          data: { effectiveUntil: closeDate, updatedBy: ctx.userId },
        });
      } else {
        // mostRecent starts AFTER effectiveFrom — inserting a new open-ended price before an
        // already-scheduled future price is a genuine overlap; reject explicitly.
        throw new PriceValidityOverlapException();
      }
    }

    const created = await tx.priceListItem.create({
      data: {
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        priceListId: list.id,
        productVariantId,
        price: priceDecimal,
        effectiveFrom,
        effectiveUntil: null,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      },
    });

    await tx.priceHistory.create({
      data: {
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        priceListId: list.id,
        productVariantId,
        oldPrice,
        newPrice: priceDecimal,
        effectiveFrom,
        // A variant's very first price is always INITIAL, regardless of what created it.
        changeType: oldPrice === null ? 'INITIAL' : changeType,
        reason: reason ?? null,
        changedBy: ctx.userId,
      },
    });

    return created;
  }

  async setPrice(
    ctx: RequestContext,
    priceListId: string,
    productVariantId: string,
    input: SetPriceInput,
  ): Promise<PriceSetResultDto> {
    const list = await this.loadPriceList(ctx.companyId, priceListId);
    if (list.pricingMode !== 'FIXED') throw new PriceListNotFixedException();
    await this.loadVariant(ctx.companyId, productVariantId);

    const effectiveFrom = startOfDay(input.effectiveFrom ?? new Date());

    return this.prisma.$transaction(async (tx) => {
      const created = await this.applyPriceChange(
        tx,
        ctx,
        list,
        productVariantId,
        input.price,
        effectiveFrom,
        'MANUAL',
        input.reason,
      );
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'UPDATE',
          entityType: 'PriceList',
          entityId: list.id,
          metadata: {
            change: 'price_set',
            priceListName: list.name,
            productVariantId,
            newPrice: input.price,
            effectiveFrom: effectiveFrom.toISOString().slice(0, 10),
            reason: input.reason ?? null,
          },
        },
        tx,
      );
      return {
        variantId: productVariantId,
        price: created.price.toString(),
        effectiveFrom: created.effectiveFrom.toISOString().slice(0, 10),
      };
    });
  }

  async setPrices(
    ctx: RequestContext,
    priceListId: string,
    input: SetPricesBatchInput,
  ): Promise<PriceSetResultDto[]> {
    const list = await this.loadPriceList(ctx.companyId, priceListId);
    if (list.pricingMode !== 'FIXED') throw new PriceListNotFixedException();
    // Validate every variant belongs to the company BEFORE writing anything —
    // a single invalid line must fail the whole batch, never a partial apply.
    for (const line of input.items) {
      await this.loadVariant(ctx.companyId, line.productVariantId);
    }
    const effectiveFrom = startOfDay(input.effectiveFrom ?? new Date());

    return this.prisma.$transaction(async (tx) => {
      const results: PriceSetResultDto[] = [];
      for (const line of input.items) {
        const created = await this.applyPriceChange(
          tx,
          ctx,
          list,
          line.productVariantId,
          line.price,
          effectiveFrom,
          'MANUAL',
          input.reason,
        );
        results.push({
          variantId: line.productVariantId,
          price: created.price.toString(),
          effectiveFrom: created.effectiveFrom.toISOString().slice(0, 10),
        });
      }
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'UPDATE',
          entityType: 'PriceList',
          entityId: list.id,
          metadata: {
            change: 'prices_batch_set',
            priceListName: list.name,
            effectiveFrom: effectiveFrom.toISOString().slice(0, 10),
            affectedCount: input.items.length,
            reason: input.reason ?? null,
          },
        },
        tx,
      );
      return results;
    });
  }

  // ---------- Bulk adjustment (FIXED lists only) ----------

  private async computeBulkAdjustLines(
    companyId: string,
    list: PriceListWithCurrency,
    input: BulkAdjustInput,
  ): Promise<
    {
      variant: VariantWithProduct;
      currentPrice: Prisma.Decimal;
      newPrice: Prisma.Decimal;
    }[]
  > {
    const productWhere: Prisma.ProductWhereInput = {
      companyId,
      status: 'ACTIVE',
      ...(input.scope === 'CATEGORY' ? { categoryId: input.categoryId } : {}),
      ...(input.scope === 'BRAND' ? { brandId: input.brandId } : {}),
    };
    const candidates = await this.prisma.productVariant.findMany({
      where: { active: true, product: productWhere },
      include: VARIANT_INCLUDE,
    });

    const lines: {
      variant: VariantWithProduct;
      currentPrice: Prisma.Decimal;
      newPrice: Prisma.Decimal;
    }[] = [];
    for (const variant of candidates) {
      // Bulk-adjust only touches variants that currently HAVE a price — it never creates one.
      const resolved = await this.resolveRecursive(
        companyId,
        list,
        variant.id,
        new Date(),
        new Set(),
        0,
      );
      if (!resolved) continue;
      const adjustedRaw = applyAdjustment(
        resolved.price,
        input.adjustmentType,
        input.value,
      );
      const newPrice = Prisma.Decimal.max(adjustedRaw, 0).toDecimalPlaces(
        list.currency.decimalPlaces,
        Prisma.Decimal.ROUND_HALF_UP,
      );
      lines.push({ variant, currentPrice: resolved.price, newPrice });
    }
    return lines;
  }

  /** No database changes — see docs/pricing.md. */
  async previewBulkAdjust(
    companyId: string,
    priceListId: string,
    input: BulkAdjustInput,
  ): Promise<BulkAdjustPreviewResponse> {
    const list = await this.loadPriceList(companyId, priceListId);
    if (list.pricingMode !== 'FIXED') throw new PriceListNotFixedException();
    const lines = await this.computeBulkAdjustLines(companyId, list, input);
    return {
      affectedCount: lines.length,
      lines: lines.map((l) => ({
        variantId: l.variant.id,
        productName: l.variant.product.name,
        variantName: l.variant.name,
        sku: l.variant.sku,
        currentPrice: l.currentPrice.toString(),
        newPrice: l.newPrice.toString(),
      })),
    };
  }

  async confirmBulkAdjust(
    ctx: RequestContext,
    priceListId: string,
    input: BulkAdjustInput,
  ): Promise<BulkAdjustResponse> {
    const list = await this.loadPriceList(ctx.companyId, priceListId);
    if (list.pricingMode !== 'FIXED') throw new PriceListNotFixedException();
    const lines = await this.computeBulkAdjustLines(ctx.companyId, list, input);
    const effectiveFrom = startOfDay(input.effectiveFrom);

    await this.prisma.$transaction(async (tx) => {
      for (const line of lines) {
        await this.applyPriceChange(
          tx,
          ctx,
          list,
          line.variant.id,
          line.newPrice.toString(),
          effectiveFrom,
          'BULK_ADJUSTMENT',
          input.reason,
        );
      }
      // One meaningful parent audit event, not one row per affected variant — see CLAUDE.md.
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'UPDATE',
          entityType: 'PriceList',
          entityId: list.id,
          metadata: {
            change: 'bulk_adjustment',
            priceListName: list.name,
            adjustmentType: input.adjustmentType,
            value: input.value,
            effectiveFrom: effectiveFrom.toISOString().slice(0, 10),
            scope: input.scope,
            categoryId: input.categoryId ?? null,
            brandId: input.brandId ?? null,
            affectedCount: lines.length,
            reason: input.reason ?? null,
          },
        },
        tx,
      );
    });

    return { affectedCount: lines.length };
  }

  // ---------- History ----------

  async getPriceHistory(
    companyId: string,
    priceListId: string,
    productVariantId: string,
    query: PriceHistoryQuery,
  ): Promise<PriceHistoryResponse> {
    await this.loadPriceList(companyId, priceListId);
    await this.loadVariant(companyId, productVariantId);

    const where: Prisma.PriceHistoryWhereInput = {
      companyId,
      priceListId,
      productVariantId,
    };
    const skip = (query.page - 1) * query.pageSize;
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.priceHistory.count({ where }),
      this.prisma.priceHistory.findMany({
        where,
        orderBy: { effectiveFrom: 'desc' },
        skip,
        take: query.pageSize,
      }),
    ]);
    const names = await this.resolveUserNames(rows.map((r) => r.changedBy));
    return {
      items: rows.map((r) =>
        toHistoryDto(r, r.changedBy ? (names.get(r.changedBy) ?? null) : null),
      ),
      pagination: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  private async resolveUserNames(
    userIds: (string | null)[],
  ): Promise<Map<string, string>> {
    const ids = [...new Set(userIds.filter((id): id is string => !!id))];
    if (ids.length === 0) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
    });
    return new Map(
      users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]),
    );
  }
}
