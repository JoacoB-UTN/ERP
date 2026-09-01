import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import type {
  CustomerCollection,
  CustomerCollectionApplication,
  Customer,
  Currency,
} from '../generated/prisma/client';
import type {
  CreateCustomerCollectionInput,
  UpdateCustomerCollectionInput,
  CustomerCollectionListQuery,
  CustomerCollectionListResponse,
  CustomerCollectionDetailDto,
  CustomerCollectionSummaryDto,
  CustomerCollectionApplicationDto,
} from '@erp/shared';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import type { RequestContext } from '../company-context/types';
import { CustomerNotFoundException } from '../customers/customers.exceptions';
import { CurrencyNotFoundException } from '../pricing/pricing.exceptions';
import { CustomerAccountService } from './customer-account.service';
import {
  CustomerCollectionNotFoundException,
  CustomerCollectionNotEditableException,
  CustomerCollectionAlreadyConfirmedException,
  CustomerCollectionAlreadyCancelledException,
  CustomerCollectionInvalidBranchException,
  CustomerCollectionApplicationSaleMismatchException,
  CustomerCollectionApplicationSaleNotConfirmedException,
  CustomerCollectionApplicationCurrencyMismatchException,
  CustomerCollectionApplicationsExceedAmountException,
  CustomerCollectionOverApplicationException,
} from './customer-collections.exceptions';

type CollectionWithRelations = CustomerCollection & {
  customer: Customer;
  currency: Currency;
  applications: (CustomerCollectionApplication & {
    salesDocument: { number: string };
  })[];
};

interface BuiltApplication {
  salesDocumentId: string;
  amount: string;
}

const COLLECTION_INCLUDE = {
  customer: true,
  currency: true,
  applications: { include: { salesDocument: { select: { number: true } } } },
} satisfies Prisma.CustomerCollectionInclude;

function toSummary(
  c: CollectionWithRelations,
  createdByName: string | null,
): CustomerCollectionSummaryDto {
  const appliedAmount = c.applications.reduce(
    (sum, a) => sum.add(a.amount),
    new Prisma.Decimal(0),
  );
  return {
    id: c.id,
    number: c.number,
    status: c.status,
    occurredAt: c.occurredAt.toISOString(),
    customer: { id: c.customer.id, code: c.customer.code, legalName: c.customer.legalName },
    currencyCode: c.currency.code,
    amount: c.amount.toString(),
    appliedAmount: appliedAmount.toString(),
    unappliedAmount: new Prisma.Decimal(c.amount).sub(appliedAmount).toString(),
    paymentMethod: c.paymentMethod,
    createdBy: c.createdBy ? { id: c.createdBy, name: createdByName } : null,
  };
}

function toApplicationDto(a: CustomerCollectionApplication & { salesDocument: { number: string } }): CustomerCollectionApplicationDto {
  return {
    id: a.id,
    salesDocumentId: a.salesDocumentId,
    salesDocumentNumber: a.salesDocument.number,
    amount: a.amount.toString(),
  };
}

function toDetail(
  c: CollectionWithRelations,
  names: Map<string, string>,
): CustomerCollectionDetailDto {
  return {
    ...toSummary(c, c.createdBy ? (names.get(c.createdBy) ?? null) : null),
    branchId: c.branchId,
    currencyId: c.currencyId,
    externalReference: c.externalReference,
    notes: c.notes,
    applications: c.applications.map(toApplicationDto),
    createdAt: c.createdAt.toISOString(),
    confirmedAt: c.confirmedAt?.toISOString() ?? null,
    confirmedBy: c.confirmedBy ? { id: c.confirmedBy, name: names.get(c.confirmedBy) ?? null } : null,
    cancelledAt: c.cancelledAt?.toISOString() ?? null,
    cancelledBy: c.cancelledBy ? { id: c.cancelledBy, name: names.get(c.cancelledBy) ?? null } : null,
  };
}

/**
 * Customer Collections ("Cobros") — see docs/current-accounts.md. Applications
 * are persisted with the document at any status but only affect the ledger
 * once the parent collection is CONFIRMED (CustomerAccountService.getSalesOutstanding
 * only counts applications whose `customerCollection.status === 'CONFIRMED'`),
 * so cancelling a CONFIRMED collection (via the immutable COLLECTION_REVERSAL
 * movement) naturally "frees" its applications without ever deleting them.
 */
@Injectable()
export class CustomerCollectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly customerAccountService: CustomerAccountService,
    private readonly realtimePublisher: RealtimePublisher,
  ) {}

  async list(companyId: string, query: CustomerCollectionListQuery): Promise<CustomerCollectionListResponse> {
    const where: Prisma.CustomerCollectionWhereInput = {
      companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
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
              { customer: { legalName: { contains: query.search, mode: 'insensitive' } } },
              { customer: { code: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const skip = (query.page - 1) * query.pageSize;
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.customerCollection.count({ where }),
      this.prisma.customerCollection.findMany({
        where,
        include: COLLECTION_INCLUDE,
        orderBy: { occurredAt: 'desc' },
        skip,
        take: query.pageSize,
      }),
    ]);
    const names = await this.resolveUserNames(rows.map((r) => r.createdBy));
    return {
      items: rows.map((r) => toSummary(r, r.createdBy ? (names.get(r.createdBy) ?? null) : null)),
      pagination: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  async getById(companyId: string, id: string): Promise<CustomerCollectionDetailDto> {
    const collection = await this.findScopedOrThrow(companyId, id);
    const names = await this.resolveUserNames([collection.createdBy, collection.confirmedBy, collection.cancelledBy]);
    return toDetail(collection, names);
  }

  async create(ctx: RequestContext, input: CreateCustomerCollectionInput): Promise<CustomerCollectionDetailDto> {
    const customer = await this.loadCustomer(ctx.companyId, input.customerId);
    const currency = await this.loadCurrency(input.currencyId);
    if (input.branchId) await this.assertBranchBelongsToCompany(ctx.companyId, input.branchId);
    const branchId = input.branchId ?? ctx.branchId ?? null;

    const applications = await this.buildApplications(
      ctx.companyId,
      customer.id,
      currency.id,
      input.amount,
      input.applications,
    );

    const created = await this.prisma.$transaction(async (tx) => {
      const number = await this.nextNumber(tx, ctx.companyId);
      const collection = await tx.customerCollection.create({
        data: {
          tenantId: ctx.tenantId,
          companyId: ctx.companyId,
          branchId,
          number,
          customerId: customer.id,
          currencyId: currency.id,
          occurredAt: input.occurredAt ?? new Date(),
          amount: input.amount,
          paymentMethod: input.paymentMethod,
          externalReference: input.externalReference || null,
          notes: input.notes || null,
          createdBy: ctx.userId,
          applications: {
            create: applications.map((a) => ({ salesDocumentId: a.salesDocumentId, amount: a.amount })),
          },
        },
      });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'CREATE',
          entityType: 'CustomerCollection',
          entityId: collection.id,
          after: { number: collection.number, customerId: collection.customerId, amount: collection.amount.toString(), status: collection.status },
        },
        tx,
      );
      return collection;
    });
    return this.getById(ctx.companyId, created.id);
  }

  async update(ctx: RequestContext, id: string, input: UpdateCustomerCollectionInput): Promise<CustomerCollectionDetailDto> {
    const existing = await this.findScopedOrThrow(ctx.companyId, id);
    if (existing.status !== 'DRAFT') throw new CustomerCollectionNotEditableException();

    let customer = existing.customer;
    if (input.customerId !== undefined && input.customerId !== existing.customerId) {
      customer = await this.loadCustomer(ctx.companyId, input.customerId);
    }
    let currency = existing.currency;
    if (input.currencyId !== undefined && input.currencyId !== existing.currencyId) {
      currency = await this.loadCurrency(input.currencyId);
    }
    const amount = input.amount ?? existing.amount.toString();

    let rebuiltApplications: BuiltApplication[] | undefined;
    if (input.applications) {
      rebuiltApplications = await this.buildApplications(ctx.companyId, customer.id, currency.id, amount, input.applications);
    }

    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.CustomerCollectionUncheckedUpdateManyInput = {};
      if (input.customerId !== undefined) data.customerId = customer.id;
      if (input.currencyId !== undefined) data.currencyId = currency.id;
      if (input.occurredAt !== undefined) data.occurredAt = input.occurredAt;
      if (input.amount !== undefined) data.amount = input.amount;
      if (input.paymentMethod !== undefined) data.paymentMethod = input.paymentMethod;
      if (input.externalReference !== undefined) data.externalReference = input.externalReference || null;
      if (input.notes !== undefined) data.notes = input.notes || null;
      // Forced so an `applications`-only PATCH still issues a real UPDATE
      // and takes the row lock — see the Prompt-21 lesson documented at
      // length in PurchaseReceiptsService.update().
      data.updatedAt = new Date();

      const guarded = await tx.customerCollection.updateMany({ where: { id: existing.id, status: 'DRAFT' }, data });
      if (guarded.count === 0) throw new CustomerCollectionNotEditableException();

      if (rebuiltApplications) {
        await tx.customerCollectionApplication.deleteMany({ where: { customerCollectionId: existing.id } });
        await tx.customerCollectionApplication.createMany({
          data: rebuiltApplications.map((a) => ({
            customerCollectionId: existing.id,
            salesDocumentId: a.salesDocumentId,
            amount: a.amount,
          })),
        });
      }

      await this.auditService.recordFromContext(
        ctx,
        { action: 'UPDATE', entityType: 'CustomerCollection', entityId: id, metadata: { change: 'draft_updated' } },
        tx,
      );
    });
    return this.getById(ctx.companyId, id);
  }

  /**
   * Atomic and idempotent, same shape as SalesService.confirm/PurchaseReceiptsService.confirm.
   * Guards its own DRAFT->CONFIRMED transition first, THEN locks the target
   * SalesDocument rows (deterministic id order) before recomputing
   * outstanding — see docs/current-accounts.md's "Concurrency" section for
   * why this ordering is what prevents two concurrent confirms from both
   * succeeding past the same sale's outstanding balance.
   */
  async confirm(ctx: RequestContext, id: string): Promise<CustomerCollectionDetailDto> {
    const existing = await this.findScopedOrThrow(ctx.companyId, id);
    if (existing.status === 'CONFIRMED') throw new CustomerCollectionAlreadyConfirmedException();
    if (existing.status !== 'DRAFT') throw new CustomerCollectionNotEditableException();

    await this.prisma.$transaction(async (tx) => {
      const guarded = await tx.customerCollection.updateMany({
        where: { id, status: 'DRAFT' },
        data: { status: 'CONFIRMED', confirmedAt: new Date(), confirmedBy: ctx.userId },
      });
      if (guarded.count === 0) throw new CustomerCollectionAlreadyConfirmedException();

      const collection = await tx.customerCollection.findUniqueOrThrow({
        where: { id },
        include: COLLECTION_INCLUDE,
      });

      const salesDocumentIds = [...new Set(collection.applications.map((a) => a.salesDocumentId))].sort();
      if (salesDocumentIds.length > 0) {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM sales_documents WHERE id IN (${Prisma.join(salesDocumentIds)}) FOR UPDATE`,
        );
        const outstandingBySale = await this.customerAccountService.getSalesOutstanding(tx, ctx.companyId, salesDocumentIds);
        for (const salesDocumentId of salesDocumentIds) {
          const outstanding = outstandingBySale.get(salesDocumentId) ?? new Prisma.Decimal(0);
          if (outstanding.lt(0)) throw new CustomerCollectionOverApplicationException();
        }
      }

      await this.customerAccountService.postCollection(tx, {
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        customerId: collection.customerId,
        currencyId: collection.currencyId,
        collectionId: collection.id,
        collectionNumber: collection.number,
        amount: collection.amount.toString(),
        occurredAt: collection.occurredAt,
        createdBy: ctx.userId,
      });

      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'CONFIRM',
          entityType: 'CustomerCollection',
          entityId: id,
          metadata: { change: 'collection_confirmed', number: collection.number, customerName: collection.customer.legalName, amount: collection.amount.toString() },
        },
        tx,
      );
    });

    this.realtimePublisher.collectionConfirmed(ctx.companyId, id);
    this.realtimePublisher.customerAccountChanged(ctx.companyId, existing.customerId);
    return this.getById(ctx.companyId, id);
  }

  /**
   * DRAFT -> CANCELLED has zero ledger effect (a DRAFT collection never
   * posted anything). CONFIRMED -> CANCELLED posts a COLLECTION_REVERSAL —
   * see docs/current-accounts.md and CustomerAccountService.postCollectionReversal.
   * Applications are never deleted on either path — see the class doc
   * comment above.
   */
  async cancel(ctx: RequestContext, id: string): Promise<CustomerCollectionDetailDto> {
    const existing = await this.findScopedOrThrow(ctx.companyId, id);
    if (existing.status === 'CANCELLED') throw new CustomerCollectionAlreadyCancelledException();

    if (existing.status === 'DRAFT') {
      await this.prisma.$transaction(async (tx) => {
        const guarded = await tx.customerCollection.updateMany({
          where: { id, status: 'DRAFT' },
          data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: ctx.userId },
        });
        if (guarded.count === 0) throw new CustomerCollectionAlreadyCancelledException();
        await this.auditService.recordFromContext(
          ctx,
          { action: 'CANCEL', entityType: 'CustomerCollection', entityId: id, metadata: { change: 'draft_cancelled', number: existing.number } },
          tx,
        );
      });
      this.realtimePublisher.collectionCancelled(ctx.companyId, id);
      return this.getById(ctx.companyId, id);
    }

    await this.prisma.$transaction(async (tx) => {
      const guarded = await tx.customerCollection.updateMany({
        where: { id, status: 'CONFIRMED' },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: ctx.userId },
      });
      if (guarded.count === 0) throw new CustomerCollectionAlreadyCancelledException();

      await this.customerAccountService.postCollectionReversal(tx, {
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        customerId: existing.customerId,
        currencyId: existing.currencyId,
        collectionId: existing.id,
        collectionNumber: existing.number,
        amount: existing.amount.toString(),
        occurredAt: new Date(),
        createdBy: ctx.userId,
      });

      await this.auditService.recordFromContext(
        ctx,
        { action: 'CANCEL', entityType: 'CustomerCollection', entityId: id, metadata: { change: 'confirmed_collection_cancelled', number: existing.number } },
        tx,
      );
    });

    this.realtimePublisher.collectionCancelled(ctx.companyId, id);
    this.realtimePublisher.customerAccountChanged(ctx.companyId, existing.customerId);
    return this.getById(ctx.companyId, id);
  }

  // ---------- Internal helpers ----------

  private async loadCustomer(companyId: string, id: string): Promise<Customer> {
    const customer = await this.prisma.customer.findFirst({ where: { id, companyId } });
    if (!customer) throw new CustomerNotFoundException();
    return customer;
  }

  private async loadCurrency(id: string): Promise<Currency> {
    const currency = await this.prisma.currency.findFirst({ where: { id, active: true } });
    if (!currency) throw new CurrencyNotFoundException();
    return currency;
  }

  private async assertBranchBelongsToCompany(companyId: string, branchId: string): Promise<void> {
    const found = await this.prisma.branch.findFirst({ where: { id: branchId, companyId } });
    if (!found) throw new CustomerCollectionInvalidBranchException();
  }

  /**
   * Never trusts the request body for a target sale's company/customer/currency
   * ownership — always re-derived from the loaded SalesDocument row. This is
   * an ADVISORY (non-locking) over-application check; confirm() re-validates
   * with a row lock — see confirm() above.
   */
  private async buildApplications(
    companyId: string,
    customerId: string,
    currencyId: string,
    collectionAmount: string,
    inputApplications: { salesDocumentId: string; amount: string }[],
  ): Promise<BuiltApplication[]> {
    if (inputApplications.length === 0) return [];
    const salesDocumentIds = inputApplications.map((a) => a.salesDocumentId);
    const sales = await this.prisma.salesDocument.findMany({ where: { id: { in: salesDocumentIds }, companyId } });
    const saleById = new Map(sales.map((s) => [s.id, s]));

    let sumApplied = new Prisma.Decimal(0);
    const built: BuiltApplication[] = [];
    for (const application of inputApplications) {
      const sale = saleById.get(application.salesDocumentId);
      if (!sale || sale.customerId !== customerId) throw new CustomerCollectionApplicationSaleMismatchException();
      if (sale.status !== 'CONFIRMED') throw new CustomerCollectionApplicationSaleNotConfirmedException();
      if (sale.currencyId !== currencyId) throw new CustomerCollectionApplicationCurrencyMismatchException();
      sumApplied = sumApplied.add(application.amount);
      built.push({ salesDocumentId: sale.id, amount: application.amount });
    }
    if (sumApplied.gt(collectionAmount)) throw new CustomerCollectionApplicationsExceedAmountException();

    const outstandingBySale = await this.customerAccountService.getSalesOutstanding(this.prisma, companyId, salesDocumentIds);
    for (const application of built) {
      const outstanding = outstandingBySale.get(application.salesDocumentId) ?? new Prisma.Decimal(0);
      if (new Prisma.Decimal(application.amount).gt(outstanding)) throw new CustomerCollectionOverApplicationException();
    }
    return built;
  }

  private async findScopedOrThrow(companyId: string, id: string): Promise<CollectionWithRelations> {
    const collection = await this.prisma.customerCollection.findFirst({ where: { id, companyId }, include: COLLECTION_INCLUDE });
    if (!collection) throw new CustomerCollectionNotFoundException();
    return collection;
  }

  private async resolveUserNames(userIds: (string | null)[]): Promise<Map<string, string>> {
    const ids = [...new Set(userIds.filter((id): id is string => !!id))];
    if (ids.length === 0) return new Map();
    const users = await this.prisma.user.findMany({ where: { id: { in: ids } } });
    return new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
  }

  private async nextNumber(tx: Prisma.TransactionClient, companyId: string): Promise<string> {
    const seq = await tx.customerCollectionSequence.upsert({
      where: { companyId },
      create: { companyId, lastValue: 1 },
      update: { lastValue: { increment: 1 } },
    });
    return `COB-${String(seq.lastValue).padStart(6, '0')}`;
  }
}
