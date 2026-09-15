import { Injectable } from '@nestjs/common';
import type {
  CreateTreasuryTransferInput,
  UpdateTreasuryTransferInput,
  TreasuryTransferDto,
  TreasuryTransfersQuery,
  TreasuryTransfersResponse,
} from '@erp/shared';
import { Prisma } from '../generated/prisma/client';
import type {
  Currency,
  TreasuryAccount,
  TreasuryTransfer,
} from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../company-context/types';
import { TreasuryService } from './treasury.service';
import {
  TreasuryAccountInactiveException,
  TreasuryCurrencyMismatchException,
  TreasuryTransferNotConfirmedException,
  TreasuryTransferNotDraftException,
  TreasuryTransferNotFoundException,
  TreasuryTransferSameAccountException,
} from './treasury.exceptions';

type TransferWithRelations = TreasuryTransfer & {
  sourceAccount: TreasuryAccount;
  destinationAccount: TreasuryAccount;
  currency: Currency;
};

const TRANSFER_INCLUDE = {
  sourceAccount: true,
  destinationAccount: true,
  currency: true,
} satisfies Prisma.TreasuryTransferInclude;

function toDto(t: TransferWithRelations): TreasuryTransferDto {
  return {
    id: t.id,
    number: t.number,
    status: t.status,
    sourceAccountId: t.sourceAccountId,
    sourceAccountName: t.sourceAccount.name,
    destinationAccountId: t.destinationAccountId,
    destinationAccountName: t.destinationAccount.name,
    currencyId: t.currencyId,
    currencyCode: t.currency.code,
    amount: t.amount.toFixed(2),
    occurredAt: t.occurredAt.toISOString(),
    notes: t.notes,
    confirmedAt: t.confirmedAt?.toISOString() ?? null,
    cancelledAt: t.cancelledAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
  };
}

/**
 * Transfers between two of the company's own treasury accounts — the
 * daily "deposit the till at the bank". See docs/treasury.md.
 *
 * The shape is `StockTransfersService`'s, deliberately, including the two
 * defects that module had to learn the hard way (PR #39):
 *
 * 1. The status flip is a **conditional** `updateMany ... WHERE status =
 *    'DRAFT'`, done FIRST, so a concurrent or retried confirm cannot
 *    write the movements twice.
 * 2. That update **always writes `updatedAt`**, because an update whose
 *    `data` ends up empty takes no row lock at all — which is exactly
 *    what made the equivalent guard decorative until it was measured.
 *
 * And the document is re-read INSIDE the transaction after the guard, so
 * the movements come from the version that was actually confirmed rather
 * than from a snapshot a concurrent edit may have invalidated.
 */
@Injectable()
export class TreasuryTransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly treasury: TreasuryService,
  ) {}

  async list(
    companyId: string,
    query: TreasuryTransfersQuery,
  ): Promise<TreasuryTransfersResponse> {
    const where: Prisma.TreasuryTransferWhereInput = {
      companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.accountId
        ? {
            OR: [
              { sourceAccountId: query.accountId },
              { destinationAccountId: query.accountId },
            ],
          }
        : {}),
    };

    const [total, transfers] = await Promise.all([
      this.prisma.treasuryTransfer.count({ where }),
      this.prisma.treasuryTransfer.findMany({
        where,
        include: TRANSFER_INCLUDE,
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      transfers: transfers.map(toDto),
      pagination: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  async getById(companyId: string, id: string): Promise<TreasuryTransferDto> {
    const transfer = await this.prisma.treasuryTransfer.findFirst({
      where: { id, companyId },
      include: TRANSFER_INCLUDE,
    });
    if (!transfer) throw new TreasuryTransferNotFoundException();
    return toDto(transfer);
  }

  /** A draft moves no money — the ledger is untouched until `confirm()`. */
  async create(
    ctx: RequestContext,
    input: CreateTreasuryTransferInput,
  ): Promise<TreasuryTransferDto> {
    const created = await this.prisma.$transaction(async (tx) => {
      const { source, destination } = await this.loadPair(
        tx,
        ctx.companyId,
        input.sourceAccountId,
        input.destinationAccountId,
      );

      const transfer = await tx.treasuryTransfer.create({
        data: {
          tenantId: ctx.tenantId,
          companyId: ctx.companyId,
          branchId: ctx.branchId ?? null,
          number: await this.nextNumber(tx, ctx.companyId),
          sourceAccountId: source.id,
          destinationAccountId: destination.id,
          currencyId: source.currencyId,
          amount: new Prisma.Decimal(input.amount),
          occurredAt: input.occurredAt
            ? new Date(input.occurredAt)
            : new Date(),
          notes: input.notes ?? null,
          createdBy: ctx.userId,
        },
      });

      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'CREATE',
          entityType: 'TreasuryTransfer',
          entityId: transfer.id,
          after: {
            number: transfer.number,
            sourceAccountId: source.id,
            destinationAccountId: destination.id,
            amount: transfer.amount.toFixed(2),
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
    input: UpdateTreasuryTransferInput,
  ): Promise<TreasuryTransferDto> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await this.findScopedOrThrowTx(tx, ctx.companyId, id);

      const sourceId = input.sourceAccountId ?? existing.sourceAccountId;
      const destinationId =
        input.destinationAccountId ?? existing.destinationAccountId;
      const { source } = await this.loadPair(
        tx,
        ctx.companyId,
        sourceId,
        destinationId,
      );

      // `Unchecked...` and not the checked variant: this writes the FK
      // scalars directly, which the relation-aware input type excludes.
      const data: Prisma.TreasuryTransferUncheckedUpdateManyInput = {
        sourceAccountId: sourceId,
        destinationAccountId: destinationId,
        currencyId: source.currencyId,
        ...(input.amount ? { amount: new Prisma.Decimal(input.amount) } : {}),
        ...(input.occurredAt ? { occurredAt: new Date(input.occurredAt) } : {}),
        ...(input.notes === undefined ? {} : { notes: input.notes }),
        // Always written, never left to `@updatedAt`: a PATCH that
        // changes nothing else would otherwise produce an empty `data`,
        // and an update with nothing to SET takes no row lock — which is
        // precisely what made this guard useless on StockTransfer.
        updatedAt: new Date(),
      };

      const guarded = await tx.treasuryTransfer.updateMany({
        where: { id: existing.id, companyId: ctx.companyId, status: 'DRAFT' },
        data,
      });
      if (guarded.count === 0) throw new TreasuryTransferNotDraftException();

      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'UPDATE',
          entityType: 'TreasuryTransfer',
          entityId: existing.id,
          after: {
            sourceAccountId: sourceId,
            destinationAccountId: destinationId,
            amount: input.amount ?? existing.amount.toFixed(2),
          },
        },
        tx,
      );
    });

    return this.getById(ctx.companyId, id);
  }

  /**
   * Writes BOTH movements, in one transaction, the OUT first — so the
   * source is debited before the destination is credited and an
   * insufficient-funds rejection rolls the whole thing back rather than
   * leaving money that arrived from nowhere.
   */
  async confirm(ctx: RequestContext, id: string): Promise<TreasuryTransferDto> {
    await this.prisma.$transaction(async (tx) => {
      // The guard runs FIRST and is conditional on DRAFT: a second
      // terminal confirming the same document at the same moment gets
      // zero rows and stops here, before any movement is written.
      const guarded = await tx.treasuryTransfer.updateMany({
        where: { id, companyId: ctx.companyId, status: 'DRAFT' },
        data: {
          status: 'CONFIRMED',
          confirmedAt: new Date(),
          confirmedBy: ctx.userId,
          updatedAt: new Date(),
        },
      });
      if (guarded.count === 0) throw new TreasuryTransferNotDraftException();

      // Re-read inside the transaction, after the guard: the movements
      // must describe the version that was actually confirmed, not a
      // snapshot a concurrent edit could have replaced.
      const transfer = await this.findScopedOrThrowTx(tx, ctx.companyId, id);
      const { source, destination } = await this.loadPair(
        tx,
        ctx.companyId,
        transfer.sourceAccountId,
        transfer.destinationAccountId,
      );

      await this.treasury.lockAccountsInStableOrder(tx, ctx.companyId, [
        source.id,
        destination.id,
      ]);

      const movementCtx = {
        companyId: ctx.companyId,
        tenantId: ctx.tenantId,
        branchId: ctx.branchId,
        userId: ctx.userId,
      };
      const common = {
        occurredAt: transfer.occurredAt,
        sourceType: 'TreasuryTransfer',
        sourceId: transfer.id,
        currencyId: transfer.currencyId,
      };

      await this.treasury.post(tx, movementCtx, {
        ...common,
        treasuryAccountId: source.id,
        movementType: 'TRANSFER_OUT',
        amount: transfer.amount.negated(),
        description: `Transferencia ${transfer.number} a ${destination.name}`,
      });
      await this.treasury.post(tx, movementCtx, {
        ...common,
        treasuryAccountId: destination.id,
        movementType: 'TRANSFER_IN',
        amount: transfer.amount,
        description: `Transferencia ${transfer.number} desde ${source.name}`,
      });

      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'CONFIRM',
          entityType: 'TreasuryTransfer',
          entityId: transfer.id,
          after: { number: transfer.number, status: 'CONFIRMED' },
        },
        tx,
      );
    });

    return this.getById(ctx.companyId, id);
  }

  /**
   * Appends the inverted pair. Never edits or deletes what was written —
   * the immutability rule the whole ledger rests on.
   */
  async cancel(ctx: RequestContext, id: string): Promise<TreasuryTransferDto> {
    await this.prisma.$transaction(async (tx) => {
      const guarded = await tx.treasuryTransfer.updateMany({
        where: { id, companyId: ctx.companyId, status: 'CONFIRMED' },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledBy: ctx.userId,
          updatedAt: new Date(),
        },
      });
      if (guarded.count === 0) {
        throw new TreasuryTransferNotConfirmedException();
      }

      const transfer = await this.findScopedOrThrowTx(tx, ctx.companyId, id);

      await this.treasury.lockAccountsInStableOrder(tx, ctx.companyId, [
        transfer.sourceAccountId,
        transfer.destinationAccountId,
      ]);

      const movementCtx = {
        companyId: ctx.companyId,
        tenantId: ctx.tenantId,
        branchId: ctx.branchId,
        userId: ctx.userId,
      };
      const common = {
        occurredAt: new Date(),
        sourceType: 'TreasuryTransfer',
        sourceId: transfer.id,
        currencyId: transfer.currencyId,
        // A retired account must still be able to receive the money back.
        allowInactiveAccount: true,
      };

      // Each reversal points back at the movement it undoes, via
      // `reversalOfId`. Without it the self-relation on TreasuryMovement
      // is decorative and a statement cannot say WHICH movement a
      // reversal cancels — only that some reversal happened, which is
      // the question nobody asks.
      const original = await tx.treasuryMovement.findMany({
        where: {
          companyId: ctx.companyId,
          sourceType: 'TreasuryTransfer',
          sourceId: transfer.id,
          movementType: { in: ['TRANSFER_OUT', 'TRANSFER_IN'] },
        },
      });
      const outId = original.find((m) => m.movementType === 'TRANSFER_OUT')?.id;
      const inId = original.find((m) => m.movementType === 'TRANSFER_IN')?.id;

      // The destination gives it back first, mirroring the confirmation:
      // if the money already left the destination and it cannot cover the
      // reversal, the cancellation fails whole rather than half.
      await this.treasury.post(tx, movementCtx, {
        ...common,
        treasuryAccountId: transfer.destinationAccountId,
        movementType: 'TRANSFER_IN_REVERSAL',
        amount: transfer.amount.negated(),
        description: `Anulación de la transferencia ${transfer.number}`,
        reversalOfId: inId,
      });
      await this.treasury.post(tx, movementCtx, {
        ...common,
        treasuryAccountId: transfer.sourceAccountId,
        movementType: 'TRANSFER_OUT_REVERSAL',
        amount: transfer.amount,
        description: `Anulación de la transferencia ${transfer.number}`,
        reversalOfId: outId,
      });

      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'CANCEL',
          entityType: 'TreasuryTransfer',
          entityId: transfer.id,
          after: { number: transfer.number, status: 'CANCELLED' },
        },
        tx,
      );
    });

    return this.getById(ctx.companyId, id);
  }

  /**
   * Both accounts, validated together: same company, different, both
   * active, and sharing a currency. A transfer never converts, so a
   * mismatch is a rejection.
   */
  private async loadPair(
    tx: Prisma.TransactionClient,
    companyId: string,
    sourceAccountId: string,
    destinationAccountId: string,
  ): Promise<{ source: TreasuryAccount; destination: TreasuryAccount }> {
    if (sourceAccountId === destinationAccountId) {
      throw new TreasuryTransferSameAccountException();
    }
    const source = await this.treasury.findAccountScopedOrThrow(
      tx,
      companyId,
      sourceAccountId,
    );
    const destination = await this.treasury.findAccountScopedOrThrow(
      tx,
      companyId,
      destinationAccountId,
    );
    if (!source.active || !destination.active) {
      throw new TreasuryAccountInactiveException();
    }
    if (source.currencyId !== destination.currencyId) {
      throw new TreasuryCurrencyMismatchException();
    }
    return { source, destination };
  }

  private async findScopedOrThrowTx(
    tx: Prisma.TransactionClient,
    companyId: string,
    id: string,
  ): Promise<TreasuryTransfer> {
    const transfer = await tx.treasuryTransfer.findFirst({
      where: { id, companyId },
    });
    if (!transfer) throw new TreasuryTransferNotFoundException();
    return transfer;
  }

  private async nextNumber(
    tx: Prisma.TransactionClient,
    companyId: string,
  ): Promise<string> {
    const seq = await tx.treasuryTransferSequence.upsert({
      where: { companyId },
      create: { companyId, lastValue: 1 },
      update: { lastValue: { increment: 1 } },
    });
    return `TRF-${String(seq.lastValue).padStart(6, '0')}`;
  }
}
