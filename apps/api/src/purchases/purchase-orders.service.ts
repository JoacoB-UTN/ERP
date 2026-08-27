import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import type {
  PurchaseOrder,
  PurchaseOrderLine,
  ProductVariant,
  Product,
  Supplier,
  Branch,
  Currency,
} from '../generated/prisma/client';
import type {
  CreatePurchaseOrderInput,
  UpdatePurchaseOrderInput,
  PurchaseOrderListQuery,
  PurchaseOrderListResponse,
  PurchaseOrderDetailDto,
  PurchaseOrderSummaryDto,
  PurchaseOrderLineDto,
} from '@erp/shared';
import { exceedsDecimalPrecision } from '@erp/shared';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import type { RequestContext } from '../company-context/types';
import { ProductVariantNotFoundException } from '../products/products.exceptions';
import { InvalidQuantityPrecisionException } from '../inventory/inventory.exceptions';
import { CurrencyNotFoundException } from '../pricing/pricing.exceptions';
import { SuppliersService } from './suppliers.service';
import {
  PurchaseOrderNotFoundException,
  PurchaseOrderNotEditableException,
  PurchaseOrderAlreadyConfirmedException,
  PurchaseOrderSupplierInactiveException,
  PurchaseOrderInvalidBranchException,
} from './purchase-orders.exceptions';

type VariantWithUnit = ProductVariant & {
  product: Product & { baseUnit: { name: string; decimalPlaces: number } };
};
type LineWithVariant = PurchaseOrderLine & {
  variant: ProductVariant & { product: Product };
};
type ReceiptSummary = {
  id: string;
  number: string;
  status: string;
  receiptDate: Date;
};
type OrderWithRelations = PurchaseOrder & {
  supplier: Supplier;
  branch: Branch | null;
  currency: Currency;
  lines: LineWithVariant[];
  purchaseReceipts: ReceiptSummary[];
};

interface BuiltLine {
  productVariantId: string;
  quantity: string;
  unitCost: string;
  lineTotal: string;
}

const ORDER_INCLUDE = {
  supplier: true,
  branch: true,
  currency: true,
  lines: { include: { variant: { include: { product: true } } } },
  purchaseReceipts: {
    select: { id: true, number: true, status: true, receiptDate: true },
  },
} satisfies Prisma.PurchaseOrderInclude;

/** Decimal-safe — quantity * unitCost, rounded to 4 places like every other money total in this codebase. */
function computeLineTotal(quantity: string, unitCost: string): string {
  return new Prisma.Decimal(quantity)
    .mul(unitCost)
    .toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP)
    .toString();
}

function computeOrderTotal(lines: BuiltLine[]): string {
  let total = new Prisma.Decimal(0);
  for (const line of lines) total = total.add(line.lineTotal);
  return total.toString();
}

/**
 * receivedQuantity/pendingQuantity are derived at read time from confirmed
 * PurchaseReceiptLine history (see docs/purchases.md) — never a stored
 * mutable counter. `receivedByLineId` is pre-aggregated by the caller
 * (one query per detail load, not N+1 per line).
 */
function toLineDto(
  line: LineWithVariant,
  receivedByLineId: Map<string, Prisma.Decimal>,
): PurchaseOrderLineDto {
  const received = receivedByLineId.get(line.id) ?? new Prisma.Decimal(0);
  const pending = Prisma.Decimal.max(
    new Prisma.Decimal(line.quantity).sub(received),
    0,
  );
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
    unitCost: line.unitCost.toString(),
    lineTotal: line.lineTotal.toString(),
    receivedQuantity: received.toString(),
    pendingQuantity: pending.toString(),
  };
}

function toSummary(
  o: OrderWithRelations,
  createdByName: string | null,
): PurchaseOrderSummaryDto {
  return {
    id: o.id,
    number: o.number,
    status: o.status,
    orderDate: o.orderDate.toISOString(),
    expectedDeliveryDate: o.expectedDeliveryDate?.toISOString() ?? null,
    supplier: {
      id: o.supplier.id,
      code: o.supplier.code,
      legalName: o.supplier.legalName,
    },
    branch: o.branch
      ? { id: o.branch.id, code: o.branch.code, name: o.branch.name }
      : null,
    currencyCode: o.currency.code,
    total: o.total.toString(),
    lineCount: o.lines.length,
    createdBy: o.createdBy ? { id: o.createdBy, name: createdByName } : null,
  };
}

function toDetail(
  o: OrderWithRelations,
  receivedByLineId: Map<string, Prisma.Decimal>,
  names: Map<string, string>,
): PurchaseOrderDetailDto {
  return {
    ...toSummary(o, o.createdBy ? (names.get(o.createdBy) ?? null) : null),
    currencyId: o.currencyId,
    notes: o.notes,
    lines: o.lines.map((l) => toLineDto(l, receivedByLineId)),
    receipts: o.purchaseReceipts.map((r) => ({
      id: r.id,
      number: r.number,
      status: r.status,
      receiptDate: r.receiptDate.toISOString(),
    })),
    createdAt: o.createdAt.toISOString(),
    confirmedAt: o.confirmedAt?.toISOString() ?? null,
    confirmedBy: o.confirmedBy
      ? { id: o.confirmedBy, name: names.get(o.confirmedBy) ?? null }
      : null,
    cancelledAt: o.cancelledAt?.toISOString() ?? null,
    cancelledBy: o.cancelledBy
      ? { id: o.cancelledBy, name: names.get(o.cancelledBy) ?? null }
      : null,
  };
}

/**
 * Purchase Orders — commercial intent only, see docs/purchases.md.
 * `confirm()` is a pure status transition: it NEVER touches
 * InventoryService/StockMovement, unlike SalesService.confirm. Physical
 * receipt is exclusively PurchaseReceiptsService's responsibility.
 */
@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly suppliersService: SuppliersService,
    private readonly realtimePublisher: RealtimePublisher,
  ) {}

  async list(
    companyId: string,
    query: PurchaseOrderListQuery,
  ): Promise<PurchaseOrderListResponse> {
    const where: Prisma.PurchaseOrderWhereInput = {
      companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            orderDate: {
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
      this.prisma.purchaseOrder.count({ where }),
      this.prisma.purchaseOrder.findMany({
        where,
        include: ORDER_INCLUDE,
        orderBy: { orderDate: 'desc' },
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
  ): Promise<PurchaseOrderDetailDto> {
    const order = await this.findScopedOrThrow(companyId, id);
    const [receivedByLineId, names] = await Promise.all([
      this.receivedQuantitiesByLine(order.lines.map((l) => l.id)),
      this.resolveUserNames([
        order.createdBy,
        order.confirmedBy,
        order.cancelledBy,
      ]),
    ]);
    return toDetail(order, receivedByLineId, names);
  }

  async create(
    ctx: RequestContext,
    input: CreatePurchaseOrderInput,
  ): Promise<PurchaseOrderDetailDto> {
    const supplier = await this.loadActiveSupplier(
      ctx.companyId,
      input.supplierId,
    );
    const currency = await this.loadActiveCurrency(input.currencyId);
    if (input.branchId) {
      await this.assertBranchBelongsToCompany(ctx.companyId, input.branchId);
    }
    const branchId = input.branchId ?? ctx.branchId ?? null;
    const lines = await this.buildLines(ctx.companyId, input.lines);
    const total = computeOrderTotal(lines);

    const created = await this.prisma.$transaction(async (tx) => {
      const number = await this.nextNumber(tx, ctx.companyId);
      const order = await tx.purchaseOrder.create({
        data: {
          tenantId: ctx.tenantId,
          companyId: ctx.companyId,
          branchId,
          number,
          supplierId: supplier.id,
          orderDate: input.orderDate ?? new Date(),
          expectedDeliveryDate: input.expectedDeliveryDate ?? null,
          currencyId: currency.id,
          notes: input.notes || null,
          createdBy: ctx.userId,
          total,
          lines: {
            create: lines.map((l) => ({
              productVariantId: l.productVariantId,
              quantity: l.quantity,
              unitCost: l.unitCost,
              lineTotal: l.lineTotal,
            })),
          },
        },
      });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'CREATE',
          entityType: 'PurchaseOrder',
          entityId: order.id,
          after: {
            number: order.number,
            supplierId: order.supplierId,
            total: order.total.toString(),
            status: order.status,
          },
        },
        tx,
      );
      return order;
    });
    return this.getById(ctx.companyId, created.id);
  }

  async update(
    ctx: RequestContext,
    id: string,
    input: UpdatePurchaseOrderInput,
  ): Promise<PurchaseOrderDetailDto> {
    const existing = await this.findScopedOrThrow(ctx.companyId, id);
    if (existing.status !== 'DRAFT')
      throw new PurchaseOrderNotEditableException();

    let supplier = existing.supplier;
    if (
      input.supplierId !== undefined &&
      input.supplierId !== existing.supplierId
    ) {
      supplier = await this.loadActiveSupplier(ctx.companyId, input.supplierId);
    }
    let currency = existing.currency;
    if (
      input.currencyId !== undefined &&
      input.currencyId !== existing.currencyId
    ) {
      currency = await this.loadActiveCurrency(input.currencyId);
    }
    const effectiveBranchId =
      input.branchId !== undefined ? input.branchId : existing.branchId;

    if (input.branchId) {
      await this.assertBranchBelongsToCompany(ctx.companyId, input.branchId);
    }

    let rebuiltLines: BuiltLine[] | undefined;
    if (input.lines) {
      rebuiltLines = await this.buildLines(ctx.companyId, input.lines);
    }
    const total = rebuiltLines ? computeOrderTotal(rebuiltLines) : undefined;

    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.PurchaseOrderUncheckedUpdateManyInput = {};
      if (input.supplierId !== undefined) data.supplierId = supplier.id;
      if (input.currencyId !== undefined) data.currencyId = currency.id;
      if (input.branchId !== undefined) data.branchId = effectiveBranchId;
      if (input.orderDate !== undefined) data.orderDate = input.orderDate;
      if (input.expectedDeliveryDate !== undefined)
        data.expectedDeliveryDate = input.expectedDeliveryDate;
      if (input.notes !== undefined) data.notes = input.notes || null;
      if (total !== undefined) data.total = total;

      // `updatedAt` is set explicitly, not left to `@updatedAt` — Prisma
      // silently downgrades an `updateMany` whose `data` is completely
      // empty into a plain non-locking SELECT count, WITHOUT ever issuing
      // a real UPDATE or taking a row lock, which would defeat the guard
      // below (see the identical fix/comment in
      // PurchaseReceiptsService.update() for the full story — this PO path
      // isn't reachable today since a `lines` PATCH always also sets
      // `total`, but forcing a real field here removes that as an
      // assumption rather than an invariant).
      data.updatedAt = new Date();

      // Guarded INSIDE the transaction, not just checked before it — see
      // docs/purchases.md's "Concurrency" section. A racing confirm()/
      // cancel() that commits first flips status away from DRAFT; Postgres
      // serializes the two UPDATEs on this row, so whichever loses this
      // race sees 0 rows matched here and rolls back instead of silently
      // mutating an order that's no longer a draft.
      const guarded = await tx.purchaseOrder.updateMany({
        where: { id: existing.id, status: 'DRAFT' },
        data,
      });
      if (guarded.count === 0) throw new PurchaseOrderNotEditableException();

      if (rebuiltLines) {
        await tx.purchaseOrderLine.deleteMany({
          where: { purchaseOrderId: existing.id },
        });
        await tx.purchaseOrderLine.createMany({
          data: rebuiltLines.map((l) => ({
            purchaseOrderId: existing.id,
            productVariantId: l.productVariantId,
            quantity: l.quantity,
            unitCost: l.unitCost,
            lineTotal: l.lineTotal,
          })),
        });
      }

      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'UPDATE',
          entityType: 'PurchaseOrder',
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
   * docs/purchases.md. UNLIKE SalesService.confirm, this NEVER calls
   * InventoryService: confirming a Purchase Order is a commercial status
   * change only, with zero stock effect. The conditional
   * `WHERE status = 'DRAFT'` update still runs first so a concurrent or
   * retried confirm is safe, even though there's no inventory race to
   * protect here — consistency with the rest of the codebase's confirm
   * pattern, not a functional requirement of this particular transition.
   */
  async confirm(
    ctx: RequestContext,
    id: string,
  ): Promise<PurchaseOrderDetailDto> {
    const existing = await this.findScopedOrThrow(ctx.companyId, id);
    if (existing.status === 'CONFIRMED')
      throw new PurchaseOrderAlreadyConfirmedException();
    if (existing.status !== 'DRAFT')
      throw new PurchaseOrderNotEditableException();

    await this.prisma.$transaction(async (tx) => {
      const guarded = await tx.purchaseOrder.updateMany({
        where: { id, status: 'DRAFT' },
        data: {
          status: 'CONFIRMED',
          confirmedAt: new Date(),
          confirmedBy: ctx.userId,
        },
      });
      if (guarded.count === 0)
        throw new PurchaseOrderAlreadyConfirmedException();

      // Reload fresh from WITHIN this transaction rather than trusting the
      // pre-transaction `existing` snapshot — a racing update() could have
      // committed (new supplier/lines/total) between that read and this
      // guard succeeding; the guard above guarantees no such update can
      // land AFTER this point (see docs/purchases.md's "Concurrency"
      // section), but one immediately before it is otherwise invisible to
      // an audit record built from stale data.
      const confirmed = await tx.purchaseOrder.findUniqueOrThrow({
        where: { id },
        include: ORDER_INCLUDE,
      });

      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'CONFIRM',
          entityType: 'PurchaseOrder',
          entityId: id,
          metadata: {
            change: 'purchase_order_confirmed',
            number: confirmed.number,
            supplierName: confirmed.supplier.legalName,
            total: confirmed.total.toString(),
            lineCount: confirmed.lines.length,
          },
        },
        tx,
      );
    });

    // Only reachable once the transaction above has committed — see
    // docs/desktop-lan-architecture.md's "Realtime architecture". No
    // stock.changed here: confirming a PO never touches inventory.
    this.realtimePublisher.purchaseOrderConfirmed(ctx.companyId, id);
    return this.getById(ctx.companyId, id);
  }

  /** DRAFT-only — a CONFIRMED order can never be cancelled through this method (see docs/purchases.md's terminal-state rule). */
  async cancel(
    ctx: RequestContext,
    id: string,
  ): Promise<PurchaseOrderDetailDto> {
    const existing = await this.findScopedOrThrow(ctx.companyId, id);
    if (existing.status !== 'DRAFT')
      throw new PurchaseOrderNotEditableException();

    await this.prisma.$transaction(async (tx) => {
      // Guarded, not a blind update-by-id — see update()'s identical
      // reasoning above and docs/purchases.md's "Concurrency" section. A
      // racing confirm() that commits first flips status to CONFIRMED;
      // this then matches 0 rows and rolls back instead of cancelling an
      // order that's already been confirmed (finding D: PO confirm racing
      // cancel can never produce an illegal transition).
      const guarded = await tx.purchaseOrder.updateMany({
        where: { id, status: 'DRAFT' },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledBy: ctx.userId,
        },
      });
      if (guarded.count === 0) throw new PurchaseOrderNotEditableException();
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'CANCEL',
          entityType: 'PurchaseOrder',
          entityId: id,
          metadata: { number: existing.number },
        },
        tx,
      );
    });

    this.realtimePublisher.purchaseOrderCancelled(ctx.companyId, id);
    return this.getById(ctx.companyId, id);
  }

  // ---------- Internal helpers ----------

  /** Exposed for PurchaseReceiptsService — loads + validates a CONFIRMED order for receiving against. */
  async loadScopedOrder(
    companyId: string,
    id: string,
  ): Promise<OrderWithRelations> {
    return this.findScopedOrThrow(companyId, id);
  }

  async receivedQuantitiesByLine(
    lineIds: string[],
  ): Promise<Map<string, Prisma.Decimal>> {
    if (lineIds.length === 0) return new Map();
    // Only CONFIRMED receipt lines count toward "received so far" — a
    // DRAFT receipt is not yet a physical fact, and a CANCELLED receipt's
    // reversal is a separate StockMovement, not a change to this count
    // (the receipt itself stays CANCELLED, never re-DRAFTed) — see
    // docs/purchases.md.
    const rows = await this.prisma.purchaseReceiptLine.groupBy({
      by: ['purchaseOrderLineId'],
      where: {
        purchaseOrderLineId: { in: lineIds },
        purchaseReceipt: { status: 'CONFIRMED' },
      },
      _sum: { quantity: true },
    });
    const map = new Map<string, Prisma.Decimal>();
    for (const row of rows) {
      if (row.purchaseOrderLineId) {
        map.set(
          row.purchaseOrderLineId,
          row._sum.quantity ?? new Prisma.Decimal(0),
        );
      }
    }
    return map;
  }

  private async loadActiveSupplier(
    companyId: string,
    id: string,
  ): Promise<Supplier> {
    const supplier = await this.suppliersService.loadScoped(companyId, id);
    if (supplier.status !== 'ACTIVE') {
      throw new PurchaseOrderSupplierInactiveException();
    }
    return supplier;
  }

  /**
   * A client-supplied `branchId` is a raw UUID, not authorization by
   * itself (see AGENTS.md/CLAUDE.md — never trust company ownership from
   * request payloads). The FK to `branches` only proves the row exists
   * SOMEWHERE, not that it belongs to this company — same rule and same
   * shape as WarehousesService.assertBranchBelongsToCompany. `ctx.branchId`
   * (the header-derived default) is already validated elsewhere
   * (CompanyContextService.validateBranchAccess) and never re-checked here.
   */
  private async assertBranchBelongsToCompany(
    companyId: string,
    branchId: string,
  ): Promise<void> {
    const found = await this.prisma.branch.findFirst({
      where: { id: branchId, companyId },
    });
    if (!found) throw new PurchaseOrderInvalidBranchException();
  }

  private async loadActiveCurrency(id: string): Promise<Currency> {
    const currency = await this.prisma.currency.findFirst({
      where: { id, active: true },
    });
    if (!currency) throw new CurrencyNotFoundException();
    return currency;
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

  private async buildLines(
    companyId: string,
    inputLines: {
      productVariantId: string;
      quantity: string;
      unitCost: string;
    }[],
  ): Promise<BuiltLine[]> {
    const built: BuiltLine[] = [];
    for (const line of inputLines) {
      const variant = await this.loadVariantWithUnit(
        companyId,
        line.productVariantId,
      );
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
        unitCost: line.unitCost,
        lineTotal: computeLineTotal(line.quantity, line.unitCost),
      });
    }
    return built;
  }

  private async findScopedOrThrow(
    companyId: string,
    id: string,
  ): Promise<OrderWithRelations> {
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id, companyId },
      include: ORDER_INCLUDE,
    });
    if (!order) throw new PurchaseOrderNotFoundException();
    return order;
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
    const seq = await tx.purchaseOrderSequence.upsert({
      where: { companyId },
      create: { companyId, lastValue: 1 },
      update: { lastValue: { increment: 1 } },
    });
    return `OC-${String(seq.lastValue).padStart(6, '0')}`;
  }
}
