import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import type {
  SalesDocument,
  SalesDocumentLine,
  SalesTender,
  ProductVariant,
  Product,
  Warehouse,
  Customer,
  PriceList,
  Currency,
} from '../generated/prisma/client';
import type {
  CreateSaleInput,
  UpdateSaleInput,
  ConfirmSaleTenderInput,
  SalesListQuery,
  SalesListResponse,
  SalesDocumentDetailDto,
  SalesDocumentSummaryDto,
  SalesDocumentLineDto,
  SalesTenderDto,
} from '@erp/shared';
import { exceedsDecimalPrecision } from '@erp/shared';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../company-context/types';
import { CustomerNotFoundException } from '../customers/customers.exceptions';
import { ProductVariantNotFoundException } from '../products/products.exceptions';
import { InvalidQuantityPrecisionException } from '../inventory/inventory.exceptions';
import { InventoryService } from '../inventory/inventory.service';
import { PricingService } from '../pricing/pricing.service';
import {
  SaleNotFoundException,
  SaleNotEditableException,
  SaleAlreadyConfirmedException,
  SaleCustomerInactiveException,
  SaleWarehouseInvalidException,
  SalePriceListInvalidException,
  SaleTenderCashInsufficientException,
} from './sales.exceptions';

type VariantWithUnit = ProductVariant & {
  product: Product & { baseUnit: { name: string; decimalPlaces: number } };
};
type LineWithVariant = SalesDocumentLine & {
  variant: ProductVariant & { product: Product };
};
type SaleWithRelations = SalesDocument & {
  warehouse: Warehouse;
  customer: Customer;
  priceList: PriceList;
  currency: Currency;
  lines: LineWithVariant[];
  tender: SalesTender | null;
};

interface BuiltLine {
  productVariantId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discountPercentage: string;
  discountAmount: string;
  netAmount: string;
  taxAmount: string;
  totalAmount: string;
}

const SALE_INCLUDE = {
  warehouse: true,
  customer: true,
  priceList: true,
  currency: true,
  lines: { include: { variant: { include: { product: true } } } },
  tender: true,
} satisfies Prisma.SalesDocumentInclude;

/** Per-line arithmetic — see docs/sales.md's documented totals convention. Decimal-safe throughout, never floating point. */
function computeLineTotals(
  quantity: string,
  unitPrice: string,
  discountPercentage: string,
): {
  discountPercentage: string;
  discountAmount: string;
  netAmount: string;
  taxAmount: string;
  totalAmount: string;
} {
  const qty = new Prisma.Decimal(quantity);
  const price = new Prisma.Decimal(unitPrice);
  const discountPct = new Prisma.Decimal(discountPercentage).toDecimalPlaces(
    2,
    Prisma.Decimal.ROUND_HALF_UP,
  );
  const gross = qty.mul(price);
  const discountAmount = gross
    .mul(discountPct)
    .div(100)
    .toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
  const netAmount = gross
    .sub(discountAmount)
    .toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
  return {
    discountPercentage: discountPct.toString(),
    discountAmount: discountAmount.toString(),
    netAmount: netAmount.toString(),
    // Tax is deliberately always 0 in this task — no fiscal/tax engine exists yet. See docs/sales.md.
    taxAmount: '0',
    totalAmount: netAmount.toString(),
  };
}

/** subtotal is NET of line discounts (sum of netAmount), not gross — see docs/sales.md. total = subtotal + taxTotal (taxTotal always 0 today). */
function computeDocumentTotals(lines: BuiltLine[]): {
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
} {
  let subtotal = new Prisma.Decimal(0);
  let discountTotal = new Prisma.Decimal(0);
  for (const line of lines) {
    subtotal = subtotal.add(line.netAmount);
    discountTotal = discountTotal.add(line.discountAmount);
  }
  return {
    subtotal: subtotal.toString(),
    discountTotal: discountTotal.toString(),
    taxTotal: '0',
    total: subtotal.toString(),
  };
}

function toLineDto(line: LineWithVariant): SalesDocumentLineDto {
  return {
    id: line.id,
    productVariantId: line.productVariantId,
    productId: line.variant.product.id,
    description: line.description,
    variantName: line.variant.name,
    sku: line.variant.sku,
    quantity: line.quantity.toString(),
    unitPrice: line.unitPrice.toString(),
    discountPercentage: line.discountPercentage.toString(),
    discountAmount: line.discountAmount.toString(),
    netAmount: line.netAmount.toString(),
    taxAmount: line.taxAmount.toString(),
    totalAmount: line.totalAmount.toString(),
  };
}

function toSummary(
  s: SaleWithRelations,
  createdByName: string | null,
): SalesDocumentSummaryDto {
  return {
    id: s.id,
    number: s.number,
    documentType: s.documentType,
    status: s.status,
    occurredAt: s.occurredAt.toISOString(),
    customer: {
      id: s.customer.id,
      code: s.customer.code,
      legalName: s.customer.legalName,
    },
    warehouse: {
      id: s.warehouse.id,
      code: s.warehouse.code,
      name: s.warehouse.name,
    },
    priceList: {
      id: s.priceList.id,
      code: s.priceList.code,
      name: s.priceList.name,
    },
    currencyCode: s.currency.code,
    total: s.total.toString(),
    lineCount: s.lines.length,
    createdBy: s.createdBy ? { id: s.createdBy, name: createdByName } : null,
  };
}

/** `change` is derived here, never stored — see docs/pos.md. */
function toTenderDto(t: SalesTender): SalesTenderDto {
  const amountReceived = t.amountReceived?.toString() ?? null;
  return {
    method: t.method,
    amountApplied: t.amountApplied.toString(),
    amountReceived,
    change: amountReceived
      ? t.amountReceived!.sub(t.amountApplied).toString()
      : null,
    reference: t.reference,
    createdAt: t.createdAt.toISOString(),
  };
}

function toDetail(
  s: SaleWithRelations,
  names: Map<string, string>,
): SalesDocumentDetailDto {
  return {
    ...toSummary(s, s.createdBy ? (names.get(s.createdBy) ?? null) : null),
    branchId: s.branchId,
    subtotal: s.subtotal.toString(),
    discountTotal: s.discountTotal.toString(),
    taxTotal: s.taxTotal.toString(),
    notes: s.notes,
    lines: s.lines.map(toLineDto),
    tender: s.tender ? toTenderDto(s.tender) : null,
    createdAt: s.createdAt.toISOString(),
    confirmedAt: s.confirmedAt?.toISOString() ?? null,
    confirmedBy: s.confirmedBy
      ? { id: s.confirmedBy, name: names.get(s.confirmedBy) ?? null }
      : null,
    cancelledAt: s.cancelledAt?.toISOString() ?? null,
    cancelledBy: s.cancelledBy
      ? { id: s.cancelledBy, name: names.get(s.cancelledBy) ?? null }
      : null,
  };
}

/**
 * The demo Sales Core — see docs/sales.md and CLAUDE.md. An internal
 * commercial transaction, NOT a fiscal/electronic invoice. DRAFT sales
 * have zero inventory effect; confirming is atomic (status change +
 * StockMovement per inventory-tracked line, in one transaction) and
 * idempotent (a retried confirm on an already-CONFIRMED sale never
 * double-deducts stock — see confirm()). Every line snapshots
 * description/unitPrice at the moment it's (re-)priced through
 * PricingService — never re-resolved afterward, including after
 * confirmation. Facturación/POS will call these same methods rather than
 * duplicating sale logic — see CLAUDE.md.
 */
@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly inventoryService: InventoryService,
    private readonly pricingService: PricingService,
  ) {}

  async list(
    companyId: string,
    query: SalesListQuery,
  ): Promise<SalesListResponse> {
    const where: Prisma.SalesDocumentWhereInput = {
      companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            occurredAt: {
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
                customer: {
                  legalName: { contains: query.search, mode: 'insensitive' },
                },
              },
              {
                customer: {
                  code: { contains: query.search, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };

    const skip = (query.page - 1) * query.pageSize;
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.salesDocument.count({ where }),
      this.prisma.salesDocument.findMany({
        where,
        include: SALE_INCLUDE,
        orderBy: { occurredAt: 'desc' },
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
  ): Promise<SalesDocumentDetailDto> {
    const sale = await this.findScopedOrThrow(companyId, id);
    const names = await this.resolveUserNames([
      sale.createdBy,
      sale.confirmedBy,
      sale.cancelledBy,
    ]);
    return toDetail(sale, names);
  }

  async create(
    ctx: RequestContext,
    input: CreateSaleInput,
  ): Promise<SalesDocumentDetailDto> {
    const customer = await this.loadActiveCustomer(
      ctx.companyId,
      input.customerId,
    );
    const branchId = input.branchId ?? ctx.branchId ?? null;
    const warehouse = await this.loadSalesWarehouse(
      ctx.companyId,
      input.warehouseId,
      branchId,
    );
    const priceList = await this.loadActivePriceList(
      ctx.companyId,
      input.priceListId,
    );
    const occurredAt = input.occurredAt ?? new Date();
    const lines = await this.buildLines(
      ctx.companyId,
      priceList.id,
      input.lines,
      occurredAt,
    );
    const totals = computeDocumentTotals(lines);

    const created = await this.prisma.$transaction(async (tx) => {
      const number = await this.nextNumber(tx, ctx.companyId);
      const sale = await tx.salesDocument.create({
        data: {
          tenantId: ctx.tenantId,
          companyId: ctx.companyId,
          branchId,
          number,
          warehouseId: warehouse.id,
          customerId: customer.id,
          priceListId: priceList.id,
          currencyId: priceList.currencyId,
          occurredAt,
          notes: input.notes || null,
          createdBy: ctx.userId,
          subtotal: totals.subtotal,
          discountTotal: totals.discountTotal,
          taxTotal: totals.taxTotal,
          total: totals.total,
          lines: {
            create: lines.map((l) => ({
              productVariantId: l.productVariantId,
              description: l.description,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              discountPercentage: l.discountPercentage,
              discountAmount: l.discountAmount,
              netAmount: l.netAmount,
              taxAmount: l.taxAmount,
              totalAmount: l.totalAmount,
            })),
          },
        },
      });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'CREATE',
          entityType: 'SalesDocument',
          entityId: sale.id,
          after: {
            number: sale.number,
            customerId: sale.customerId,
            warehouseId: sale.warehouseId,
            total: sale.total.toString(),
            status: sale.status,
          },
        },
        tx,
      );
      return sale;
    });
    return this.getById(ctx.companyId, created.id);
  }

  async update(
    ctx: RequestContext,
    id: string,
    input: UpdateSaleInput,
  ): Promise<SalesDocumentDetailDto> {
    const existing = await this.findScopedOrThrow(ctx.companyId, id);
    if (existing.status !== 'DRAFT') throw new SaleNotEditableException();

    let customer = existing.customer;
    if (
      input.customerId !== undefined &&
      input.customerId !== existing.customerId
    ) {
      customer = await this.loadActiveCustomer(ctx.companyId, input.customerId);
    }

    const effectiveBranchId =
      input.branchId !== undefined ? input.branchId : existing.branchId;
    let warehouse = existing.warehouse;
    if (
      (input.warehouseId !== undefined &&
        input.warehouseId !== existing.warehouseId) ||
      (input.branchId !== undefined && input.branchId !== existing.branchId)
    ) {
      warehouse = await this.loadSalesWarehouse(
        ctx.companyId,
        input.warehouseId ?? existing.warehouseId,
        effectiveBranchId,
      );
    }

    let priceList: PriceList = existing.priceList;
    let priceListChanged = false;
    if (
      input.priceListId !== undefined &&
      input.priceListId !== existing.priceListId
    ) {
      priceList = await this.loadActivePriceList(
        ctx.companyId,
        input.priceListId,
      );
      priceListChanged = true;
    }

    const occurredAt = input.occurredAt ?? existing.occurredAt;

    // Reprice ALL draft lines whenever the price list changes, even if the
    // caller didn't also resend `lines` — see docs/sales.md's documented
    // repricing rule.
    let rebuiltLines: BuiltLine[] | undefined;
    if (input.lines) {
      rebuiltLines = await this.buildLines(
        ctx.companyId,
        priceList.id,
        input.lines,
        occurredAt,
      );
    } else if (priceListChanged) {
      const sourceLines = existing.lines.map((l) => ({
        productVariantId: l.productVariantId,
        quantity: l.quantity.toString(),
        discountPercentage: l.discountPercentage.toString(),
      }));
      rebuiltLines = await this.buildLines(
        ctx.companyId,
        priceList.id,
        sourceLines,
        occurredAt,
      );
    }
    const totals = rebuiltLines ? computeDocumentTotals(rebuiltLines) : null;

    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.SalesDocumentUncheckedUpdateInput = {};
      if (input.customerId !== undefined) data.customerId = customer.id;
      if (input.warehouseId !== undefined) data.warehouseId = warehouse.id;
      if (input.branchId !== undefined) data.branchId = input.branchId;
      if (priceListChanged) {
        data.priceListId = priceList.id;
        data.currencyId = priceList.currencyId;
      }
      if (input.notes !== undefined) data.notes = input.notes || null;
      if (input.occurredAt !== undefined) data.occurredAt = input.occurredAt;
      if (totals) {
        data.subtotal = totals.subtotal;
        data.discountTotal = totals.discountTotal;
        data.taxTotal = totals.taxTotal;
        data.total = totals.total;
      }

      await tx.salesDocument.update({ where: { id: existing.id }, data });

      if (rebuiltLines) {
        await tx.salesDocumentLine.deleteMany({
          where: { salesDocumentId: existing.id },
        });
        await tx.salesDocumentLine.createMany({
          data: rebuiltLines.map((l) => ({
            salesDocumentId: existing.id,
            productVariantId: l.productVariantId,
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            discountPercentage: l.discountPercentage,
            discountAmount: l.discountAmount,
            netAmount: l.netAmount,
            taxAmount: l.taxAmount,
            totalAmount: l.totalAmount,
          })),
        });
      }

      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'UPDATE',
          entityType: 'SalesDocument',
          entityId: id,
          metadata: { change: 'draft_updated' },
        },
        tx,
      );
    });
    return this.getById(ctx.companyId, id);
  }

  /**
   * Atomic and idempotent — see docs/sales.md. The DRAFT->CONFIRMED
   * transition is a conditional update (`WHERE status = 'DRAFT'`) done
   * FIRST inside the transaction: a concurrent second confirm sees zero
   * rows affected and rolls back before ever touching inventory, so stock
   * is deducted exactly once even under a race, not just under sequential
   * retries.
   *
   * `tender` is optional — a plain Facturación/Gestión confirm can omit
   * it entirely (see docs/sales.md), while POS checkout always supplies
   * one (see docs/pos.md). CASH is validated (amountReceived >= total)
   * BEFORE the transaction opens, so an insufficient-cash error never
   * touches the DRAFT->CONFIRMED guard or inventory. The SalesTender row
   * is created in the SAME transaction as the status change and the
   * inventory movements — a confirmed sale can never end up without its
   * tender, and a rolled-back confirm never leaves an orphan tender.
   */
  async confirm(
    ctx: RequestContext,
    id: string,
    tender?: ConfirmSaleTenderInput,
  ): Promise<SalesDocumentDetailDto> {
    const existing = await this.findScopedOrThrow(ctx.companyId, id);
    if (existing.status === 'CONFIRMED')
      throw new SaleAlreadyConfirmedException();
    if (existing.status !== 'DRAFT') throw new SaleNotEditableException();

    const total = existing.total.toString();
    if (tender?.method === 'CASH' && tender.amountReceived !== undefined) {
      if (Number(tender.amountReceived) < Number(total)) {
        throw new SaleTenderCashInsufficientException();
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const guarded = await tx.salesDocument.updateMany({
        where: { id, status: 'DRAFT' },
        data: {
          status: 'CONFIRMED',
          confirmedAt: new Date(),
          confirmedBy: ctx.userId,
        },
      });
      if (guarded.count === 0) throw new SaleAlreadyConfirmedException();

      for (const line of existing.lines) {
        await this.inventoryService.applySaleLine(tx, ctx, {
          warehouse: existing.warehouse,
          productVariantId: line.productVariantId,
          quantity: line.quantity.toString(),
          referenceType: 'SalesDocument',
          referenceId: existing.id,
          occurredAt: existing.occurredAt,
        });
      }

      if (tender) {
        await tx.salesTender.create({
          data: {
            salesDocumentId: existing.id,
            method: tender.method,
            // Full payment only in this MVP — amountApplied always equals
            // the sale's own total, never a client-supplied amount.
            amountApplied: total,
            amountReceived:
              tender.method === 'CASH'
                ? (tender.amountReceived ?? total)
                : null,
            reference: tender.reference ?? null,
            createdBy: ctx.userId,
          },
        });
      }

      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'CONFIRM',
          entityType: 'SalesDocument',
          entityId: id,
          metadata: {
            change: 'sale_confirmed',
            number: existing.number,
            customerName: existing.customer.legalName,
            warehouseName: existing.warehouse.name,
            priceListName: existing.priceList.name,
            total: existing.total.toString(),
            lineCount: existing.lines.length,
            ...(tender ? { tenderMethod: tender.method } : {}),
          },
        },
        tx,
      );
    });
    return this.getById(ctx.companyId, id);
  }

  /**
   * DRAFT-only — a CONFIRMED sale can never be cancelled through this
   * method (falls through to SaleNotEditableException). Reversing a
   * confirmed sale's inventory effect is explicitly deferred — see
   * docs/sales.md.
   */
  async cancel(
    ctx: RequestContext,
    id: string,
  ): Promise<SalesDocumentDetailDto> {
    const existing = await this.findScopedOrThrow(ctx.companyId, id);
    if (existing.status !== 'DRAFT') throw new SaleNotEditableException();

    await this.prisma.$transaction(async (tx) => {
      await tx.salesDocument.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledBy: ctx.userId,
        },
      });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'CANCEL',
          entityType: 'SalesDocument',
          entityId: id,
          metadata: { number: existing.number },
        },
        tx,
      );
    });
    return this.getById(ctx.companyId, id);
  }

  // ---------- Internal helpers ----------

  private async loadActiveCustomer(
    companyId: string,
    id: string,
  ): Promise<Customer> {
    const customer = await this.prisma.customer.findFirst({
      where: { id, companyId },
    });
    if (!customer) throw new CustomerNotFoundException();
    if (customer.status !== 'ACTIVE') throw new SaleCustomerInactiveException();
    return customer;
  }

  /**
   * Branch/warehouse matching is only enforced when the sale actually
   * carries a branchId (see docs/sales.md, section "Warehouse validation":
   * "if branchId present, validate..."). Gestión has no branch-scoped
   * session today (unlike Facturación's WarehouseSelector), so most Sales
   * created there never carry a branchId at all — in that case ANY
   * active + allowsSales warehouse is valid, matching every other
   * Gestión module's warehouse dropdown (see StockAdjustmentsService).
   * When a branchId IS present, a warehouse with branchId === null is
   * still valid for any branch; a warehouse with a set branchId must
   * match it exactly.
   */
  private async loadSalesWarehouse(
    companyId: string,
    warehouseId: string,
    branchId: string | null,
  ): Promise<Warehouse> {
    const warehouse = await this.inventoryService.loadWarehouse(
      companyId,
      warehouseId,
    );
    if (warehouse.status !== 'ACTIVE' || !warehouse.allowsSales) {
      throw new SaleWarehouseInvalidException();
    }
    if (
      branchId !== null &&
      warehouse.branchId !== null &&
      warehouse.branchId !== branchId
    ) {
      throw new SaleWarehouseInvalidException(
        'El depósito seleccionado no pertenece a la sucursal indicada.',
      );
    }
    return warehouse;
  }

  private async loadActivePriceList(
    companyId: string,
    id: string,
  ): Promise<PriceList> {
    const priceList = await this.pricingService.loadPriceList(companyId, id);
    if (!priceList.active) throw new SalePriceListInvalidException();
    return priceList;
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

  /** Resolves price through PricingService for every line — never reads a price from Product, never duplicates pricing logic. See CLAUDE.md. */
  private async buildLines(
    companyId: string,
    priceListId: string,
    inputLines: {
      productVariantId: string;
      quantity: string;
      discountPercentage: string;
    }[],
    occurredAt: Date,
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
      const resolved = await this.pricingService.getPrice(
        companyId,
        priceListId,
        variant.id,
        occurredAt,
      );
      const totals = computeLineTotals(
        line.quantity,
        resolved.price,
        line.discountPercentage,
      );
      built.push({
        productVariantId: variant.id,
        description: variant.name
          ? `${variant.product.name} / ${variant.name}`
          : variant.product.name,
        quantity: line.quantity,
        unitPrice: resolved.price,
        ...totals,
      });
    }
    return built;
  }

  private async findScopedOrThrow(
    companyId: string,
    id: string,
  ): Promise<SaleWithRelations> {
    const sale = await this.prisma.salesDocument.findFirst({
      where: { id, companyId },
      include: SALE_INCLUDE,
    });
    if (!sale) throw new SaleNotFoundException();
    return sale;
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
    const seq = await tx.salesDocumentSequence.upsert({
      where: { companyId },
      create: { companyId, lastValue: 1 },
      update: { lastValue: { increment: 1 } },
    });
    return `VTA-${String(seq.lastValue).padStart(6, '0')}`;
  }
}
