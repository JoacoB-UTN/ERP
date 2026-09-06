import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import type {
  SupplierPayment,
  SupplierPaymentApplication,
  Supplier,
  Currency,
} from '../generated/prisma/client';
import type {
  CreateSupplierPaymentInput,
  UpdateSupplierPaymentInput,
  SupplierPaymentListQuery,
  SupplierPaymentListResponse,
  SupplierPaymentDetailDto,
  SupplierPaymentSummaryDto,
  SupplierPaymentApplicationDto,
} from '@erp/shared';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import type { RequestContext } from '../company-context/types';
import { SupplierNotFoundException } from '../purchases/suppliers.exceptions';
import { CurrencyNotFoundException } from '../pricing/pricing.exceptions';
import { SupplierAccountService } from './supplier-account.service';
import {
  SupplierPaymentNotFoundException,
  SupplierPaymentNotEditableException,
  SupplierPaymentAlreadyConfirmedException,
  SupplierPaymentAlreadyCancelledException,
  SupplierPaymentInvalidBranchException,
  SupplierPaymentApplicationReceiptMismatchException,
  SupplierPaymentApplicationReceiptNotConfirmedException,
  SupplierPaymentApplicationCurrencyMismatchException,
  SupplierPaymentApplicationsExceedAmountException,
  SupplierPaymentOverApplicationException,
} from './supplier-payments.exceptions';

type PaymentWithRelations = SupplierPayment & {
  supplier: Supplier;
  currency: Currency;
  applications: (SupplierPaymentApplication & {
    purchaseReceipt: { number: string };
  })[];
};

interface BuiltApplication {
  purchaseReceiptId: string;
  amount: string;
}

const PAYMENT_INCLUDE = {
  supplier: true,
  currency: true,
  applications: { include: { purchaseReceipt: { select: { number: true } } } },
} satisfies Prisma.SupplierPaymentInclude;

function toSummary(
  p: PaymentWithRelations,
  createdByName: string | null,
): SupplierPaymentSummaryDto {
  const appliedAmount = p.applications.reduce(
    (sum, a) => sum.add(a.amount),
    new Prisma.Decimal(0),
  );
  return {
    id: p.id,
    number: p.number,
    status: p.status,
    occurredAt: p.occurredAt.toISOString(),
    supplier: { id: p.supplier.id, code: p.supplier.code, legalName: p.supplier.legalName },
    currencyCode: p.currency.code,
    amount: p.amount.toString(),
    appliedAmount: appliedAmount.toString(),
    unappliedAmount: new Prisma.Decimal(p.amount).sub(appliedAmount).toString(),
    paymentMethod: p.paymentMethod,
    createdBy: p.createdBy ? { id: p.createdBy, name: createdByName } : null,
  };
}

function toApplicationDto(a: SupplierPaymentApplication & { purchaseReceipt: { number: string } }): SupplierPaymentApplicationDto {
  return {
    id: a.id,
    purchaseReceiptId: a.purchaseReceiptId,
    purchaseReceiptNumber: a.purchaseReceipt.number,
    amount: a.amount.toString(),
  };
}

function toDetail(
  p: PaymentWithRelations,
  names: Map<string, string>,
): SupplierPaymentDetailDto {
  return {
    ...toSummary(p, p.createdBy ? (names.get(p.createdBy) ?? null) : null),
    branchId: p.branchId,
    currencyId: p.currencyId,
    externalReference: p.externalReference,
    notes: p.notes,
    applications: p.applications.map(toApplicationDto),
    createdAt: p.createdAt.toISOString(),
    confirmedAt: p.confirmedAt?.toISOString() ?? null,
    confirmedBy: p.confirmedBy ? { id: p.confirmedBy, name: names.get(p.confirmedBy) ?? null } : null,
    cancelledAt: p.cancelledAt?.toISOString() ?? null,
    cancelledBy: p.cancelledBy ? { id: p.cancelledBy, name: names.get(p.cancelledBy) ?? null } : null,
  };
}

/**
 * Supplier Payments ("Pagos") — see docs/current-accounts.md. Symmetric to
 * CustomerCollectionsService. Applications are persisted with the document
 * at any status but only affect the ledger once the parent payment is
 * CONFIRMED (SupplierAccountService.getReceiptsOutstanding only counts
 * applications whose `supplierPayment.status === 'CONFIRMED'`).
 *
 * confirm() locks the target `purchase_receipts` rows FOR UPDATE — the SAME
 * rows PurchaseReceiptsService.cancel() locks before checking
 * hasActiveConfirmedApplications — so a concurrent "confirm this payment"
 * vs "cancel this receipt" race is fully serialized by Postgres rather than
 * racing past each other's in-memory check.
 */
@Injectable()
export class SupplierPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly supplierAccountService: SupplierAccountService,
    private readonly realtimePublisher: RealtimePublisher,
  ) {}

  async list(companyId: string, query: SupplierPaymentListQuery): Promise<SupplierPaymentListResponse> {
    const where: Prisma.SupplierPaymentWhereInput = {
      companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
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
              { supplier: { legalName: { contains: query.search, mode: 'insensitive' } } },
              { supplier: { code: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const skip = (query.page - 1) * query.pageSize;
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.supplierPayment.count({ where }),
      this.prisma.supplierPayment.findMany({
        where,
        include: PAYMENT_INCLUDE,
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

  async getById(companyId: string, id: string): Promise<SupplierPaymentDetailDto> {
    const payment = await this.findScopedOrThrow(companyId, id);
    const names = await this.resolveUserNames([payment.createdBy, payment.confirmedBy, payment.cancelledBy]);
    return toDetail(payment, names);
  }

  async create(ctx: RequestContext, input: CreateSupplierPaymentInput): Promise<SupplierPaymentDetailDto> {
    const supplier = await this.loadSupplier(ctx.companyId, input.supplierId);
    const currency = await this.loadCurrency(input.currencyId);
    if (input.branchId) await this.assertBranchBelongsToCompany(ctx.companyId, input.branchId);
    const branchId = input.branchId ?? ctx.branchId ?? null;

    const applications = await this.buildApplications(
      ctx.companyId,
      supplier.id,
      currency.id,
      input.amount,
      input.applications,
    );

    const created = await this.prisma.$transaction(async (tx) => {
      const number = await this.nextNumber(tx, ctx.companyId);
      const payment = await tx.supplierPayment.create({
        data: {
          tenantId: ctx.tenantId,
          companyId: ctx.companyId,
          branchId,
          number,
          supplierId: supplier.id,
          currencyId: currency.id,
          occurredAt: input.occurredAt ?? new Date(),
          amount: input.amount,
          paymentMethod: input.paymentMethod,
          externalReference: input.externalReference || null,
          notes: input.notes || null,
          createdBy: ctx.userId,
          applications: {
            create: applications.map((a) => ({ purchaseReceiptId: a.purchaseReceiptId, amount: a.amount })),
          },
        },
      });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'CREATE',
          entityType: 'SupplierPayment',
          entityId: payment.id,
          after: { number: payment.number, supplierId: payment.supplierId, amount: payment.amount.toString(), status: payment.status },
        },
        tx,
      );
      return payment;
    });
    return this.getById(ctx.companyId, created.id);
  }

  async update(ctx: RequestContext, id: string, input: UpdateSupplierPaymentInput): Promise<SupplierPaymentDetailDto> {
    const existing = await this.findScopedOrThrow(ctx.companyId, id);
    if (existing.status !== 'DRAFT') throw new SupplierPaymentNotEditableException();

    let supplier = existing.supplier;
    if (input.supplierId !== undefined && input.supplierId !== existing.supplierId) {
      supplier = await this.loadSupplier(ctx.companyId, input.supplierId);
    }
    let currency = existing.currency;
    if (input.currencyId !== undefined && input.currencyId !== existing.currencyId) {
      currency = await this.loadCurrency(input.currencyId);
    }
    const amount = input.amount ?? existing.amount.toString();

    let rebuiltApplications: BuiltApplication[] | undefined;
    if (input.applications) {
      rebuiltApplications = await this.buildApplications(ctx.companyId, supplier.id, currency.id, amount, input.applications);
    }

    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.SupplierPaymentUncheckedUpdateManyInput = {};
      if (input.supplierId !== undefined) data.supplierId = supplier.id;
      if (input.currencyId !== undefined) data.currencyId = currency.id;
      if (input.occurredAt !== undefined) data.occurredAt = input.occurredAt;
      if (input.amount !== undefined) data.amount = input.amount;
      if (input.paymentMethod !== undefined) data.paymentMethod = input.paymentMethod;
      if (input.externalReference !== undefined) data.externalReference = input.externalReference || null;
      if (input.notes !== undefined) data.notes = input.notes || null;
      data.updatedAt = new Date();

      const guarded = await tx.supplierPayment.updateMany({ where: { id: existing.id, status: 'DRAFT' }, data });
      if (guarded.count === 0) throw new SupplierPaymentNotEditableException();

      if (rebuiltApplications) {
        await tx.supplierPaymentApplication.deleteMany({ where: { supplierPaymentId: existing.id } });
        await tx.supplierPaymentApplication.createMany({
          data: rebuiltApplications.map((a) => ({
            supplierPaymentId: existing.id,
            purchaseReceiptId: a.purchaseReceiptId,
            amount: a.amount,
          })),
        });
      }

      await this.auditService.recordFromContext(
        ctx,
        { action: 'UPDATE', entityType: 'SupplierPayment', entityId: id, metadata: { change: 'draft_updated' } },
        tx,
      );
    });
    return this.getById(ctx.companyId, id);
  }

  async confirm(ctx: RequestContext, id: string): Promise<SupplierPaymentDetailDto> {
    const existing = await this.findScopedOrThrow(ctx.companyId, id);
    if (existing.status === 'CONFIRMED') throw new SupplierPaymentAlreadyConfirmedException();
    if (existing.status !== 'DRAFT') throw new SupplierPaymentNotEditableException();

    await this.prisma.$transaction(async (tx) => {
      const guarded = await tx.supplierPayment.updateMany({
        where: { id, status: 'DRAFT' },
        data: { status: 'CONFIRMED', confirmedAt: new Date(), confirmedBy: ctx.userId },
      });
      if (guarded.count === 0) throw new SupplierPaymentAlreadyConfirmedException();

      const payment = await tx.supplierPayment.findUniqueOrThrow({
        where: { id },
        include: PAYMENT_INCLUDE,
      });

      const purchaseReceiptIds = [...new Set(payment.applications.map((a) => a.purchaseReceiptId))].sort();
      if (purchaseReceiptIds.length > 0) {
        // Same rows PurchaseReceiptsService.cancel() locks — see the class
        // doc comment above for why this fully serializes the
        // confirm-vs-cancel race.
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM purchase_receipts WHERE id IN (${Prisma.join(purchaseReceiptIds)}) FOR UPDATE`,
        );
        const outstandingByReceipt = await this.supplierAccountService.getReceiptsOutstanding(tx, ctx.companyId, purchaseReceiptIds);
        for (const purchaseReceiptId of purchaseReceiptIds) {
          const outstanding = outstandingByReceipt.get(purchaseReceiptId) ?? new Prisma.Decimal(0);
          if (outstanding.lt(0)) throw new SupplierPaymentOverApplicationException();
        }
      }

      await this.supplierAccountService.postPayment(tx, {
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        supplierId: payment.supplierId,
        currencyId: payment.currencyId,
        supplierPaymentId: payment.id,
        supplierPaymentNumber: payment.number,
        amount: payment.amount.toString(),
        occurredAt: payment.occurredAt,
        createdBy: ctx.userId,
      });

      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'CONFIRM',
          entityType: 'SupplierPayment',
          entityId: id,
          metadata: { change: 'payment_confirmed', number: payment.number, supplierName: payment.supplier.legalName, amount: payment.amount.toString() },
        },
        tx,
      );
    });

    this.realtimePublisher.supplierPaymentConfirmed(ctx.companyId, id);
    this.realtimePublisher.supplierAccountChanged(ctx.companyId, existing.supplierId);
    return this.getById(ctx.companyId, id);
  }

  async cancel(ctx: RequestContext, id: string): Promise<SupplierPaymentDetailDto> {
    const existing = await this.findScopedOrThrow(ctx.companyId, id);
    if (existing.status === 'CANCELLED') throw new SupplierPaymentAlreadyCancelledException();

    if (existing.status === 'DRAFT') {
      await this.prisma.$transaction(async (tx) => {
        const guarded = await tx.supplierPayment.updateMany({
          where: { id, status: 'DRAFT' },
          data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: ctx.userId },
        });
        if (guarded.count === 0) throw new SupplierPaymentAlreadyCancelledException();
        await this.auditService.recordFromContext(
          ctx,
          { action: 'CANCEL', entityType: 'SupplierPayment', entityId: id, metadata: { change: 'draft_cancelled', number: existing.number } },
          tx,
        );
      });
      this.realtimePublisher.supplierPaymentCancelled(ctx.companyId, id);
      return this.getById(ctx.companyId, id);
    }

    await this.prisma.$transaction(async (tx) => {
      const guarded = await tx.supplierPayment.updateMany({
        where: { id, status: 'CONFIRMED' },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: ctx.userId },
      });
      if (guarded.count === 0) throw new SupplierPaymentAlreadyCancelledException();

      await this.supplierAccountService.postPaymentReversal(tx, {
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        supplierId: existing.supplierId,
        currencyId: existing.currencyId,
        supplierPaymentId: existing.id,
        supplierPaymentNumber: existing.number,
        amount: existing.amount.toString(),
        occurredAt: new Date(),
        createdBy: ctx.userId,
      });

      await this.auditService.recordFromContext(
        ctx,
        { action: 'CANCEL', entityType: 'SupplierPayment', entityId: id, metadata: { change: 'confirmed_payment_cancelled', number: existing.number } },
        tx,
      );
    });

    this.realtimePublisher.supplierPaymentCancelled(ctx.companyId, id);
    this.realtimePublisher.supplierAccountChanged(ctx.companyId, existing.supplierId);
    return this.getById(ctx.companyId, id);
  }

  // ---------- Internal helpers ----------

  private async loadSupplier(companyId: string, id: string): Promise<Supplier> {
    const supplier = await this.prisma.supplier.findFirst({ where: { id, companyId } });
    if (!supplier) throw new SupplierNotFoundException();
    return supplier;
  }

  private async loadCurrency(id: string): Promise<Currency> {
    const currency = await this.prisma.currency.findFirst({ where: { id, active: true } });
    if (!currency) throw new CurrencyNotFoundException();
    return currency;
  }

  private async assertBranchBelongsToCompany(companyId: string, branchId: string): Promise<void> {
    const found = await this.prisma.branch.findFirst({ where: { id: branchId, companyId } });
    if (!found) throw new SupplierPaymentInvalidBranchException();
  }

  private async buildApplications(
    companyId: string,
    supplierId: string,
    currencyId: string,
    paymentAmount: string,
    inputApplications: { purchaseReceiptId: string; amount: string }[],
  ): Promise<BuiltApplication[]> {
    if (inputApplications.length === 0) return [];
    const purchaseReceiptIds = inputApplications.map((a) => a.purchaseReceiptId);
    const receipts = await this.prisma.purchaseReceipt.findMany({ where: { id: { in: purchaseReceiptIds }, companyId } });
    const receiptById = new Map(receipts.map((r) => [r.id, r]));

    let sumApplied = new Prisma.Decimal(0);
    const built: BuiltApplication[] = [];
    for (const application of inputApplications) {
      const receipt = receiptById.get(application.purchaseReceiptId);
      if (!receipt || receipt.supplierId !== supplierId) throw new SupplierPaymentApplicationReceiptMismatchException();
      if (receipt.status !== 'CONFIRMED') throw new SupplierPaymentApplicationReceiptNotConfirmedException();
      if (receipt.currencyId !== currencyId) throw new SupplierPaymentApplicationCurrencyMismatchException();
      sumApplied = sumApplied.add(application.amount);
      built.push({ purchaseReceiptId: receipt.id, amount: application.amount });
    }
    if (sumApplied.gt(paymentAmount)) throw new SupplierPaymentApplicationsExceedAmountException();

    const outstandingByReceipt = await this.supplierAccountService.getReceiptsOutstanding(this.prisma, companyId, purchaseReceiptIds);
    for (const application of built) {
      const outstanding = outstandingByReceipt.get(application.purchaseReceiptId) ?? new Prisma.Decimal(0);
      if (new Prisma.Decimal(application.amount).gt(outstanding)) throw new SupplierPaymentOverApplicationException();
    }
    return built;
  }

  private async findScopedOrThrow(companyId: string, id: string): Promise<PaymentWithRelations> {
    const payment = await this.prisma.supplierPayment.findFirst({ where: { id, companyId }, include: PAYMENT_INCLUDE });
    if (!payment) throw new SupplierPaymentNotFoundException();
    return payment;
  }

  private async resolveUserNames(userIds: (string | null)[]): Promise<Map<string, string>> {
    const ids = [...new Set(userIds.filter((id): id is string => !!id))];
    if (ids.length === 0) return new Map();
    const users = await this.prisma.user.findMany({ where: { id: { in: ids } } });
    return new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
  }

  private async nextNumber(tx: Prisma.TransactionClient, companyId: string): Promise<string> {
    const seq = await tx.supplierPaymentSequence.upsert({
      where: { companyId },
      create: { companyId, lastValue: 1 },
      update: { lastValue: { increment: 1 } },
    });
    return `PAG-${String(seq.lastValue).padStart(6, '0')}`;
  }
}
