import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import type {
  TreasuryAccount,
  TreasuryMovement,
  TreasuryMovementType,
} from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import {
  InsufficientTreasuryFundsException,
  InvalidTreasuryAmountException,
  TreasuryAccountInactiveException,
  TreasuryAccountNotFoundException,
  TreasuryCurrencyMismatchException,
} from './treasury.exceptions';

/**
 * What a caller has to say to move money. `sourceType`/`sourceId` name
 * the business document responsible, and together with `movementType`
 * they are the idempotency key — see the `@@unique` on TreasuryMovement.
 */
export interface PostMovementParams {
  treasuryAccountId: string;
  movementType: TreasuryMovementType;
  /** Signed: positive money in, negative money out. Never zero. */
  amount: Prisma.Decimal;
  occurredAt: Date;
  sourceType: string;
  sourceId: string;
  /** The currency the CALLER believes it is moving. Must match the account's. */
  currencyId: string;
  description?: string;
  notes?: string;
  /** The movement this one reverses, when it is a reversal. */
  reversalOfId?: string;
  /**
   * Lets a reversal land on a retired account. Money that already left
   * has to be able to come back even after the drawer was closed;
   * refusing would strand the balance wrong forever.
   */
  allowInactiveAccount?: boolean;
}

export interface PostMovementContext {
  companyId: string;
  tenantId: string;
  branchId?: string;
  userId?: string;
}

/**
 * The treasury ledger.
 *
 * `TreasuryMovement` is the only authoritative record of money entering
 * or leaving an account; `TreasuryAccountBalance` is a projection that
 * `rebuildTreasuryBalances()` can always reconstruct from it. If the two
 * ever disagree, the ledger wins — the same contract
 * `InventoryService` has with `InventoryBalance`, and for the same
 * reason: a stored total is a cache, and a cache is never a source of
 * truth about money.
 *
 * Everything here takes a `Prisma.TransactionClient`, because a treasury
 * movement is never the whole story. Confirming a Cobro has to write the
 * status change, the current-accounts movement and the treasury movement
 * or none of them, so the caller owns the transaction and this service
 * joins it.
 */
@Injectable()
export class TreasuryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Appends one movement and moves the balance, atomically, inside the
   * caller's transaction.
   *
   * Returns `null` when the movement already exists — a retried or
   * concurrent confirm of the same document. That is a success, not an
   * error: the ledger already says what the caller wanted it to say. The
   * decision is delegated to the unique constraint rather than to a
   * read-then-insert, because between the read and the insert is exactly
   * where a second terminal fits.
   */
  async post(
    tx: Prisma.TransactionClient,
    ctx: PostMovementContext,
    params: PostMovementParams,
  ): Promise<TreasuryMovement | null> {
    if (params.amount.isZero() || !params.amount.isFinite()) {
      throw new InvalidTreasuryAmountException();
    }

    const account = await this.findAccountScopedOrThrow(
      tx,
      ctx.companyId,
      params.treasuryAccountId,
    );
    if (!account.active && !params.allowInactiveAccount) {
      throw new TreasuryAccountInactiveException();
    }
    if (account.currencyId !== params.currencyId) {
      throw new TreasuryCurrencyMismatchException();
    }

    let movement: TreasuryMovement;
    try {
      movement = await tx.treasuryMovement.create({
        data: {
          tenantId: ctx.tenantId,
          companyId: ctx.companyId,
          // The account's branch wins over the caller's: a cash box sits
          // where it sits, and a movement posted from another branch's
          // context did not move the drawer.
          branchId: account.branchId ?? ctx.branchId,
          treasuryAccountId: account.id,
          currencyId: account.currencyId,
          movementType: params.movementType,
          amount: params.amount,
          occurredAt: params.occurredAt,
          sourceType: params.sourceType,
          sourceId: params.sourceId,
          reversalOfId: params.reversalOfId,
          description: params.description,
          notes: params.notes,
          createdBy: ctx.userId,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }

    // Single atomic upsert-increment, never read-modify-write: Postgres
    // serializes concurrent writers to this row, so two terminals posting
    // at once cannot both compute their new balance from the same stale
    // read. The policy below is then checked against the value Postgres
    // ACTUALLY returned — see docs/inventory.md, which learned this first.
    const updated = await tx.treasuryAccountBalance.upsert({
      where: { treasuryAccountId: account.id },
      create: {
        companyId: ctx.companyId,
        treasuryAccountId: account.id,
        balance: params.amount,
      },
      update: { balance: { increment: params.amount } },
    });

    if (updated.balance.lt(0) && !account.allowsNegativeBalance) {
      throw new InsufficientTreasuryFundsException();
    }

    return movement;
  }

  /**
   * The projected balance. Zero when the account has no movements yet —
   * which is the truthful answer for an account nobody has put anything
   * into, and the reason an opening balance is an explicit movement
   * rather than a column somebody edits.
   */
  async getBalance(
    companyId: string,
    treasuryAccountId: string,
  ): Promise<Prisma.Decimal> {
    const row = await this.prisma.treasuryAccountBalance.findFirst({
      where: { companyId, treasuryAccountId },
    });
    return row?.balance ?? new Prisma.Decimal(0);
  }

  /**
   * Recomputes every balance from the ledger. The documented recovery
   * path for the one failure this design admits: a projection that
   * drifted from the movements it summarises. It never invents a
   * movement, so running it can only ever make balances agree with
   * history — which is why it is safe to run at any time.
   *
   * Returns how many account balances it wrote.
   */
  async rebuildTreasuryBalances(companyId?: string): Promise<number> {
    const where = companyId ? { companyId } : {};

    const sums = await this.prisma.treasuryMovement.groupBy({
      by: ['companyId', 'treasuryAccountId'],
      where,
      _sum: { amount: true },
    });

    const seen = new Set<string>();
    let written = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const row of sums) {
        const balance = row._sum.amount ?? new Prisma.Decimal(0);
        await tx.treasuryAccountBalance.upsert({
          where: { treasuryAccountId: row.treasuryAccountId },
          create: {
            companyId: row.companyId,
            treasuryAccountId: row.treasuryAccountId,
            balance,
          },
          update: { balance },
        });
        seen.add(row.treasuryAccountId);
        written += 1;
      }

      // An account whose movements were all reversed nets to zero and
      // still has a projection row; one that never had any may have a row
      // from a create that was later rolled back. Both must read zero
      // rather than keep a stale number, so the pass also covers accounts
      // the groupBy could not see.
      const stale = await tx.treasuryAccountBalance.findMany({
        where: {
          ...where,
          treasuryAccountId: { notIn: [...seen] },
          balance: { not: 0 },
        },
      });
      for (const row of stale) {
        await tx.treasuryAccountBalance.update({
          where: { treasuryAccountId: row.treasuryAccountId },
          data: { balance: 0 },
        });
        written += 1;
      }
    });

    return written;
  }

  /**
   * Company-scoped lookup. `findFirst` with the companyId, never
   * `findUnique({ where: { id } })` — see AGENTS.md.
   */
  async findAccountScopedOrThrow(
    tx: Prisma.TransactionClient,
    companyId: string,
    treasuryAccountId: string,
  ): Promise<TreasuryAccount> {
    const account = await tx.treasuryAccount.findFirst({
      where: { id: treasuryAccountId, companyId },
    });
    if (!account) throw new TreasuryAccountNotFoundException();
    return account;
  }
}

/** P2002 — the movement is already in the ledger. */
function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
