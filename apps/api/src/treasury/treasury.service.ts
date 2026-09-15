import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
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

    // ONE lock protocol: every writer to an account holds that account's
    // advisory lock for the rest of its transaction — this method, the
    // opening balance, transfers, Cobros, Pagos and the rebuild alike.
    // Taking it here rather than only in the callers is what makes that
    // true by construction instead of by everyone remembering.
    //
    // Re-entrant: a transfer already holding both locks (in stable order,
    // to avoid the A->B / B->A deadlock) just takes this one again for
    // free.
    await this.lockAccountsInStableOrder(tx, ctx.companyId, [account.id]);

    // `ON CONFLICT DO NOTHING` and NOT a caught P2002.
    //
    // A unique violation aborts the whole PostgreSQL transaction — every
    // later statement fails with "current transaction is aborted" — and
    // catching the error in TypeScript does not undo that. Measured: a
    // caught P2002 followed by another write inside the same transaction
    // blows up on the write. The earlier version of this method only
    // looked correct because its test did nothing else in that
    // transaction, while the real callers (a Cobro's confirm, a
    // transfer's) all write before and after.
    //
    // So the duplicate must never raise in the first place. The insert
    // returns no row instead, which is the same answer without the
    // damage.
    const id = randomUUID();
    const inserted = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      INSERT INTO treasury_movements (
        "id", "tenantId", "companyId", "branchId", "treasuryAccountId",
        "currencyId", "movementType", "amount", "occurredAt",
        "sourceType", "sourceId", "reversalOfId", "description", "notes",
        "createdBy"
      ) VALUES (
        ${id}::uuid,
        ${ctx.tenantId}::uuid,
        ${ctx.companyId}::uuid,
        ${account.branchId ?? ctx.branchId ?? null}::uuid,
        ${account.id}::uuid,
        ${account.currencyId}::uuid,
        ${params.movementType}::"TreasuryMovementType",
        ${params.amount}::decimal,
        ${params.occurredAt}::timestamptz,
        ${params.sourceType},
        ${params.sourceId}::uuid,
        ${params.reversalOfId ?? null}::uuid,
        ${params.description ?? null},
        ${params.notes ?? null},
        ${ctx.userId ?? null}::uuid
      )
      ON CONFLICT ("companyId", "sourceType", "sourceId", "movementType")
      DO NOTHING
      RETURNING "id"
    `);

    // No row: the movement was already there. That is a success, not an
    // error — the ledger already says what the caller wanted it to say —
    // and the balance was already moved by whoever posted it first.
    if (inserted.length === 0) return null;

    // Single atomic upsert-increment, never read-modify-write. The
    // advisory lock above already serialized every other treasury writer
    // on this account; the increment keeps it correct even against
    // anything that has not been taught the protocol yet.
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

    return tx.treasuryMovement.findUniqueOrThrow({ where: { id } });
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
   * Recomputes every balance from the ledger — the documented recovery
   * path for the one failure this design admits: a projection that
   * drifted from the movements it summarises.
   *
   * **It takes the same locks every writer takes, per account, and sums
   * inside the same transaction that writes.** Summing outside and
   * writing after would let a Cobro confirmed in between be silently
   * overwritten by a total computed before it existed — a "repair" that
   * loses money is worse than the drift it set out to fix.
   *
   * Accounts are handled one at a time so a rebuild never holds every
   * lock in the company at once and stalls the whole treasury.
   *
   * Returns how many account balances it wrote.
   */
  async rebuildTreasuryBalances(companyId?: string): Promise<number> {
    const accounts = await this.prisma.treasuryAccount.findMany({
      where: companyId ? { companyId } : {},
      select: { id: true, companyId: true },
      orderBy: { id: 'asc' },
    });

    let written = 0;
    for (const account of accounts) {
      await this.prisma.$transaction(async (tx) => {
        await this.lockAccountsInStableOrder(tx, account.companyId, [
          account.id,
        ]);

        // Read AFTER the lock, so the sum cannot miss a movement that
        // commits while this is running.
        const sum = await tx.treasuryMovement.aggregate({
          where: { treasuryAccountId: account.id },
          _sum: { amount: true },
        });
        const balance = sum._sum.amount ?? new Prisma.Decimal(0);

        await tx.treasuryAccountBalance.upsert({
          where: { treasuryAccountId: account.id },
          create: {
            companyId: account.companyId,
            treasuryAccountId: account.id,
            balance,
          },
          update: { balance },
        });
        written += 1;
      });
    }

    return written;
  }

  /**
   * Takes one advisory lock per account, in a globally stable order.
   *
   * Two writers touching the same accounts in opposite orders — a
   * caja->banco transfer against a banco->caja one — would otherwise each
   * hold what the other needs and deadlock. Every transaction acquiring
   * the keys in the same sequence means one simply waits.
   *
   * **The order is over the 64-bit keys, not over the strings.** Sorting
   * the strings and then hashing does not give a consistent order,
   * because the hash does not preserve it: two transactions locking
   * {A,B} could still take them in opposite orders and deadlock — the
   * exact failure the sort exists to prevent. So the keys are computed
   * first and sorted as numbers.
   *
   * `hashtextextended` and not `hashtext`: 64 bits, which is what
   * `pg_advisory_xact_lock` takes, and a collision space wide enough that
   * two unrelated accounts blocking each other is not something to think
   * about. With `hashtext`'s 32 bits it would be, at a few tens of
   * thousands of accounts.
   *
   * Advisory locks rather than `SELECT ... FOR UPDATE` because the
   * balance row may not exist yet, which is precisely the case of an
   * account whose first movement is the one being written.
   */
  async lockAccountsInStableOrder(
    tx: Prisma.TransactionClient,
    companyId: string,
    accountIds: string[],
  ): Promise<void> {
    const names = [
      ...new Set(accountIds.map((id) => `treasury:${companyId}:${id}`)),
    ];
    if (names.length === 0) return;

    const rows = await tx.$queryRaw<{ key: bigint }[]>(Prisma.sql`
      SELECT DISTINCT hashtextextended(name, 0) AS key
      FROM unnest(${names}::text[]) AS t(name)
      ORDER BY key
    `);

    for (const { key } of rows) {
      // $executeRaw, not $queryRaw: pg_advisory_xact_lock returns `void`,
      // which Prisma cannot deserialize as a result column.
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${key})`);
    }
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
