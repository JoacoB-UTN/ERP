import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import type { Customer } from '../generated/prisma/client';
import type {
  CustomerAccountListQuery,
  CustomerAccountListResponse,
  CustomerAccountSummary,
  CustomerStatementQuery,
  CustomerStatementResponse,
  CustomerAccountMovementDto,
  CustomerOpenSalesResponse,
  CustomerOpenSaleDto,
  SalesDocumentOutstandingResponse,
} from '@erp/shared';
import { formatCuit } from '@erp/shared';
import { PrismaService } from '../database/prisma.service';
import { CustomerNotFoundException } from '../customers/customers.exceptions';
import { CurrencyNotFoundException } from '../pricing/pricing.exceptions';
import { SaleNotFoundException } from '../sales/sales.exceptions';

type Db = PrismaService | Prisma.TransactionClient;

/**
 * Customer Current Account (Accounts Receivable) — read model over the
 * immutable CustomerAccountMovement ledger, PLUS the one write path
 * (`postSaleConfirmation`) SalesService calls from WITHIN its own confirm
 * transaction. See docs/current-accounts.md.
 *
 * Sign convention: positive = customer owes us. SALE_CHARGE +,
 * TENDER_SETTLEMENT/COLLECTION -, COLLECTION_REVERSAL +. Never store an
 * authoritative mutable balance — every number here is SUM(movements) at
 * read time.
 */
@Injectable()
export class CustomerAccountService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- Writes (called from within SalesService's own transaction) ----------

  /**
   * Posts SALE_CHARGE (+total) and, when `tender` is present,
   * TENDER_SETTLEMENT (-tender.amount) — both keyed by
   * `sourceType: 'SalesDocument', sourceId: salesDocumentId`, so the
   * `@@unique([companyId, sourceType, sourceId, movementType])` constraint
   * makes a duplicate post for the same sale (a genuine concurrent
   * double-confirm that somehow got past SalesService's own DRAFT guard)
   * fail loudly at the database level rather than silently double-charging.
   * `tender.amount` is ALWAYS the sale's total (never amountReceived) —
   * enforced by the caller, not re-derived here.
   */
  async postSaleConfirmation(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      companyId: string;
      customerId: string;
      currencyId: string;
      salesDocumentId: string;
      salesDocumentNumber: string;
      total: string;
      occurredAt: Date;
      createdBy: string | null;
      tender?: { amount: string };
    },
  ): Promise<void> {
    await tx.customerAccountMovement.create({
      data: {
        tenantId: params.tenantId,
        companyId: params.companyId,
        customerId: params.customerId,
        currencyId: params.currencyId,
        movementType: 'SALE_CHARGE',
        amount: params.total,
        occurredAt: params.occurredAt,
        sourceType: 'SalesDocument',
        sourceId: params.salesDocumentId,
        description: `Venta ${params.salesDocumentNumber}`,
        createdBy: params.createdBy,
      },
    });
    if (params.tender) {
      await tx.customerAccountMovement.create({
        data: {
          tenantId: params.tenantId,
          companyId: params.companyId,
          customerId: params.customerId,
          currencyId: params.currencyId,
          movementType: 'TENDER_SETTLEMENT',
          amount: new Prisma.Decimal(params.tender.amount).neg().toString(),
          occurredAt: params.occurredAt,
          sourceType: 'SalesDocument',
          sourceId: params.salesDocumentId,
          description: `Pago al momento — Venta ${params.salesDocumentNumber}`,
          createdBy: params.createdBy,
        },
      });
    }
  }

  /** Posts a COLLECTION (-amount) movement — called from CustomerCollectionsService.confirm() within its own transaction. */
  async postCollection(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      companyId: string;
      customerId: string;
      currencyId: string;
      collectionId: string;
      collectionNumber: string;
      amount: string;
      occurredAt: Date;
      createdBy: string | null;
    },
  ): Promise<void> {
    await tx.customerAccountMovement.create({
      data: {
        tenantId: params.tenantId,
        companyId: params.companyId,
        customerId: params.customerId,
        currencyId: params.currencyId,
        movementType: 'COLLECTION',
        amount: new Prisma.Decimal(params.amount).neg().toString(),
        occurredAt: params.occurredAt,
        sourceType: 'CustomerCollection',
        sourceId: params.collectionId,
        description: `Cobro ${params.collectionNumber}`,
        createdBy: params.createdBy,
      },
    });
  }

  /** Posts a COLLECTION_REVERSAL (+amount) movement, pointed back at the original COLLECTION row — called from CustomerCollectionsService.cancel(). */
  async postCollectionReversal(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      companyId: string;
      customerId: string;
      currencyId: string;
      collectionId: string;
      collectionNumber: string;
      amount: string;
      occurredAt: Date;
      createdBy: string | null;
    },
  ): Promise<void> {
    const original = await tx.customerAccountMovement.findUniqueOrThrow({
      where: {
        companyId_sourceType_sourceId_movementType: {
          companyId: params.companyId,
          sourceType: 'CustomerCollection',
          sourceId: params.collectionId,
          movementType: 'COLLECTION',
        },
      },
    });
    await tx.customerAccountMovement.create({
      data: {
        tenantId: params.tenantId,
        companyId: params.companyId,
        customerId: params.customerId,
        currencyId: params.currencyId,
        movementType: 'COLLECTION_REVERSAL',
        amount: new Prisma.Decimal(params.amount).toString(),
        occurredAt: params.occurredAt,
        sourceType: 'CustomerCollection',
        sourceId: params.collectionId,
        reversalOfId: original.id,
        description: `Anulación cobro ${params.collectionNumber}`,
        createdBy: params.createdBy,
      },
    });
  }

  // ---------- Reusable outstanding math (the ONE place this logic lives) ----------

  /**
   * `total charge` minus `active (CONFIRMED-collection) applications`,
   * both summed straight from the ledger/applications tables — never a
   * stored counter. A SalesDocument with a SalesTender nets to 0 here
   * automatically (SALE_CHARGE + TENDER_SETTLEMENT cancel out), with no
   * special-casing needed. Accepts either the plain PrismaService or an
   * open transaction client, so the SAME method is used by read endpoints
   * and by CustomerCollectionsService's lock-protected confirm() check.
   */
  async getSalesOutstanding(
    db: Db,
    companyId: string,
    salesDocumentIds: string[],
  ): Promise<Map<string, Prisma.Decimal>> {
    if (salesDocumentIds.length === 0) return new Map();
    const [chargeSums, appliedSums] = await Promise.all([
      db.customerAccountMovement.groupBy({
        by: ['sourceId'],
        where: { companyId, sourceType: 'SalesDocument', sourceId: { in: salesDocumentIds } },
        _sum: { amount: true },
      }),
      db.customerCollectionApplication.groupBy({
        by: ['salesDocumentId'],
        where: {
          salesDocumentId: { in: salesDocumentIds },
          customerCollection: { status: 'CONFIRMED' },
        },
        _sum: { amount: true },
      }),
    ]);
    const appliedById = new Map(
      appliedSums.map((row) => [row.salesDocumentId, row._sum.amount ?? new Prisma.Decimal(0)]),
    );
    const result = new Map<string, Prisma.Decimal>();
    for (const row of chargeSums) {
      const charge = row._sum.amount ?? new Prisma.Decimal(0);
      const applied = appliedById.get(row.sourceId) ?? new Prisma.Decimal(0);
      result.set(row.sourceId, charge.sub(applied));
    }
    return result;
  }

  async getSalesDocumentOutstanding(
    companyId: string,
    salesDocumentId: string,
  ): Promise<SalesDocumentOutstandingResponse> {
    const sale = await this.prisma.salesDocument.findFirst({
      where: { id: salesDocumentId, companyId },
      include: { currency: true },
    });
    if (!sale) throw new SaleNotFoundException();
    const outstandingByLine = await this.getSalesOutstanding(this.prisma, companyId, [salesDocumentId]);
    const outstanding = outstandingByLine.get(salesDocumentId) ?? new Prisma.Decimal(0);
    return {
      salesDocumentId,
      currencyCode: sale.currency.code,
      total: sale.total.toString(),
      outstanding: Prisma.Decimal.max(outstanding, 0).toString(),
    };
  }

  // ---------- Reads ----------

  async list(companyId: string, query: CustomerAccountListQuery): Promise<CustomerAccountListResponse> {
    const where: Prisma.CustomerWhereInput = { companyId };
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
    const [total, customers] = await this.prisma.$transaction([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({ where, orderBy: { legalName: 'asc' }, skip, take: query.pageSize }),
    ]);

    const ids = customers.map((c) => c.id);
    const [balances, lastMovements] = await Promise.all([
      this.balancesByCustomer(companyId, ids),
      this.lastMovementByCustomer(companyId, ids),
    ]);

    return {
      items: customers.map((c) => this.toSummary(c, balances.get(c.id) ?? [], lastMovements.get(c.id) ?? null)),
      pagination: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  async getSummary(companyId: string, customerId: string): Promise<CustomerAccountSummary> {
    const customer = await this.findScopedCustomer(companyId, customerId);
    const [balances, lastMovements] = await Promise.all([
      this.balancesByCustomer(companyId, [customerId]),
      this.lastMovementByCustomer(companyId, [customerId]),
    ]);
    return this.toSummary(customer, balances.get(customerId) ?? [], lastMovements.get(customerId) ?? null);
  }

  async getStatement(
    companyId: string,
    customerId: string,
    query: CustomerStatementQuery,
  ): Promise<CustomerStatementResponse> {
    const customer = await this.findScopedCustomer(companyId, customerId);
    const currency = await this.prisma.currency.findFirst({ where: { id: query.currencyId } });
    if (!currency) throw new CurrencyNotFoundException();

    let openingBalance = new Prisma.Decimal(0);
    if (query.dateFrom) {
      const opening = await this.prisma.customerAccountMovement.aggregate({
        where: { companyId, customerId, currencyId: query.currencyId, occurredAt: { lt: query.dateFrom } },
        _sum: { amount: true },
      });
      openingBalance = opening._sum.amount ?? new Prisma.Decimal(0);
    }

    const rangeWhere: Prisma.CustomerAccountMovementWhereInput = {
      companyId,
      customerId,
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
    const movements = await this.prisma.customerAccountMovement.findMany({
      where: rangeWhere,
      // Deterministic ordering for equal timestamps — see docs/current-accounts.md.
      orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });

    let running = openingBalance;
    const items: CustomerAccountMovementDto[] = movements.map((m) => {
      running = running.add(m.amount);
      return toMovementDto(m, running);
    });

    return {
      customer: {
        id: customer.id,
        code: customer.code,
        legalName: customer.legalName,
        displayName: customer.tradeName || customer.legalName,
      },
      currencyId: currency.id,
      currencyCode: currency.code,
      openingBalance: openingBalance.toString(),
      closingBalance: running.toString(),
      items,
    };
  }

  async getOpenSales(
    companyId: string,
    customerId: string,
    currencyId: string,
  ): Promise<CustomerOpenSalesResponse> {
    const currency = await this.prisma.currency.findFirst({ where: { id: currencyId } });
    if (!currency) throw new CurrencyNotFoundException();
    const sales = await this.prisma.salesDocument.findMany({
      where: { companyId, customerId, currencyId, status: 'CONFIRMED' },
      orderBy: { occurredAt: 'asc' },
    });
    const outstandingBySale = await this.getSalesOutstanding(
      this.prisma,
      companyId,
      sales.map((s) => s.id),
    );
    const items: CustomerOpenSaleDto[] = [];
    for (const sale of sales) {
      const outstanding = outstandingBySale.get(sale.id) ?? new Prisma.Decimal(0);
      if (outstanding.lte(0)) continue;
      items.push({
        id: sale.id,
        number: sale.number,
        occurredAt: sale.occurredAt.toISOString(),
        total: sale.total.toString(),
        outstanding: outstanding.toString(),
      });
    }
    return { currencyId, currencyCode: currency.code, items };
  }

  // ---------- Internal helpers ----------

  private async findScopedCustomer(companyId: string, id: string): Promise<Customer> {
    const customer = await this.prisma.customer.findFirst({ where: { id, companyId } });
    if (!customer) throw new CustomerNotFoundException();
    return customer;
  }

  private async balancesByCustomer(
    companyId: string,
    customerIds: string[],
  ): Promise<Map<string, { currencyId: string; currencyCode: string; balance: string }[]>> {
    if (customerIds.length === 0) return new Map();
    const rows = await this.prisma.customerAccountMovement.groupBy({
      by: ['customerId', 'currencyId'],
      where: { companyId, customerId: { in: customerIds } },
      _sum: { amount: true },
    });
    if (rows.length === 0) return new Map();
    const currencyIds = [...new Set(rows.map((r) => r.currencyId))];
    const currencies = await this.prisma.currency.findMany({ where: { id: { in: currencyIds } } });
    const currencyById = new Map(currencies.map((c) => [c.id, c]));
    const map = new Map<string, { currencyId: string; currencyCode: string; balance: string }[]>();
    for (const row of rows) {
      const list = map.get(row.customerId) ?? [];
      list.push({
        currencyId: row.currencyId,
        currencyCode: currencyById.get(row.currencyId)?.code ?? '',
        balance: (row._sum.amount ?? new Prisma.Decimal(0)).toString(),
      });
      map.set(row.customerId, list);
    }
    return map;
  }

  private async lastMovementByCustomer(
    companyId: string,
    customerIds: string[],
  ): Promise<Map<string, Date>> {
    if (customerIds.length === 0) return new Map();
    const rows = await this.prisma.customerAccountMovement.groupBy({
      by: ['customerId'],
      where: { companyId, customerId: { in: customerIds } },
      _max: { occurredAt: true },
    });
    return new Map(
      rows
        .filter((r): r is typeof r & { _max: { occurredAt: Date } } => !!r._max.occurredAt)
        .map((r) => [r.customerId, r._max.occurredAt]),
    );
  }

  private toSummary(
    customer: Customer,
    balances: { currencyId: string; currencyCode: string; balance: string }[],
    lastMovementAt: Date | null,
  ): CustomerAccountSummary {
    const taxIdFormatted =
      customer.taxId && (customer.documentType === 'CUIT' || customer.documentType === 'CUIL')
        ? formatCuit(customer.taxId)
        : customer.taxId;
    return {
      customerId: customer.id,
      code: customer.code,
      legalName: customer.legalName,
      displayName: customer.tradeName || customer.legalName,
      taxId: customer.taxId,
      taxIdFormatted,
      balances,
      lastMovementAt: lastMovementAt ? lastMovementAt.toISOString() : null,
    };
  }
}

/** Debe = increases the signed balance (positive amount); Haber = decreases it — see docs/current-accounts.md. */
function toMovementDto(
  m: { id: string; occurredAt: Date; movementType: string; sourceType: string; sourceId: string; description: string | null; amount: Prisma.Decimal },
  runningBalance: Prisma.Decimal,
): CustomerAccountMovementDto {
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
