import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import type { Supplier } from '../generated/prisma/client';
import type {
  SupplierAccountListQuery,
  SupplierAccountListResponse,
  SupplierAccountSummary,
  SupplierStatementQuery,
  SupplierStatementResponse,
  SupplierAccountMovementDto,
  SupplierOpenReceiptsResponse,
  SupplierOpenReceiptDto,
  PurchaseReceiptOutstandingResponse,
} from '@erp/shared';
import { formatCuit } from '@erp/shared';
import { PrismaService } from '../database/prisma.service';
import { SupplierNotFoundException } from '../purchases/suppliers.exceptions';
import { PurchaseReceiptNotFoundException } from '../purchases/purchase-receipts.exceptions';
import { CurrencyNotFoundException } from '../pricing/pricing.exceptions';

type Db = PrismaService | Prisma.TransactionClient;

/**
 * Supplier Current Account (Operational Accounts Payable) — symmetric to
 * CustomerAccountService, see docs/current-accounts.md.
 *
 * Sign convention: positive = we owe the supplier.
 * PURCHASE_RECEIPT_ACCRUAL +, PURCHASE_RECEIPT_REVERSAL/SUPPLIER_PAYMENT -,
 * SUPPLIER_PAYMENT_REVERSAL +.
 */
@Injectable()
export class SupplierAccountService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- Writes (called from within PurchaseReceiptsService's own transaction) ----------

  /** Posts PURCHASE_RECEIPT_ACCRUAL (+amount) — see docs/current-accounts.md's "operational payable accrual" decision (deliberately not a fiscal invoice). */
  async postReceiptAccrual(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      companyId: string;
      supplierId: string;
      currencyId: string;
      purchaseReceiptId: string;
      purchaseReceiptNumber: string;
      amount: string;
      occurredAt: Date;
      createdBy: string | null;
    },
  ): Promise<void> {
    await tx.supplierAccountMovement.create({
      data: {
        tenantId: params.tenantId,
        companyId: params.companyId,
        supplierId: params.supplierId,
        currencyId: params.currencyId,
        movementType: 'PURCHASE_RECEIPT_ACCRUAL',
        amount: params.amount,
        occurredAt: params.occurredAt,
        sourceType: 'PurchaseReceipt',
        sourceId: params.purchaseReceiptId,
        description: `Recepción ${params.purchaseReceiptNumber}`,
        createdBy: params.createdBy,
      },
    });
  }

  /** Posts PURCHASE_RECEIPT_REVERSAL (-amount), pointed back at the original accrual — see docs/current-accounts.md. */
  async postReceiptReversal(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      companyId: string;
      supplierId: string;
      currencyId: string;
      purchaseReceiptId: string;
      purchaseReceiptNumber: string;
      amount: string;
      occurredAt: Date;
      createdBy: string | null;
    },
  ): Promise<void> {
    const original = await tx.supplierAccountMovement.findUniqueOrThrow({
      where: {
        companyId_sourceType_sourceId_movementType: {
          companyId: params.companyId,
          sourceType: 'PurchaseReceipt',
          sourceId: params.purchaseReceiptId,
          movementType: 'PURCHASE_RECEIPT_ACCRUAL',
        },
      },
    });
    await tx.supplierAccountMovement.create({
      data: {
        tenantId: params.tenantId,
        companyId: params.companyId,
        supplierId: params.supplierId,
        currencyId: params.currencyId,
        movementType: 'PURCHASE_RECEIPT_REVERSAL',
        amount: new Prisma.Decimal(params.amount).neg().toString(),
        occurredAt: params.occurredAt,
        sourceType: 'PurchaseReceipt',
        sourceId: params.purchaseReceiptId,
        reversalOfId: original.id,
        description: `Anulación recepción ${params.purchaseReceiptNumber}`,
        createdBy: params.createdBy,
      },
    });
  }

  /** Posts SUPPLIER_PAYMENT (-amount) — called from SupplierPaymentsService.confirm(). */
  async postPayment(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      companyId: string;
      supplierId: string;
      currencyId: string;
      supplierPaymentId: string;
      supplierPaymentNumber: string;
      amount: string;
      occurredAt: Date;
      createdBy: string | null;
    },
  ): Promise<void> {
    await tx.supplierAccountMovement.create({
      data: {
        tenantId: params.tenantId,
        companyId: params.companyId,
        supplierId: params.supplierId,
        currencyId: params.currencyId,
        movementType: 'SUPPLIER_PAYMENT',
        amount: new Prisma.Decimal(params.amount).neg().toString(),
        occurredAt: params.occurredAt,
        sourceType: 'SupplierPayment',
        sourceId: params.supplierPaymentId,
        description: `Pago ${params.supplierPaymentNumber}`,
        createdBy: params.createdBy,
      },
    });
  }

  /** Posts SUPPLIER_PAYMENT_REVERSAL (+amount) — called from SupplierPaymentsService.cancel(). */
  async postPaymentReversal(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      companyId: string;
      supplierId: string;
      currencyId: string;
      supplierPaymentId: string;
      supplierPaymentNumber: string;
      amount: string;
      occurredAt: Date;
      createdBy: string | null;
    },
  ): Promise<void> {
    const original = await tx.supplierAccountMovement.findUniqueOrThrow({
      where: {
        companyId_sourceType_sourceId_movementType: {
          companyId: params.companyId,
          sourceType: 'SupplierPayment',
          sourceId: params.supplierPaymentId,
          movementType: 'SUPPLIER_PAYMENT',
        },
      },
    });
    await tx.supplierAccountMovement.create({
      data: {
        tenantId: params.tenantId,
        companyId: params.companyId,
        supplierId: params.supplierId,
        currencyId: params.currencyId,
        movementType: 'SUPPLIER_PAYMENT_REVERSAL',
        amount: new Prisma.Decimal(params.amount).toString(),
        occurredAt: params.occurredAt,
        sourceType: 'SupplierPayment',
        sourceId: params.supplierPaymentId,
        reversalOfId: original.id,
        description: `Anulación pago ${params.supplierPaymentNumber}`,
        createdBy: params.createdBy,
      },
    });
  }

  // ---------- Reusable outstanding math (the ONE place this logic lives) ----------

  /**
   * Net ledger effect for each receipt (accrual minus any reversal — 0 for
   * a cancelled receipt) minus active (CONFIRMED-payment) applications.
   * Accepts either PrismaService or an open transaction client — see
   * CustomerAccountService.getSalesOutstanding's identical reasoning.
   */
  async getReceiptsOutstanding(
    db: Db,
    companyId: string,
    purchaseReceiptIds: string[],
  ): Promise<Map<string, Prisma.Decimal>> {
    if (purchaseReceiptIds.length === 0) return new Map();
    const [accrualSums, appliedSums] = await Promise.all([
      db.supplierAccountMovement.groupBy({
        by: ['sourceId'],
        where: { companyId, sourceType: 'PurchaseReceipt', sourceId: { in: purchaseReceiptIds } },
        _sum: { amount: true },
      }),
      db.supplierPaymentApplication.groupBy({
        by: ['purchaseReceiptId'],
        where: {
          purchaseReceiptId: { in: purchaseReceiptIds },
          supplierPayment: { status: 'CONFIRMED' },
        },
        _sum: { amount: true },
      }),
    ]);
    const appliedById = new Map(
      appliedSums.map((row) => [row.purchaseReceiptId, row._sum.amount ?? new Prisma.Decimal(0)]),
    );
    const result = new Map<string, Prisma.Decimal>();
    for (const row of accrualSums) {
      const net = row._sum.amount ?? new Prisma.Decimal(0);
      const applied = appliedById.get(row.sourceId) ?? new Prisma.Decimal(0);
      result.set(row.sourceId, net.sub(applied));
    }
    return result;
  }

  /**
   * Whether this receipt has any application belonging to a CONFIRMED
   * SupplierPayment — the MVP safety rule blocking receipt cancellation
   * (see docs/current-accounts.md and PurchaseReceiptsService.cancel()).
   * MUST be called from within a transaction that has already locked this
   * receipt row (see the lock-based concurrency section of
   * docs/current-accounts.md) so a concurrent payment confirmation can
   * never race past this check.
   */
  async hasActiveConfirmedApplications(
    tx: Prisma.TransactionClient,
    purchaseReceiptId: string,
  ): Promise<boolean> {
    const count = await tx.supplierPaymentApplication.count({
      where: { purchaseReceiptId, supplierPayment: { status: 'CONFIRMED' } },
    });
    return count > 0;
  }

  async getReceiptOutstanding(
    companyId: string,
    purchaseReceiptId: string,
  ): Promise<PurchaseReceiptOutstandingResponse> {
    const receipt = await this.prisma.purchaseReceipt.findFirst({
      where: { id: purchaseReceiptId, companyId },
      include: { currency: true },
    });
    if (!receipt) throw new PurchaseReceiptNotFoundException();
    const accrual = await this.prisma.supplierAccountMovement.aggregate({
      where: { companyId, sourceType: 'PurchaseReceipt', sourceId: purchaseReceiptId },
      _sum: { amount: true },
    });
    const total = accrual._sum.amount ?? new Prisma.Decimal(0);
    const outstandingByReceipt = await this.getReceiptsOutstanding(this.prisma, companyId, [purchaseReceiptId]);
    const outstanding = outstandingByReceipt.get(purchaseReceiptId) ?? new Prisma.Decimal(0);
    return {
      purchaseReceiptId,
      currencyCode: receipt.currency.code,
      total: total.toString(),
      outstanding: Prisma.Decimal.max(outstanding, 0).toString(),
    };
  }

  // ---------- Reads ----------

  async list(companyId: string, query: SupplierAccountListQuery): Promise<SupplierAccountListResponse> {
    const where: Prisma.SupplierWhereInput = { companyId };
    if (query.search) {
      const term = query.search.trim();
      where.OR = [
        { code: { contains: term, mode: 'insensitive' } },
        { legalName: { contains: term, mode: 'insensitive' } },
        { tradeName: { contains: term, mode: 'insensitive' } },
        { taxId: { contains: term } },
      ];
    }
    const skip = (query.page - 1) * query.pageSize;
    const [total, suppliers] = await this.prisma.$transaction([
      this.prisma.supplier.count({ where }),
      this.prisma.supplier.findMany({ where, orderBy: { legalName: 'asc' }, skip, take: query.pageSize }),
    ]);

    const ids = suppliers.map((s) => s.id);
    const [balances, lastMovements] = await Promise.all([
      this.balancesBySupplier(companyId, ids),
      this.lastMovementBySupplier(companyId, ids),
    ]);

    return {
      items: suppliers.map((s) => this.toSummary(s, balances.get(s.id) ?? [], lastMovements.get(s.id) ?? null)),
      pagination: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  async getSummary(companyId: string, supplierId: string): Promise<SupplierAccountSummary> {
    const supplier = await this.findScopedSupplier(companyId, supplierId);
    const [balances, lastMovements] = await Promise.all([
      this.balancesBySupplier(companyId, [supplierId]),
      this.lastMovementBySupplier(companyId, [supplierId]),
    ]);
    return this.toSummary(supplier, balances.get(supplierId) ?? [], lastMovements.get(supplierId) ?? null);
  }

  async getStatement(
    companyId: string,
    supplierId: string,
    query: SupplierStatementQuery,
  ): Promise<SupplierStatementResponse> {
    const supplier = await this.findScopedSupplier(companyId, supplierId);
    const currency = await this.prisma.currency.findFirst({ where: { id: query.currencyId } });
    if (!currency) throw new CurrencyNotFoundException();

    let openingBalance = new Prisma.Decimal(0);
    if (query.dateFrom) {
      const opening = await this.prisma.supplierAccountMovement.aggregate({
        where: { companyId, supplierId, currencyId: query.currencyId, occurredAt: { lt: query.dateFrom } },
        _sum: { amount: true },
      });
      openingBalance = opening._sum.amount ?? new Prisma.Decimal(0);
    }

    const rangeWhere: Prisma.SupplierAccountMovementWhereInput = {
      companyId,
      supplierId,
      currencyId: query.currencyId,
      ...(query.dateFrom || query.dateTo
        ? {
            occurredAt: {
              ...(query.dateFrom ? { gte: query.dateFrom } : {}),
              ...(query.dateTo ? { lte: query.dateTo } : {}),
            },
          }
        : {}),
    };
    const movements = await this.prisma.supplierAccountMovement.findMany({
      where: rangeWhere,
      orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });

    let running = openingBalance;
    const items: SupplierAccountMovementDto[] = movements.map((m) => {
      running = running.add(m.amount);
      return toMovementDto(m, running);
    });

    return {
      supplier: {
        id: supplier.id,
        code: supplier.code,
        legalName: supplier.legalName,
        displayName: supplier.tradeName || supplier.legalName,
      },
      currencyId: currency.id,
      currencyCode: currency.code,
      openingBalance: openingBalance.toString(),
      closingBalance: running.toString(),
      items,
    };
  }

  async getOpenReceipts(
    companyId: string,
    supplierId: string,
    currencyId: string,
  ): Promise<SupplierOpenReceiptsResponse> {
    const currency = await this.prisma.currency.findFirst({ where: { id: currencyId } });
    if (!currency) throw new CurrencyNotFoundException();
    const receipts = await this.prisma.purchaseReceipt.findMany({
      where: { companyId, supplierId, currencyId, status: 'CONFIRMED' },
      orderBy: { receiptDate: 'asc' },
    });
    const outstandingByReceipt = await this.getReceiptsOutstanding(
      this.prisma,
      companyId,
      receipts.map((r) => r.id),
    );
    const totalByReceipt = await this.prisma.supplierAccountMovement.groupBy({
      by: ['sourceId'],
      where: { companyId, sourceType: 'PurchaseReceipt', sourceId: { in: receipts.map((r) => r.id) } },
      _sum: { amount: true },
    });
    const totalById = new Map(totalByReceipt.map((r) => [r.sourceId, r._sum.amount ?? new Prisma.Decimal(0)]));

    const items: SupplierOpenReceiptDto[] = [];
    for (const receipt of receipts) {
      const outstanding = outstandingByReceipt.get(receipt.id) ?? new Prisma.Decimal(0);
      if (outstanding.lte(0)) continue;
      items.push({
        id: receipt.id,
        number: receipt.number,
        receiptDate: receipt.receiptDate.toISOString(),
        total: (totalById.get(receipt.id) ?? new Prisma.Decimal(0)).toString(),
        outstanding: outstanding.toString(),
      });
    }
    return { currencyId, currencyCode: currency.code, items };
  }

  // ---------- Internal helpers ----------

  private async findScopedSupplier(companyId: string, id: string): Promise<Supplier> {
    const supplier = await this.prisma.supplier.findFirst({ where: { id, companyId } });
    if (!supplier) throw new SupplierNotFoundException();
    return supplier;
  }

  private async balancesBySupplier(
    companyId: string,
    supplierIds: string[],
  ): Promise<Map<string, { currencyId: string; currencyCode: string; balance: string }[]>> {
    if (supplierIds.length === 0) return new Map();
    const rows = await this.prisma.supplierAccountMovement.groupBy({
      by: ['supplierId', 'currencyId'],
      where: { companyId, supplierId: { in: supplierIds } },
      _sum: { amount: true },
    });
    if (rows.length === 0) return new Map();
    const currencyIds = [...new Set(rows.map((r) => r.currencyId))];
    const currencies = await this.prisma.currency.findMany({ where: { id: { in: currencyIds } } });
    const currencyById = new Map(currencies.map((c) => [c.id, c]));
    const map = new Map<string, { currencyId: string; currencyCode: string; balance: string }[]>();
    for (const row of rows) {
      const list = map.get(row.supplierId) ?? [];
      list.push({
        currencyId: row.currencyId,
        currencyCode: currencyById.get(row.currencyId)?.code ?? '',
        balance: (row._sum.amount ?? new Prisma.Decimal(0)).toString(),
      });
      map.set(row.supplierId, list);
    }
    return map;
  }

  private async lastMovementBySupplier(
    companyId: string,
    supplierIds: string[],
  ): Promise<Map<string, Date>> {
    if (supplierIds.length === 0) return new Map();
    const rows = await this.prisma.supplierAccountMovement.groupBy({
      by: ['supplierId'],
      where: { companyId, supplierId: { in: supplierIds } },
      _max: { occurredAt: true },
    });
    return new Map(
      rows
        .filter((r): r is typeof r & { _max: { occurredAt: Date } } => !!r._max.occurredAt)
        .map((r) => [r.supplierId, r._max.occurredAt]),
    );
  }

  private toSummary(
    supplier: Supplier,
    balances: { currencyId: string; currencyCode: string; balance: string }[],
    lastMovementAt: Date | null,
  ): SupplierAccountSummary {
    const taxIdFormatted =
      supplier.taxId && (supplier.documentType === 'CUIT' || supplier.documentType === 'CUIL')
        ? formatCuit(supplier.taxId)
        : supplier.taxId;
    return {
      supplierId: supplier.id,
      code: supplier.code,
      legalName: supplier.legalName,
      displayName: supplier.tradeName || supplier.legalName,
      taxId: supplier.taxId,
      taxIdFormatted,
      balances,
      lastMovementAt: lastMovementAt ? lastMovementAt.toISOString() : null,
    };
  }
}

/** Same Debe/Haber convention as CustomerAccountService's identical helper. */
function toMovementDto(
  m: { id: string; occurredAt: Date; movementType: string; sourceType: string; sourceId: string; description: string | null; amount: Prisma.Decimal },
  runningBalance: Prisma.Decimal,
): SupplierAccountMovementDto {
  const isDebit = m.amount.gte(0);
  return {
    id: m.id,
    occurredAt: m.occurredAt.toISOString(),
    movementType: m.movementType,
    sourceType: m.sourceType,
    sourceId: m.sourceId,
    description: m.description,
    debit: isDebit ? m.amount.toString() : '0',
    credit: isDebit ? '0' : m.amount.neg().toString(),
    amount: m.amount.toString(),
    runningBalance: runningBalance.toString(),
  };
}
