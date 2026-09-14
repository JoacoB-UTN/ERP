import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import type {
  StockTransfer,
  StockTransferLine,
  ProductVariant,
  Product,
  Warehouse,
} from '../generated/prisma/client';
import type {
  CreateStockTransferInput,
  UpdateStockTransferInput,
  StockTransferListQuery,
  StockTransferListResponse,
  StockTransferDetail,
  StockTransferSummary,
  StockTransferLineDto,
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
  StockTransferNotFoundException,
  StockTransferNotDraftException,
  StockTransferAlreadyConfirmedException,
  StockTransferNotCancellableException,
  StockTransferSameWarehouseException,
} from './inventory.exceptions';
import { InventoryService } from './inventory.service';
import { RealtimePublisher } from '../realtime/realtime.publisher';

type LineWithVariant = StockTransferLine & {
  variant: ProductVariant & { product: Product };
};
type TransferWithRelations = StockTransfer & {
  sourceWarehouse: Warehouse;
  destinationWarehouse: Warehouse;
  lines: LineWithVariant[];
};

const TRANSFER_INCLUDE = {
  sourceWarehouse: true,
  destinationWarehouse: true,
  lines: { include: { variant: { include: { product: true } } } },
} satisfies Prisma.StockTransferInclude;

function toLineDto(line: LineWithVariant): StockTransferLineDto {
  return {
    id: line.id,
    productVariantId: line.productVariantId,
    productId: line.variant.product.id,
    productName: line.variant.product.name,
    variantName: line.variant.name,
    sku: line.variant.sku,
    quantity: line.quantity.toString(),
    notes: line.notes,
  };
}

function toSummary(
  t: TransferWithRelations,
  createdByName: string | null,
): StockTransferSummary {
  return {
    id: t.id,
    number: t.number,
    sourceWarehouseId: t.sourceWarehouseId,
    sourceWarehouseName: t.sourceWarehouse.name,
    destinationWarehouseId: t.destinationWarehouseId,
    destinationWarehouseName: t.destinationWarehouse.name,
    reason: t.reason,
    status: t.status,
    occurredAt: t.occurredAt.toISOString(),
    lineCount: t.lines.length,
    createdBy: t.createdBy ? { id: t.createdBy, name: createdByName } : null,
  };
}

function toDetail(
  t: TransferWithRelations,
  createdByName: string | null,
): StockTransferDetail {
  return {
    ...toSummary(t, createdByName),
    notes: t.notes,
    lines: t.lines.map(toLineDto),
    createdAt: t.createdAt.toISOString(),
    confirmedAt: t.confirmedAt?.toISOString() ?? null,
    cancelledAt: t.cancelledAt?.toISOString() ?? null,
  };
}

/**
 * Moving stock between two warehouses of the same company — see
 * docs/inventory.md.
 *
 * Same shape as StockAdjustmentsService, and deliberately so: a DRAFT
 * moves nothing and can be edited; only `confirm()` writes to the ledger,
 * in one transaction. Two differences worth knowing:
 *
 * - **Every confirmed line is two movements**, a `TRANSFER_OUT` from the
 *   source and an equal `TRANSFER_IN` into the destination, written by
 *   `InventoryService.applyTransferLine` inside the same transaction. They
 *   cannot exist apart.
 * - **A CONFIRMED transfer can be cancelled**, unlike an adjustment. That
 *   posts compensating movements — the same pair with the warehouses
 *   swapped — and never edits or deletes the originals, which is the
 *   ledger rule in CLAUDE.md.
 */
@Injectable()
export class StockTransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly inventoryService: InventoryService,
    private readonly realtimePublisher: RealtimePublisher,
  ) {}

  async list(
    companyId: string,
    query: StockTransferListQuery,
  ): Promise<StockTransferListResponse> {
    const where: Prisma.StockTransferWhereInput = {
      companyId,
      // One filter, either end: "show me everything that touched this
      // warehouse" is the question an operator actually asks, and a
      // transfer is equally theirs whether stock left or arrived.
      ...(query.warehouseId
        ? {
            OR: [
              { sourceWarehouseId: query.warehouseId },
              { destinationWarehouseId: query.warehouseId },
            ],
          }
        : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const skip = (query.page - 1) * query.pageSize;
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.stockTransfer.count({ where }),
      this.prisma.stockTransfer.findMany({
        where,
        include: TRANSFER_INCLUDE,
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

  async getById(companyId: string, id: string): Promise<StockTransferDetail> {
    const transfer = await this.findScopedOrThrow(companyId, id);
    const names = await this.resolveCreatorNames([transfer.createdBy]);
    return toDetail(
      transfer,
      transfer.createdBy ? (names.get(transfer.createdBy) ?? null) : null,
    );
  }

  async create(
    ctx: RequestContext,
    input: CreateStockTransferInput,
  ): Promise<StockTransferDetail> {
    const { source, destination } = await this.resolveWarehouses(
      ctx.companyId,
      input.sourceWarehouseId,
      input.destinationWarehouseId,
    );

    const combined = this.combineLines(input.lines);
    await this.validateLines(ctx.companyId, combined);

    const occurredAt = input.occurredAt ?? new Date();

    const created = await this.prisma.$transaction(async (tx) => {
      const number = await this.nextNumber(tx, ctx.companyId);
      const transfer = await tx.stockTransfer.create({
        data: {
          tenantId: ctx.tenantId,
          companyId: ctx.companyId,
          branchId: ctx.branchId ?? null,
          sourceWarehouseId: source.id,
          destinationWarehouseId: destination.id,
          number,
          reason: input.reason || null,
          notes: input.notes || null,
          occurredAt,
          createdBy: ctx.userId,
          lines: {
            create: combined.map((l) => ({
              productVariantId: l.productVariantId,
              quantity: l.quantity,
              notes: l.notes || null,
            })),
          },
        },
      });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'CREATE',
          entityType: 'StockTransfer',
          entityId: transfer.id,
          after: {
            number: transfer.number,
            sourceWarehouse: source.name,
            destinationWarehouse: destination.name,
            status: transfer.status,
          },
        },
        tx,
      );
      return transfer;
    });
    return this.getById(ctx.companyId, created.id);
  }

  async update(
    ctx: RequestContext,
    id: string,
    input: UpdateStockTransferInput,
  ): Promise<StockTransferDetail> {
    const existing = await this.findScopedOrThrow(ctx.companyId, id);
    if (existing.status !== 'DRAFT') throw new StockTransferNotDraftException();

    // Resolved against the MERGED pair, not the incoming fields alone:
    // changing only the destination to whatever the source already is has
    // to be rejected just as firmly as sending both equal.
    const { source, destination } = await this.resolveWarehouses(
      ctx.companyId,
      input.sourceWarehouseId ?? existing.sourceWarehouseId,
      input.destinationWarehouseId ?? existing.destinationWarehouseId,
    );

    const combined = input.lines ? this.combineLines(input.lines) : undefined;
    if (combined) await this.validateLines(ctx.companyId, combined);

    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.StockTransferUncheckedUpdateInput = {};
      if (input.sourceWarehouseId !== undefined)
        data.sourceWarehouseId = source.id;
      if (input.destinationWarehouseId !== undefined)
        data.destinationWarehouseId = destination.id;
      if (input.reason !== undefined) data.reason = input.reason || null;
      if (input.notes !== undefined) data.notes = input.notes || null;
      if (input.occurredAt !== undefined) data.occurredAt = input.occurredAt;

      await tx.stockTransfer.update({ where: { id: existing.id }, data });

      if (combined) {
        await tx.stockTransferLine.deleteMany({
          where: { stockTransferId: existing.id },
        });
        await tx.stockTransferLine.createMany({
          data: combined.map((l) => ({
            stockTransferId: existing.id,
            productVariantId: l.productVariantId,
            quantity: l.quantity,
            notes: l.notes || null,
          })),
        });
      }

      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'UPDATE',
          entityType: 'StockTransfer',
          entityId: id,
          metadata: { change: 'draft_updated' },
        },
        tx,
      );
    });
    return this.getById(ctx.companyId, id);
  }

  /**
   * Writes both halves of every line and flips the status, atomically.
   *
   * The transaction opens with a CONDITIONAL update (`WHERE status =
   * 'DRAFT'`) rather than a read-then-write: two requests confirming the
   * same transfer race on that single row, exactly one wins, and the loser
   * is rejected before it can write a movement. A prior `findFirst` check
   * would leave a window in which both callers saw DRAFT.
   *
   * Two transfers competing for the same stock are handled one layer down:
   * `applyMovement` increments the balance row and validates the value
   * Postgres actually returned, inside this transaction, so the writers
   * serialise on that row and the second one sees the decremented figure
   * and rolls back with INSUFFICIENT_STOCK.
   */
  async confirm(ctx: RequestContext, id: string): Promise<StockTransferDetail> {
    const existing = await this.findScopedOrThrow(ctx.companyId, id);
    if (existing.status !== 'DRAFT') throw new StockTransferNotDraftException();

    const stockChanges: { warehouseId: string; productVariantId: string }[] =
      [];
    await this.prisma.$transaction(async (tx) => {
      const guarded = await tx.stockTransfer.updateMany({
        where: { id, companyId: ctx.companyId, status: 'DRAFT' },
        data: {
          status: 'CONFIRMED',
          confirmedAt: new Date(),
          confirmedBy: ctx.userId,
        },
      });
      if (guarded.count === 0)
        throw new StockTransferAlreadyConfirmedException();

      for (const line of existing.lines) {
        const movements = await this.inventoryService.applyTransferLine(
          tx,
          ctx,
          {
            sourceWarehouse: existing.sourceWarehouse,
            destinationWarehouse: existing.destinationWarehouse,
            productVariantId: line.productVariantId,
            quantity: line.quantity.toString(),
            reason: line.notes ?? existing.reason ?? undefined,
            referenceType: 'StockTransfer',
            referenceId: existing.id,
            occurredAt: existing.occurredAt,
          },
        );
        stockChanges.push(
          {
            warehouseId: movements.out.warehouseId,
            productVariantId: movements.out.productVariantId,
          },
          {
            warehouseId: movements.in.warehouseId,
            productVariantId: movements.in.productVariantId,
          },
        );
      }

      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'CONFIRM',
          entityType: 'StockTransfer',
          entityId: id,
          metadata: {
            change: 'transfer_confirmed',
            number: existing.number,
            sourceWarehouse: existing.sourceWarehouse.name,
            destinationWarehouse: existing.destinationWarehouse.name,
            lines: existing.lines.map((l) => ({
              productName: l.variant.product.name,
              variantName: l.variant.name,
              quantity: l.quantity.toString(),
            })),
          },
        },
        tx,
      );
    });

    // Only after the commit — see SalesService.confirm() for the same rule.
    this.publishStockChanges(ctx.companyId, stockChanges);
    return this.getById(ctx.companyId, id);
  }

  /**
   * A DRAFT is cancelled without touching the ledger. A CONFIRMED transfer
   * is cancelled by posting the compensating pair — the same movements
   * with source and destination swapped — leaving the originals exactly as
   * they were written. Nothing is ever edited or deleted.
   *
   * The same conditional-update guard as `confirm()` makes a double
   * cancellation impossible: the second caller matches zero rows.
   */
  async cancel(ctx: RequestContext, id: string): Promise<StockTransferDetail> {
    const existing = await this.findScopedOrThrow(ctx.companyId, id);
    if (existing.status === 'CANCELLED')
      throw new StockTransferNotCancellableException();

    const wasConfirmed = existing.status === 'CONFIRMED';
    const stockChanges: { warehouseId: string; productVariantId: string }[] =
      [];

    await this.prisma.$transaction(async (tx) => {
      const guarded = await tx.stockTransfer.updateMany({
        where: {
          id,
          companyId: ctx.companyId,
          status: wasConfirmed ? 'CONFIRMED' : 'DRAFT',
        },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledBy: ctx.userId,
        },
      });
      if (guarded.count === 0)
        throw new StockTransferNotCancellableException();

      if (wasConfirmed) {
        for (const line of existing.lines) {
          const movements = await this.inventoryService.applyTransferLine(
            tx,
            ctx,
            {
              // Swapped on purpose: the compensation is the original
              // transfer, backwards.
              sourceWarehouse: existing.destinationWarehouse,
              destinationWarehouse: existing.sourceWarehouse,
              productVariantId: line.productVariantId,
              quantity: line.quantity.toString(),
              reason: `Anulación de ${existing.number}`,
              referenceType: 'StockTransfer',
              referenceId: existing.id,
              occurredAt: new Date(),
            },
          );
          stockChanges.push(
            {
              warehouseId: movements.out.warehouseId,
              productVariantId: movements.out.productVariantId,
            },
            {
              warehouseId: movements.in.warehouseId,
              productVariantId: movements.in.productVariantId,
            },
          );
        }
      }

      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'CANCEL',
          entityType: 'StockTransfer',
          entityId: id,
          metadata: {
            number: existing.number,
            // The distinction a reader of the audit log needs: whether
            // this cancellation moved stock or merely discarded a draft.
            compensated: wasConfirmed,
          },
        },
        tx,
      );
    });

    this.publishStockChanges(ctx.companyId, stockChanges);
    return this.getById(ctx.companyId, id);
  }

  private publishStockChanges(
    companyId: string,
    changes: { warehouseId: string; productVariantId: string }[],
  ): void {
    for (const change of changes) {
      this.realtimePublisher.stockChanged(
        companyId,
        change.warehouseId,
        change.productVariantId,
      );
    }
  }

  /**
   * Both warehouses in one place, so the two rules that make a transfer a
   * transfer are enforced together: each must belong to the caller's
   * company, and they must differ.
   */
  private async resolveWarehouses(
    companyId: string,
    sourceWarehouseId: string,
    destinationWarehouseId: string,
  ): Promise<{ source: Warehouse; destination: Warehouse }> {
    if (sourceWarehouseId === destinationWarehouseId)
      throw new StockTransferSameWarehouseException();

    const [source, destination] = await Promise.all([
      this.prisma.warehouse.findFirst({
        where: { id: sourceWarehouseId, companyId },
      }),
      this.prisma.warehouse.findFirst({
        where: { id: destinationWarehouseId, companyId },
      }),
    ]);
    // A warehouse from another company reads as "not found", never as
    // "not yours" — see CLAUDE.md's company-scoping rule.
    if (!source || !destination) throw new WarehouseNotFoundException();
    return { source, destination };
  }

  /**
   * Sums duplicate variant lines, through the same helper adjustments use
   * so the documented duplicate-line rule has one implementation. Transfer
   * lines carry `quantity`/`notes` where an adjustment carries
   * `quantityDelta`/`reason`; the shapes are mapped around the call rather
   * than the summing being written a second time.
   */
  private combineLines(
    lines: { productVariantId: string; quantity: string; notes?: string }[],
  ): { productVariantId: string; quantity: string; notes?: string }[] {
    return this.inventoryService
      .combineDeltaLines(
        lines.map((l) => ({
          productVariantId: l.productVariantId,
          quantityDelta: l.quantity,
          reason: l.notes,
        })),
      )
      .map((l) => ({
        productVariantId: l.productVariantId,
        quantity: l.quantityDelta,
        notes: l.reason,
      }));
  }

  private async validateLines(
    companyId: string,
    lines: { productVariantId: string; quantity: string }[],
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
          line.quantity,
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
  ): Promise<TransferWithRelations> {
    const transfer = await this.prisma.stockTransfer.findFirst({
      where: { id, companyId },
      include: TRANSFER_INCLUDE,
    });
    if (!transfer) throw new StockTransferNotFoundException();
    return transfer;
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
    const seq = await tx.stockTransferSequence.upsert({
      where: { companyId },
      create: { companyId, lastValue: 1 },
      update: { lastValue: { increment: 1 } },
    });
    return `TR-${String(seq.lastValue).padStart(6, '0')}`;
  }
}
