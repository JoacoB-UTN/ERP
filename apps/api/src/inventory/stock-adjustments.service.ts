import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import type {
  StockAdjustment,
  StockAdjustmentLine,
  ProductVariant,
  Product,
  Warehouse,
} from '../generated/prisma/client';
import type {
  CreateStockAdjustmentInput,
  UpdateStockAdjustmentInput,
  StockAdjustmentListQuery,
  StockAdjustmentListResponse,
  StockAdjustmentDetail,
  StockAdjustmentSummary,
  StockAdjustmentLineDto,
} from '@erp/shared';
import { exceedsDecimalPrecision } from '@erp/shared';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../company-context/types';
import { WarehouseNotFoundException } from '../warehouses/warehouses.exceptions';
import { ProductVariantNotFoundException } from '../products/products.exceptions';
import {
  ProductDoesNotTrackInventoryException,
  InvalidQuantityPrecisionException,
  StockAdjustmentNotFoundException,
  StockAdjustmentNotDraftException,
} from './inventory.exceptions';
import { InventoryService } from './inventory.service';

type LineWithVariant = StockAdjustmentLine & {
  variant: ProductVariant & { product: Product };
};
type AdjustmentWithRelations = StockAdjustment & {
  warehouse: Warehouse;
  lines: LineWithVariant[];
};

const ADJUSTMENT_INCLUDE = {
  warehouse: true,
  lines: { include: { variant: { include: { product: true } } } },
} satisfies Prisma.StockAdjustmentInclude;

function toLineDto(line: LineWithVariant): StockAdjustmentLineDto {
  return {
    id: line.id,
    productVariantId: line.productVariantId,
    productId: line.variant.product.id,
    productName: line.variant.product.name,
    variantName: line.variant.name,
    sku: line.variant.sku,
    quantityDelta: line.quantityDelta.toString(),
    reason: line.reason,
  };
}

function toSummary(
  a: AdjustmentWithRelations,
  createdByName: string | null,
): StockAdjustmentSummary {
  return {
    id: a.id,
    number: a.number,
    warehouseId: a.warehouseId,
    warehouseName: a.warehouse.name,
    reason: a.reason,
    status: a.status,
    occurredAt: a.occurredAt.toISOString(),
    lineCount: a.lines.length,
    createdBy: a.createdBy ? { id: a.createdBy, name: createdByName } : null,
  };
}

function toDetail(
  a: AdjustmentWithRelations,
  createdByName: string | null,
): StockAdjustmentDetail {
  return {
    ...toSummary(a, createdByName),
    notes: a.notes,
    lines: a.lines.map(toLineDto),
    createdAt: a.createdAt.toISOString(),
    confirmedAt: a.confirmedAt?.toISOString() ?? null,
  };
}

/**
 * Business-level wrapper around raw stock movements — see docs/inventory.md.
 * Only CONFIRMED adjustments generate StockMovement rows (via
 * InventoryService.applyAdjustmentLine, in the same transaction as the
 * status change). DRAFT adjustments never touch inventory. Confirmed
 * adjustments are immutable — this task deliberately does NOT support
 * reversing one; corrections require a new adjustment (see CLAUDE.md and
 * docs/inventory.md's documented "prefer B" decision).
 */
@Injectable()
export class StockAdjustmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly inventoryService: InventoryService,
  ) {}

  async list(
    companyId: string,
    query: StockAdjustmentListQuery,
  ): Promise<StockAdjustmentListResponse> {
    const where: Prisma.StockAdjustmentWhereInput = {
      companyId,
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const skip = (query.page - 1) * query.pageSize;
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.stockAdjustment.count({ where }),
      this.prisma.stockAdjustment.findMany({
        where,
        include: ADJUSTMENT_INCLUDE,
        orderBy: { occurredAt: 'desc' },
        skip,
        take: query.pageSize,
      }),
    ]);
    const names = await this.resolveCreatorNames(rows.map((r) => r.createdBy));
    return {
      items: rows.map((r) =>
        toSummary(r, r.createdBy ? (names.get(r.createdBy) ?? null) : null),
      ),
      pagination: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  async getById(companyId: string, id: string): Promise<StockAdjustmentDetail> {
    const adjustment = await this.findScopedOrThrow(companyId, id);
    const names = await this.resolveCreatorNames([adjustment.createdBy]);
    return toDetail(
      adjustment,
      adjustment.createdBy ? (names.get(adjustment.createdBy) ?? null) : null,
    );
  }

  async create(
    ctx: RequestContext,
    input: CreateStockAdjustmentInput,
  ): Promise<StockAdjustmentDetail> {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: input.warehouseId, companyId: ctx.companyId },
    });
    if (!warehouse) throw new WarehouseNotFoundException();

    const combined = this.inventoryService.combineDeltaLines(input.lines);
    await this.validateLines(ctx.companyId, combined);

    const occurredAt = input.occurredAt ?? new Date();

    const created = await this.prisma.$transaction(async (tx) => {
      const number = await this.nextNumber(tx, ctx.companyId);
      const adjustment = await tx.stockAdjustment.create({
        data: {
          tenantId: ctx.tenantId,
          companyId: ctx.companyId,
          branchId: ctx.branchId ?? null,
          warehouseId: warehouse.id,
          number,
          reason: input.reason,
          notes: input.notes || null,
          occurredAt,
          createdBy: ctx.userId,
          lines: {
            create: combined.map((l) => ({
              productVariantId: l.productVariantId,
              quantityDelta: l.quantityDelta,
              reason: l.reason || null,
            })),
          },
        },
      });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'CREATE',
          entityType: 'StockAdjustment',
          entityId: adjustment.id,
          after: {
            number: adjustment.number,
            reason: adjustment.reason,
            status: adjustment.status,
          },
        },
        tx,
      );
      return adjustment;
    });
    return this.getById(ctx.companyId, created.id);
  }

  async update(
    ctx: RequestContext,
    id: string,
    input: UpdateStockAdjustmentInput,
  ): Promise<StockAdjustmentDetail> {
    const existing = await this.findScopedOrThrow(ctx.companyId, id);
    if (existing.status !== 'DRAFT')
      throw new StockAdjustmentNotDraftException();

    let warehouse = existing.warehouse;
    if (
      input.warehouseId !== undefined &&
      input.warehouseId !== existing.warehouseId
    ) {
      const found = await this.prisma.warehouse.findFirst({
        where: { id: input.warehouseId, companyId: ctx.companyId },
      });
      if (!found) throw new WarehouseNotFoundException();
      warehouse = found;
    }

    const combined = input.lines
      ? this.inventoryService.combineDeltaLines(input.lines)
      : undefined;
    if (combined) await this.validateLines(ctx.companyId, combined);

    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.StockAdjustmentUncheckedUpdateInput = {};
      if (input.warehouseId !== undefined) data.warehouseId = warehouse.id;
      if (input.reason !== undefined) data.reason = input.reason;
      if (input.notes !== undefined) data.notes = input.notes || null;
      if (input.occurredAt !== undefined) data.occurredAt = input.occurredAt;

      await tx.stockAdjustment.update({ where: { id: existing.id }, data });

      if (combined) {
        await tx.stockAdjustmentLine.deleteMany({
          where: { stockAdjustmentId: existing.id },
        });
        await tx.stockAdjustmentLine.createMany({
          data: combined.map((l) => ({
            stockAdjustmentId: existing.id,
            productVariantId: l.productVariantId,
            quantityDelta: l.quantityDelta,
            reason: l.reason || null,
          })),
        });
      }

      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'UPDATE',
          entityType: 'StockAdjustment',
          entityId: id,
          metadata: { change: 'draft_updated' },
        },
        tx,
      );
    });
    return this.getById(ctx.companyId, id);
  }

  async confirm(
    ctx: RequestContext,
    id: string,
  ): Promise<StockAdjustmentDetail> {
    const existing = await this.findScopedOrThrow(ctx.companyId, id);
    if (existing.status !== 'DRAFT')
      throw new StockAdjustmentNotDraftException();

    await this.prisma.$transaction(async (tx) => {
      for (const line of existing.lines) {
        await this.inventoryService.applyAdjustmentLine(tx, ctx, {
          warehouse: existing.warehouse,
          productVariantId: line.productVariantId,
          quantityDelta: line.quantityDelta.toString(),
          reason: line.reason ?? undefined,
          referenceType: 'StockAdjustment',
          referenceId: existing.id,
          occurredAt: existing.occurredAt,
        });
      }

      await tx.stockAdjustment.update({
        where: { id },
        data: {
          status: 'CONFIRMED',
          confirmedAt: new Date(),
          confirmedBy: ctx.userId,
        },
      });

      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'CONFIRM',
          entityType: 'StockAdjustment',
          entityId: id,
          metadata: {
            change: 'adjustment_confirmed',
            number: existing.number,
            warehouseName: existing.warehouse.name,
            lines: existing.lines.map((l) => ({
              productName: l.variant.product.name,
              variantName: l.variant.name,
              quantityDelta: l.quantityDelta.toString(),
            })),
          },
        },
        tx,
      );
    });
    return this.getById(ctx.companyId, id);
  }

  async cancel(
    ctx: RequestContext,
    id: string,
  ): Promise<StockAdjustmentDetail> {
    const existing = await this.findScopedOrThrow(ctx.companyId, id);
    if (existing.status !== 'DRAFT')
      throw new StockAdjustmentNotDraftException();

    await this.prisma.$transaction(async (tx) => {
      await tx.stockAdjustment.update({
        where: { id },
        data: { status: 'CANCELLED' },
      });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'CANCEL',
          entityType: 'StockAdjustment',
          entityId: id,
          metadata: { number: existing.number },
        },
        tx,
      );
    });
    return this.getById(ctx.companyId, id);
  }

  private async validateLines(
    companyId: string,
    lines: { productVariantId: string; quantityDelta: string }[],
  ): Promise<void> {
    for (const line of lines) {
      const variant = await this.prisma.productVariant.findFirst({
        where: { id: line.productVariantId, product: { companyId } },
        include: { product: { include: { baseUnit: true } } },
      });
      if (!variant) throw new ProductVariantNotFoundException();
      if (!variant.product.trackInventory)
        throw new ProductDoesNotTrackInventoryException();
      if (
        exceedsDecimalPrecision(
          line.quantityDelta,
          variant.product.baseUnit.decimalPlaces,
        )
      ) {
        throw new InvalidQuantityPrecisionException(
          variant.product.baseUnit.name,
          variant.product.baseUnit.decimalPlaces,
        );
      }
    }
  }

  private async findScopedOrThrow(
    companyId: string,
    id: string,
  ): Promise<AdjustmentWithRelations> {
    const adjustment = await this.prisma.stockAdjustment.findFirst({
      where: { id, companyId },
      include: ADJUSTMENT_INCLUDE,
    });
    if (!adjustment) throw new StockAdjustmentNotFoundException();
    return adjustment;
  }

  private async resolveCreatorNames(
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

  private async nextNumber(
    tx: Prisma.TransactionClient,
    companyId: string,
  ): Promise<string> {
    const seq = await tx.stockAdjustmentSequence.upsert({
      where: { companyId },
      create: { companyId, lastValue: 1 },
      update: { lastValue: { increment: 1 } },
    });
    return `AJ-${String(seq.lastValue).padStart(6, '0')}`;
  }
}
