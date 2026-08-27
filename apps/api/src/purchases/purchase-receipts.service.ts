import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import type {
  PurchaseReceipt,
  PurchaseReceiptLine,
  ProductVariant,
  Product,
  Supplier,
  Warehouse,
  Currency,
  PurchaseOrder,
  PurchaseOrderLine,
} from '../generated/prisma/client';
import type {
  CreatePurchaseReceiptInput,
  UpdatePurchaseReceiptInput,
  PurchaseReceiptListQuery,
  PurchaseReceiptListResponse,
  PurchaseReceiptDetailDto,
  PurchaseReceiptSummaryDto,
  PurchaseReceiptLineDto,
} from '@erp/shared';
import { exceedsDecimalPrecision } from '@erp/shared';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import type { RequestContext } from '../company-context/types';
import { ProductVariantNotFoundException } from '../products/products.exceptions';
import {
  InvalidQuantityPrecisionException,
  ProductDoesNotTrackInventoryException,
} from '../inventory/inventory.exceptions';
import { CurrencyNotFoundException } from '../pricing/pricing.exceptions';
import { InventoryService } from '../inventory/inventory.service';
import { SuppliersService } from './suppliers.service';
import { PurchaseOrdersService } from './purchase-orders.service';
import {
  PurchaseReceiptNotFoundException,
  PurchaseReceiptNotEditableException,
  PurchaseReceiptAlreadyConfirmedException,
  PurchaseReceiptAlreadyCancelledException,
  PurchaseReceiptSupplierInactiveException,
  PurchaseReceiptWarehouseInvalidException,
  PurchaseReceiptCurrencyRequiredException,
  PurchaseReceiptOrderNotConfirmedException,
  PurchaseReceiptSupplierMismatchException,
  PurchaseReceiptLineNotFromOrderException,
  PurchaseOrderOverReceiptException,
} from './purchase-receipts.exceptions';

type VariantWithUnit = ProductVariant & {
  product: Product & { baseUnit: { name: string; decimalPlaces: number } };
};
type LineWithVariant = PurchaseReceiptLine & {
  variant: ProductVariant & { product: Product };
};
type ReceiptWithRelations = PurchaseReceipt & {
  supplier: Supplier;
  warehouse: Warehouse;
  currency: Currency;
  purchaseOrder: Pick<PurchaseOrder, 'id' | 'number'> | null;
  lines: LineWithVariant[];
};

interface BuiltLine {
  productVariantId: string;
  quantity: string;
  unitCostSnapshot: string;
  purchaseOrderLineId: string | null;
}

const RECEIPT_INCLUDE = {
  supplier: true,
  warehouse: true,
  currency: true,
  purchaseOrder: { select: { id: true, number: true } },
  lines: { include: { variant: { include: { product: true } } } },
} satisfies Prisma.PurchaseReceiptInclude;

function toLineDto(line: LineWithVariant): PurchaseReceiptLineDto {
  return {
    id: line.id,
    productVariantId: line.productVariantId,
    productId: line.variant.product.id,
    description: line.variant.name
      ? `${line.variant.product.name} / ${line.variant.name}`
      : line.variant.product.name,
    variantName: line.variant.name,
    sku: line.variant.sku,
    quantity: line.quantity.toString(),
    unitCostSnapshot: line.unitCostSnapshot.toString(),
    purchaseOrderLineId: line.purchaseOrderLineId,
  };
}

function toSummary(
  r: ReceiptWithRelations,
  createdByName: string | null,
): PurchaseReceiptSummaryDto {
  return {
    id: r.id,
    number: r.number,
    status: r.status,
    receiptDate: r.receiptDate.toISOString(),
    supplier: {
      id: r.supplier.id,
      code: r.supplier.code,
      legalName: r.supplier.legalName,
    },
    warehouse: {
      id: r.warehouse.id,
      code: r.warehouse.code,
      name: r.warehouse.name,
    },
    purchaseOrder: r.purchaseOrder
      ? { id: r.purchaseOrder.id, number: r.purchaseOrder.number }
      : null,
    currencyCode: r.currency.code,
    lineCount: r.lines.length,
    createdBy: r.createdBy ? { id: r.createdBy, name: createdByName } : null,
  };
}

function toDetail(
  r: ReceiptWithRelations,
  names: Map<string, string>,
): PurchaseReceiptDetailDto {
  return {
    ...toSummary(r, r.createdBy ? (names.get(r.createdBy) ?? null) : null),
    branchId: r.branchId,
    currencyId: r.currencyId,
    notes: r.notes,
    lines: r.lines.map(toLineDto),
    createdAt: r.createdAt.toISOString(),
    confirmedAt: r.confirmedAt?.toISOString() ?? null,
    confirmedBy: r.confirmedBy
      ? { id: r.confirmedBy, name: names.get(r.confirmedBy) ?? null }
      : null,
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
    cancelledBy: r.cancelledBy
      ? { id: r.cancelledBy, name: names.get(r.cancelledBy) ?? null }
      : null,
  };
}

/**
 * Goods Receipts — the ONLY Purchases document that touches stock, see
 * docs/purchases.md. Confirming creates real `PURCHASE` StockMovement rows
 * through InventoryService (never a direct balance write); cancelling a
 * CONFIRMED receipt creates a compensating `PURCHASE_RETURN` reversal — the
 * one place in this whole module where a confirmed document CAN still be
 * cancelled (see docs/purchases.md — deliberately different from
 * PurchaseOrder/SalesDocument's terminal-CONFIRMED rule, because a physical
 * receipt correction is exactly the kind of "new reversing entry" the
 * ledger philosophy is built for).
 */
@Injectable()
export class PurchaseReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly suppliersService: SuppliersService,
    private readonly purchaseOrdersService: PurchaseOrdersService,
    private readonly inventoryService: InventoryService,
    private readonly realtimePublisher: RealtimePublisher,
  ) {}

  async list(
    companyId: string,
    query: PurchaseReceiptListQuery,
  ): Promise<PurchaseReceiptListResponse> {
    const where: Prisma.PurchaseReceiptWhereInput = {
      companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.purchaseOrderId
        ? { purchaseOrderId: query.purchaseOrderId }
        : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            receiptDate: {
              ...(query.dateFrom ? { gte: query.dateFrom } : {}),
              ...(query.dateTo ? { lte: query.dateTo } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { number: { contains: query.search, mode: 'insensitive' } },
              {
                supplier: {
                  legalName: { contains: query.search, mode: 'insensitive' },
                },
              },
              {
                supplier: {
                  code: { contains: query.search, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };

    const skip = (query.page - 1) * query.pageSize;
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.purchaseReceipt.count({ where }),
      this.prisma.purchaseReceipt.findMany({
        where,
        include: RECEIPT_INCLUDE,
        orderBy: { receiptDate: 'desc' },
        skip,
        take: query.pageSize,
      }),
    ]);
    const names = await this.resolveUserNames(rows.map((r) => r.createdBy));
    return {
      items: rows.map((r) =>
        toSummary(r, r.createdBy ? (names.get(r.createdBy) ?? null) : null),
      ),
      pagination: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  async getById(
    companyId: string,
    id: string,
  ): Promise<PurchaseReceiptDetailDto> {
    const receipt = await this.findScopedOrThrow(companyId, id);
    const names = await this.resolveUserNames([
      receipt.createdBy,
      receipt.confirmedBy,
      receipt.cancelledBy,
    ]);
    return toDetail(receipt, names);
  }

  async create(
    ctx: RequestContext,
    input: CreatePurchaseReceiptInput,
  ): Promise<PurchaseReceiptDetailDto> {
    const supplier = await this.loadActiveSupplier(
      ctx.companyId,
      input.supplierId,
    );
    const warehouse = await this.loadPurchaseWarehouse(
      ctx.companyId,
      input.warehouseId,
    );
    const branchId = input.branchId ?? ctx.branchId ?? null;

    let purchaseOrder: (PurchaseOrder & { lines: PurchaseOrderLine[] }) | null =
      null;
    let currencyId: string;
    if (input.purchaseOrderId) {
      purchaseOrder = await this.loadReceivableOrder(
        ctx.companyId,
        input.purchaseOrderId,
        supplier.id,
      );
      currencyId = purchaseOrder.currencyId;
    } else {
      if (!input.currencyId)
        throw new PurchaseReceiptCurrencyRequiredException();
      currencyId = (await this.loadActiveCurrency(input.currencyId)).id;
    }

    const lines = await this.buildLines(
      ctx.companyId,
      input.lines,
      purchaseOrder?.id ?? null,
    );
    if (purchaseOrder) {
      await this.assertWithinOrderedQuantity(purchaseOrder, lines);
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const number = await this.nextNumber(tx, ctx.companyId);
      const receipt = await tx.purchaseReceipt.create({
        data: {
          tenantId: ctx.tenantId,
          companyId: ctx.companyId,
          branchId,
          number,
          supplierId: supplier.id,
          warehouseId: warehouse.id,
          purchaseOrderId: purchaseOrder?.id ?? null,
          receiptDate: input.receiptDate ?? new Date(),
          currencyId,
          notes: input.notes || null,
          createdBy: ctx.userId,
          lines: {
            create: lines.map((l) => ({
              productVariantId: l.productVariantId,
              quantity: l.quantity,
              unitCostSnapshot: l.unitCostSnapshot,
              purchaseOrderLineId: l.purchaseOrderLineId,
            })),
          },
        },
      });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'CREATE',
          entityType: 'PurchaseReceipt',
          entityId: receipt.id,
          after: {
            number: receipt.number,
            supplierId: receipt.supplierId,
            warehouseId: receipt.warehouseId,
            purchaseOrderId: receipt.purchaseOrderId,
            status: receipt.status,
          },
        },
        tx,
      );
      return receipt;
    });
    return this.getById(ctx.companyId, created.id);
  }

  async update(
    ctx: RequestContext,
    id: string,
    input: UpdatePurchaseReceiptInput,
  ): Promise<PurchaseReceiptDetailDto> {
    const existing = await this.findScopedOrThrow(ctx.companyId, id);
    if (existing.status !== 'DRAFT')
      throw new PurchaseReceiptNotEditableException();

    let warehouse = existing.warehouse;
    if (
      input.warehouseId !== undefined &&
      input.warehouseId !== existing.warehouseId
    ) {
      warehouse = await this.loadPurchaseWarehouse(
        ctx.companyId,
        input.warehouseId,
      );
    }

    let rebuiltLines: BuiltLine[] | undefined;
    if (input.lines) {
      rebuiltLines = await this.buildLines(
        ctx.companyId,
        input.lines,
        existing.purchaseOrderId,
      );
      if (existing.purchaseOrderId) {
        const purchaseOrder = await this.purchaseOrdersService.loadScopedOrder(
          ctx.companyId,
          existing.purchaseOrderId,
        );
        await this.assertWithinOrderedQuantity(purchaseOrder, rebuiltLines);
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.PurchaseReceiptUncheckedUpdateInput = {};
      if (input.warehouseId !== undefined) data.warehouseId = warehouse.id;
      if (input.receiptDate !== undefined) data.receiptDate = input.receiptDate;
      if (input.notes !== undefined) data.notes = input.notes || null;

      await tx.purchaseReceipt.update({ where: { id: existing.id }, data });

      if (rebuiltLines) {
        await tx.purchaseReceiptLine.deleteMany({
          where: { purchaseReceiptId: existing.id },
        });
        await tx.purchaseReceiptLine.createMany({
          data: rebuiltLines.map((l) => ({
            purchaseReceiptId: existing.id,
            productVariantId: l.productVariantId,
            quantity: l.quantity,
            unitCostSnapshot: l.unitCostSnapshot,
            purchaseOrderLineId: l.purchaseOrderLineId,
          })),
        });
      }

      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'UPDATE',
          entityType: 'PurchaseReceipt',
          entityId: id,
          metadata: { change: 'draft_updated' },
        },
        tx,
      );
    });
    return this.getById(ctx.companyId, id);
  }

  /**
   * Atomic and idempotent, same shape as SalesService.confirm — see
   * docs/purchases.md. The one Purchases operation that calls
   * InventoryService. When the receipt references a PurchaseOrder, the
   * over-receipt guard below is the AUTHORITATIVE concurrency protection
   * (see docs/purchases.md's "Concurrency" section) — the check in
   * create()/update() is only an early, non-atomic UX hint.
   */
  async confirm(
    ctx: RequestContext,
    id: string,
  ): Promise<PurchaseReceiptDetailDto> {
    const existing = await this.findScopedOrThrow(ctx.companyId, id);
    if (existing.status === 'CONFIRMED')
      throw new PurchaseReceiptAlreadyConfirmedException();
    if (existing.status !== 'DRAFT')
      throw new PurchaseReceiptNotEditableException();

    const stockChanges: { warehouseId: string; productVariantId: string }[] =
      [];
    await this.prisma.$transaction(async (tx) => {
      const guarded = await tx.purchaseReceipt.updateMany({
        where: { id, status: 'DRAFT' },
        data: {
          status: 'CONFIRMED',
          confirmedAt: new Date(),
          confirmedBy: ctx.userId,
        },
      });
      if (guarded.count === 0)
        throw new PurchaseReceiptAlreadyConfirmedException();

      if (existing.purchaseOrderId) {
        await this.assertWithinOrderedQuantityLocked(
          tx,
          existing.purchaseOrderId,
          existing.lines,
        );
      }

      for (const line of existing.lines) {
        const movement = await this.inventoryService.applyPurchaseReceiptLine(
          tx,
          ctx,
          {
            warehouse: existing.warehouse,
            productVariantId: line.productVariantId,
            quantity: line.quantity.toString(),
            unitCost: line.unitCostSnapshot.toString(),
            currencyId: existing.currencyId,
            referenceType: 'PurchaseReceipt',
            referenceId: existing.id,
            occurredAt: existing.receiptDate,
          },
        );
        stockChanges.push({
          warehouseId: movement.warehouseId,
          productVariantId: movement.productVariantId,
        });
      }

      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'CONFIRM',
          entityType: 'PurchaseReceipt',
          entityId: id,
          metadata: {
            change: 'purchase_receipt_confirmed',
            number: existing.number,
            supplierName: existing.supplier.legalName,
            warehouseName: existing.warehouse.name,
            lineCount: existing.lines.length,
          },
        },
        tx,
      );
    });

    // Only reachable once the transaction above has committed — see
    // docs/desktop-lan-architecture.md's "Realtime architecture".
    this.realtimePublisher.purchaseReceiptConfirmed(ctx.companyId, id);
    for (const change of stockChanges) {
      this.realtimePublisher.stockChanged(
        ctx.companyId,
        change.warehouseId,
        change.productVariantId,
      );
    }
    return this.getById(ctx.companyId, id);
  }

  /**
   * DRAFT -> CANCELLED has zero inventory effect. CONFIRMED -> CANCELLED
   * creates a compensating PURCHASE_RETURN reversal for every line — see
   * docs/purchases.md and the class doc comment above. Both paths use the
   * same conditional-update-first idempotency guard as confirm(), so a
   * retried or concurrent double-cancel never reverses stock twice.
   */
  async cancel(
    ctx: RequestContext,
    id: string,
  ): Promise<PurchaseReceiptDetailDto> {
    const existing = await this.findScopedOrThrow(ctx.companyId, id);
    if (existing.status === 'CANCELLED')
      throw new PurchaseReceiptAlreadyCancelledException();

    if (existing.status === 'DRAFT') {
      await this.prisma.$transaction(async (tx) => {
        const guarded = await tx.purchaseReceipt.updateMany({
          where: { id, status: 'DRAFT' },
          data: {
            status: 'CANCELLED',
            cancelledAt: new Date(),
            cancelledBy: ctx.userId,
          },
        });
        if (guarded.count === 0)
          throw new PurchaseReceiptAlreadyCancelledException();
        await this.auditService.recordFromContext(
          ctx,
          {
            action: 'CANCEL',
            entityType: 'PurchaseReceipt',
            entityId: id,
            metadata: { change: 'draft_cancelled', number: existing.number },
          },
          tx,
        );
      });
      this.realtimePublisher.purchaseReceiptCancelled(ctx.companyId, id);
      return this.getById(ctx.companyId, id);
    }

    // existing.status === 'CONFIRMED' — the only other non-terminal state.
    const stockChanges: { warehouseId: string; productVariantId: string }[] =
      [];
    await this.prisma.$transaction(async (tx) => {
      const guarded = await tx.purchaseReceipt.updateMany({
        where: { id, status: 'CONFIRMED' },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledBy: ctx.userId,
        },
      });
      if (guarded.count === 0)
        throw new PurchaseReceiptAlreadyCancelledException();

      for (const line of existing.lines) {
        const movement = await this.inventoryService.reversePurchaseReceiptLine(
          tx,
          ctx,
          {
            warehouse: existing.warehouse,
            productVariantId: line.productVariantId,
            quantity: line.quantity.toString(),
            unitCost: line.unitCostSnapshot.toString(),
            currencyId: existing.currencyId,
            referenceType: 'PurchaseReceipt',
            referenceId: existing.id,
            occurredAt: new Date(),
          },
        );
        stockChanges.push({
          warehouseId: movement.warehouseId,
          productVariantId: movement.productVariantId,
        });
      }

      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'CANCEL',
          entityType: 'PurchaseReceipt',
          entityId: id,
          metadata: {
            change: 'confirmed_receipt_cancelled',
            number: existing.number,
            reversedLineCount: existing.lines.length,
          },
        },
        tx,
      );
    });

    this.realtimePublisher.purchaseReceiptCancelled(ctx.companyId, id);
    for (const change of stockChanges) {
      this.realtimePublisher.stockChanged(
        ctx.companyId,
        change.warehouseId,
        change.productVariantId,
      );
    }
    return this.getById(ctx.companyId, id);
  }

  // ---------- Internal helpers ----------

  private async loadActiveSupplier(
    companyId: string,
    id: string,
  ): Promise<Supplier> {
    const supplier = await this.suppliersService.loadScoped(companyId, id);
    if (supplier.status !== 'ACTIVE') {
      throw new PurchaseReceiptSupplierInactiveException();
    }
    return supplier;
  }

  private async loadPurchaseWarehouse(
    companyId: string,
    warehouseId: string,
  ): Promise<Warehouse> {
    const warehouse = await this.inventoryService.loadWarehouse(
      companyId,
      warehouseId,
    );
    if (warehouse.status !== 'ACTIVE' || !warehouse.allowsPurchases) {
      throw new PurchaseReceiptWarehouseInvalidException();
    }
    return warehouse;
  }

  private async loadActiveCurrency(id: string): Promise<Currency> {
    const currency = await this.prisma.currency.findFirst({
      where: { id, active: true },
    });
    if (!currency) throw new CurrencyNotFoundException();
    return currency;
  }

  /** Must be CONFIRMED and belong to the same supplier as the receipt — see docs/purchases.md. */
  private async loadReceivableOrder(
    companyId: string,
    purchaseOrderId: string,
    supplierId: string,
  ): Promise<PurchaseOrder & { lines: PurchaseOrderLine[] }> {
    const order = await this.purchaseOrdersService.loadScopedOrder(
      companyId,
      purchaseOrderId,
    );
    if (order.status !== 'CONFIRMED') {
      throw new PurchaseReceiptOrderNotConfirmedException();
    }
    if (order.supplierId !== supplierId) {
      throw new PurchaseReceiptSupplierMismatchException();
    }
    return order;
  }

  private async loadVariantWithUnit(
    companyId: string,
    id: string,
  ): Promise<VariantWithUnit> {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id, product: { companyId } },
      include: { product: { include: { baseUnit: true } } },
    });
    if (!variant) throw new ProductVariantNotFoundException();
    return variant;
  }

  /**
   * `purchaseOrderId` mirrors the create schema's `linesMatchPurchaseOrderRefine`
   * superRefine (see packages/shared/src/purchase-receipts.ts) — enforced
   * here in the service too because `updatePurchaseReceiptSchema` has no
   * such refine of its own (a receipt's `purchaseOrderId` is immutable
   * after creation, so the update schema doesn't even carry the field);
   * both call sites pass the receipt's actual (fixed) purchaseOrderId.
   */
  private async buildLines(
    companyId: string,
    inputLines: {
      productVariantId: string;
      quantity: string;
      unitCostSnapshot: string;
      purchaseOrderLineId?: string;
    }[],
    purchaseOrderId: string | null,
  ): Promise<BuiltLine[]> {
    const hasOrder = !!purchaseOrderId;
    const built: BuiltLine[] = [];
    for (const line of inputLines) {
      if (hasOrder !== !!line.purchaseOrderLineId) {
        throw new PurchaseReceiptLineNotFromOrderException();
      }
      const variant = await this.loadVariantWithUnit(
        companyId,
        line.productVariantId,
      );
      if (!variant.product.trackInventory) {
        throw new ProductDoesNotTrackInventoryException();
      }
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
      built.push({
        productVariantId: variant.id,
        quantity: line.quantity,
        unitCostSnapshot: line.unitCostSnapshot,
        purchaseOrderLineId: line.purchaseOrderLineId ?? null,
      });
    }
    return built;
  }

  /**
   * Advisory (non-atomic) over-receipt check for create()/update() — good
   * UX, but NOT the concurrency guarantee (see
   * assertWithinOrderedQuantityLocked for that). Only CONFIRMED receipt
   * lines count toward "already received" (see receivedQuantitiesByLine),
   * so a DRAFT receipt — including the one being edited here — never
   * counts against itself.
   */
  private async assertWithinOrderedQuantity(
    purchaseOrder: PurchaseOrder & { lines: PurchaseOrderLine[] },
    lines: BuiltLine[],
  ): Promise<void> {
    const orderLineById = new Map(purchaseOrder.lines.map((l) => [l.id, l]));
    const requestedByLineId = new Map<string, Prisma.Decimal>();
    for (const line of lines) {
      const polId = line.purchaseOrderLineId;
      if (!polId) continue;
      const orderLine = orderLineById.get(polId);
      if (!orderLine || orderLine.productVariantId !== line.productVariantId) {
        throw new PurchaseReceiptLineNotFromOrderException();
      }
      requestedByLineId.set(
        polId,
        (requestedByLineId.get(polId) ?? new Prisma.Decimal(0)).add(
          line.quantity,
        ),
      );
    }
    if (requestedByLineId.size === 0) return;
    const receivedByLineId =
      await this.purchaseOrdersService.receivedQuantitiesByLine([
        ...requestedByLineId.keys(),
      ]);
    for (const [polId, requested] of requestedByLineId) {
      const orderLine = orderLineById.get(polId)!;
      const received = receivedByLineId.get(polId) ?? new Prisma.Decimal(0);
      const pending = new Prisma.Decimal(orderLine.quantity).sub(received);
      if (requested.gt(pending)) throw new PurchaseOrderOverReceiptException();
    }
  }

  /**
   * THE authoritative concurrency guard — see docs/purchases.md's
   * "Concurrency" section. `SELECT ... FOR UPDATE` locks the referenced
   * PurchaseOrderLine rows for the remainder of this transaction; Postgres
   * blocks any other transaction's own `FOR UPDATE` on the same rows until
   * this one commits or rolls back, so two concurrent confirms racing for
   * the same order line are fully serialized — the second one re-reads the
   * CONFIRMED-lines sum (now including whatever the first one just
   * committed) before deciding, never a stale read. Runs AFTER this
   * receipt's own DRAFT->CONFIRMED guard has already flipped its status,
   * so the sum below correctly includes this receipt's own lines.
   */
  private async assertWithinOrderedQuantityLocked(
    tx: Prisma.TransactionClient,
    purchaseOrderId: string,
    lines: LineWithVariant[],
  ): Promise<void> {
    const lineIds = [
      ...new Set(
        lines.map((l) => l.purchaseOrderLineId).filter((v): v is string => !!v),
      ),
    ];
    if (lineIds.length === 0) return;

    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM purchase_order_lines WHERE id IN (${Prisma.join(lineIds)}) FOR UPDATE`,
    );

    const orderLines = await tx.purchaseOrderLine.findMany({
      where: { id: { in: lineIds }, purchaseOrderId },
    });
    const sums = await tx.purchaseReceiptLine.groupBy({
      by: ['purchaseOrderLineId'],
      where: {
        purchaseOrderLineId: { in: lineIds },
        purchaseReceipt: { status: 'CONFIRMED' },
      },
      _sum: { quantity: true },
    });
    const sumByLine = new Map(
      sums.map((s) => [
        s.purchaseOrderLineId as string,
        s._sum.quantity ?? new Prisma.Decimal(0),
      ]),
    );
    for (const orderLine of orderLines) {
      const received = sumByLine.get(orderLine.id) ?? new Prisma.Decimal(0);
      if (received.gt(orderLine.quantity)) {
        throw new PurchaseOrderOverReceiptException();
      }
    }
  }

  private async findScopedOrThrow(
    companyId: string,
    id: string,
  ): Promise<ReceiptWithRelations> {
    const receipt = await this.prisma.purchaseReceipt.findFirst({
      where: { id, companyId },
      include: RECEIPT_INCLUDE,
    });
    if (!receipt) throw new PurchaseReceiptNotFoundException();
    return receipt;
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

  private async nextNumber(
    tx: Prisma.TransactionClient,
    companyId: string,
  ): Promise<string> {
    const seq = await tx.purchaseReceiptSequence.upsert({
      where: { companyId },
      create: { companyId, lastValue: 1 },
      update: { lastValue: { increment: 1 } },
    });
    return `RC-${String(seq.lastValue).padStart(6, '0')}`;
  }
}
