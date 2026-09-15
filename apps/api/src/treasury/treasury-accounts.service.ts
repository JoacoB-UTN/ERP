import { Injectable } from '@nestjs/common';
import type {
  CreateTreasuryAccountInput,
  UpdateTreasuryAccountInput,
  SetTreasuryOpeningBalanceInput,
  TreasuryAccountDto,
  TreasuryAccountsQuery,
  TreasuryStatementQuery,
  TreasuryStatementResponse,
} from '@erp/shared';
import { TreasuryAccountType } from '@erp/shared';
import { Prisma } from '../generated/prisma/client';
import type {
  Branch,
  Currency,
  TreasuryAccount,
  TreasuryMovementType,
} from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../company-context/types';
import { BranchAccessInvalidException } from '../company-context/company-context.exceptions';
import { TreasuryService } from './treasury.service';
import {
  CashBoxCannotAllowNegativeException,
  NegativeOpeningBalanceException,
  CurrencyNotFoundException,
  TreasuryAccountCodeAlreadyExistsException,
  TreasuryAccountNotFoundException,
  TreasuryOpeningBalanceAlreadySetException,
} from './treasury.exceptions';

type AccountWithRelations = TreasuryAccount & {
  branch: Branch | null;
  currency: Currency;
  balance: { balance: Prisma.Decimal } | null;
};

const ACCOUNT_INCLUDE = {
  branch: true,
  currency: true,
  balance: true,
} satisfies Prisma.TreasuryAccountInclude;

function toDto(a: AccountWithRelations): TreasuryAccountDto {
  return {
    id: a.id,
    code: a.code,
    name: a.name,
    type: a.type,
    currencyId: a.currencyId,
    currencyCode: a.currency.code,
    currencySymbol: a.currency.symbol,
    branchId: a.branchId,
    branchName: a.branch?.name ?? null,
    allowsNegativeBalance: a.allowsNegativeBalance,
    bankName: a.bankName,
    accountNumber: a.accountNumber,
    cbu: a.cbu,
    alias: a.alias,
    notes: a.notes,
    active: a.active,
    // Zero, not null, when the projection row does not exist yet: an
    // account nobody has put anything into holds nothing, and that is a
    // real answer rather than a missing one.
    // `toString`, not `toFixed(2)`: the column is NUMERIC(19,4) and each
    // currency declares its own precision, so forcing two places here
    // would quietly round a real amount. Formatting is the UI's job.
    balance: (a.balance?.balance ?? new Prisma.Decimal(0)).toString(),
  };
}

/**
 * Treasury account master data and the read surface over the ledger —
 * see docs/treasury.md. The writing of movements lives in
 * `TreasuryService`; this service owns accounts, their statement, and
 * the one movement an account can post about itself: its opening
 * balance.
 */
@Injectable()
export class TreasuryAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly treasury: TreasuryService,
  ) {}

  async list(
    companyId: string,
    query: TreasuryAccountsQuery,
  ): Promise<TreasuryAccountDto[]> {
    const accounts = await this.prisma.treasuryAccount.findMany({
      where: {
        companyId,
        ...(query.includeInactive ? {} : { active: true }),
        ...(query.type ? { type: query.type } : {}),
      },
      include: ACCOUNT_INCLUDE,
      orderBy: [{ type: 'asc' }, { code: 'asc' }],
    });
    return accounts.map(toDto);
  }

  async getById(companyId: string, id: string): Promise<TreasuryAccountDto> {
    const account = await this.prisma.treasuryAccount.findFirst({
      where: { id, companyId },
      include: ACCOUNT_INCLUDE,
    });
    if (!account) throw new TreasuryAccountNotFoundException();
    return toDto(account);
  }

  async create(
    ctx: RequestContext,
    input: CreateTreasuryAccountInput,
  ): Promise<TreasuryAccountDto> {
    if (
      input.type === TreasuryAccountType.CASH_BOX &&
      input.allowsNegativeBalance
    ) {
      throw new CashBoxCannotAllowNegativeException();
    }

    await this.assertCurrencyExists(input.currencyId);
    if (input.branchId)
      await this.assertBranchInCompany(ctx.companyId, input.branchId);
    await this.assertCodeIsFree(ctx.companyId, input.code);

    // The P2002 is translated OUTSIDE the transaction, deliberately.
    // Catching it inside would be the same mistake the ledger's
    // idempotency had: a unique violation aborts the whole PostgreSQL
    // transaction, so the audit write after it would fail anyway. By the
    // time this catch runs the transaction has already rolled back and
    // there is nothing left to damage — the only thing left to do is give
    // the race a decent error instead of a 500.
    //
    // `assertCodeIsFree` above still does the friendly check; this closes
    // the window between that check and the insert.
    const created = await this.createInTransaction(ctx, input).catch(
      (error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new TreasuryAccountCodeAlreadyExistsException();
        }
        throw error;
      },
    );

    return this.getById(ctx.companyId, created.id);
  }

  private async createInTransaction(
    ctx: RequestContext,
    input: CreateTreasuryAccountInput,
  ): Promise<TreasuryAccount> {
    return this.prisma.$transaction(async (tx) => {
      const account = await tx.treasuryAccount.create({
        data: {
          tenantId: ctx.tenantId,
          companyId: ctx.companyId,
          branchId: input.branchId ?? null,
          code: input.code,
          name: input.name,
          type: input.type,
          currencyId: input.currencyId,
          allowsNegativeBalance: input.allowsNegativeBalance ?? false,
          bankName: input.bankName ?? null,
          accountNumber: input.accountNumber ?? null,
          cbu: input.cbu ?? null,
          alias: input.alias ?? null,
          notes: input.notes ?? null,
          createdBy: ctx.userId,
        },
      });

      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'CREATE',
          entityType: 'TreasuryAccount',
          entityId: account.id,
          after: {
            code: account.code,
            name: account.name,
            type: account.type,
            currencyId: account.currencyId,
            branchId: account.branchId,
            allowsNegativeBalance: account.allowsNegativeBalance,
          },
        },
        tx,
      );
      return account;
    });
  }

  async update(
    ctx: RequestContext,
    id: string,
    input: UpdateTreasuryAccountInput,
  ): Promise<TreasuryAccountDto> {
    const existing = await this.prisma.treasuryAccount.findFirst({
      where: { id, companyId: ctx.companyId },
    });
    if (!existing) throw new TreasuryAccountNotFoundException();

    const nextAllowsNegative =
      input.allowsNegativeBalance ?? existing.allowsNegativeBalance;
    // `type` is immutable, so this reads the stored one — a cash box can
    // never acquire an overdraft by editing a flag.
    if (existing.type === TreasuryAccountType.CASH_BOX && nextAllowsNegative) {
      throw new CashBoxCannotAllowNegativeException();
    }

    if (input.branchId)
      await this.assertBranchInCompany(ctx.companyId, input.branchId);

    const before = pickAuditFields(existing);

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.treasuryAccount.update({
        where: { id: existing.id },
        data: {
          name: input.name ?? undefined,
          // `=== undefined` and not `??` for every nullable field: `??`
          // would swallow an explicit null, which is how the client says
          // "clear this". A wrong CBU has to be removable, not only
          // overwritable.
          branchId: input.branchId === undefined ? undefined : input.branchId,
          allowsNegativeBalance: input.allowsNegativeBalance ?? undefined,
          bankName: input.bankName === undefined ? undefined : input.bankName,
          accountNumber:
            input.accountNumber === undefined ? undefined : input.accountNumber,
          cbu: input.cbu === undefined ? undefined : input.cbu,
          alias: input.alias === undefined ? undefined : input.alias,
          notes: input.notes === undefined ? undefined : input.notes,
          active: input.active ?? undefined,
        },
      });

      const after = pickAuditFields(updated);
      const changed = diffFields(before, after);
      if (Object.keys(changed.after).length > 0) {
        await this.auditService.recordFromContext(
          ctx,
          {
            action:
              input.active === false
                ? 'DEACTIVATE'
                : input.active === true
                  ? 'ACTIVATE'
                  : 'UPDATE',
            entityType: 'TreasuryAccount',
            entityId: updated.id,
            before: changed.before,
            after: changed.after,
          },
          tx,
        );
      }
    });

    return this.getById(ctx.companyId, id);
  }

  /**
   * Records what was already in the account when it was loaded into the
   * system, as a real ledger movement.
   *
   * Only once, and only while the ledger is empty. A second "opening"
   * after money has moved would be a correction wearing the wrong name,
   * and the balance would stop being explainable by its own history —
   * which is the entire point of keeping a ledger.
   */
  async setOpeningBalance(
    ctx: RequestContext,
    id: string,
    input: SetTreasuryOpeningBalanceInput,
  ): Promise<TreasuryAccountDto> {
    await this.prisma.$transaction(async (tx) => {
      const account = await this.treasury.findAccountScopedOrThrow(
        tx,
        ctx.companyId,
        id,
      );

      // Under the lock BEFORE the count, and the same lock every other
      // writer takes. Otherwise a transfer, Cobro or Pago could post the
      // account's first movement between this check and the insert, and
      // the "opening" balance would land on top of it — an opening that
      // is not the opening.
      await this.treasury.lockAccountsInStableOrder(tx, ctx.companyId, [
        account.id,
      ]);

      // Rejected here, with its own message, rather than letting the
      // sign policy in `post` answer "insufficient funds" — which is not
      // what happened.
      if (
        new Prisma.Decimal(input.amount).lt(0) &&
        !account.allowsNegativeBalance
      ) {
        throw new NegativeOpeningBalanceException();
      }

      const existingMovements = await tx.treasuryMovement.count({
        where: { companyId: ctx.companyId, treasuryAccountId: account.id },
      });
      if (existingMovements > 0) {
        throw new TreasuryOpeningBalanceAlreadySetException();
      }

      const movement = await this.treasury.post(
        tx,
        {
          companyId: ctx.companyId,
          tenantId: ctx.tenantId,
          branchId: ctx.branchId,
          userId: ctx.userId,
        },
        {
          treasuryAccountId: account.id,
          movementType: 'OPENING_BALANCE',
          amount: new Prisma.Decimal(input.amount),
          occurredAt: input.occurredAt
            ? new Date(input.occurredAt)
            : new Date(),
          // The account is its own source: nothing else caused this.
          sourceType: 'TreasuryAccount',
          sourceId: account.id,
          currencyId: account.currencyId,
          description: 'Saldo de apertura',
          notes: input.notes,
        },
      );

      // `post` returns null only when the movement already existed, and
      // the count above already ruled that out inside this transaction.
      if (movement) {
        await this.auditService.recordFromContext(
          ctx,
          {
            action: 'CREATE',
            entityType: 'TreasuryMovement',
            entityId: movement.id,
            after: {
              treasuryAccountId: account.id,
              movementType: 'OPENING_BALANCE',
              amount: movement.amount.toString(),
            },
          },
          tx,
        );
      }
    });

    return this.getById(ctx.companyId, id);
  }

  /**
   * The account statement: movements oldest-first with the balance after
   * each one.
   *
   * The running balance is computed from the ledger itself rather than
   * read from the projection, so a statement is internally consistent
   * even if the projection had drifted — and so a reader can see the
   * drift instead of being reassured by a total that disagrees with the
   * rows above it.
   */
  async getStatement(
    companyId: string,
    id: string,
    query: TreasuryStatementQuery,
  ): Promise<TreasuryStatementResponse> {
    const account = await this.getById(companyId, id);

    // The running balance is a WINDOW over every movement of the account,
    // computed BEFORE the filters are applied.
    //
    // The filters decide which rows are shown; they must not decide where
    // the running total starts. Summing only the filtered rows made
    // "movements of type PAYMENT since March" read as though the account
    // had been empty in February — a number that looks like a balance and
    // is not one.
    //
    // Raw SQL because Prisma has no window functions. The ordering is the
    // same deterministic one the page uses.
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to) : null;
    const movementType = query.movementType ?? null;
    const skip = (query.page - 1) * query.pageSize;

    const filter = Prisma.sql`
      (${movementType}::text IS NULL
        OR "movementType"::text = ${movementType}::text)
      AND (${from}::timestamptz IS NULL OR "occurredAt" >= ${from}::timestamptz)
      AND (${to}::timestamptz IS NULL OR "occurredAt" <= ${to}::timestamptz)
    `;

    const rowsPromise = this.prisma.$queryRaw<
      {
        id: string;
        treasuryAccountId: string;
        movementType: TreasuryMovementType;
        amount: Prisma.Decimal;
        occurredAt: Date;
        sourceType: string;
        sourceId: string;
        description: string | null;
        notes: string | null;
        reversalOfId: string | null;
        createdAt: Date;
        runningBalance: Prisma.Decimal;
      }[]
    >(Prisma.sql`
      SELECT * FROM (
        SELECT
          "id", "treasuryAccountId", "movementType", "amount", "occurredAt",
          "sourceType", "sourceId", "description", "notes", "reversalOfId",
          "createdAt",
          SUM("amount") OVER (
            ORDER BY "occurredAt", "createdAt", "id"
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS "runningBalance"
        FROM treasury_movements
        WHERE "companyId" = ${companyId}::uuid
          AND "treasuryAccountId" = ${id}::uuid
      ) all_movements
      WHERE ${filter}
      ORDER BY "occurredAt", "createdAt", "id"
      LIMIT ${query.pageSize} OFFSET ${skip}
    `);

    const totalPromise = this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
      SELECT COUNT(*) AS count
      FROM treasury_movements
      WHERE "companyId" = ${companyId}::uuid
        AND "treasuryAccountId" = ${id}::uuid
        AND ${filter}
    `);

    const [rows, totalRows] = await Promise.all([rowsPromise, totalPromise]);

    return {
      account,
      rows: rows.map((m) => ({
        id: m.id,
        treasuryAccountId: m.treasuryAccountId,
        movementType: m.movementType,
        amount: m.amount.toString(),
        occurredAt: m.occurredAt.toISOString(),
        sourceType: m.sourceType,
        sourceId: m.sourceId,
        description: m.description,
        notes: m.notes,
        reversalOfId: m.reversalOfId,
        createdAt: m.createdAt.toISOString(),
        runningBalance: m.runningBalance.toString(),
      })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total: Number(totalRows[0]?.count ?? 0),
      },
      // Always true for now: no POS sale reaches this ledger yet. It is a
      // field rather than a constant so that wiring POS later flips one
      // expression instead of hunting for hardcoded warnings in the UI.
      excludesPosSales: account.type === TreasuryAccountType.CASH_BOX,
    };
  }

  private async assertCodeIsFree(
    companyId: string,
    code: string,
  ): Promise<void> {
    const existing = await this.prisma.treasuryAccount.findFirst({
      where: { companyId, code },
      select: { id: true },
    });
    if (existing) throw new TreasuryAccountCodeAlreadyExistsException();
  }

  private async assertCurrencyExists(currencyId: string): Promise<void> {
    const currency = await this.prisma.currency.findFirst({
      where: { id: currencyId, active: true },
      select: { id: true },
    });
    if (!currency) throw new CurrencyNotFoundException();
  }

  /** A branch from another company is never a valid target — see docs/multi-company-architecture.md. */
  private async assertBranchInCompany(
    companyId: string,
    branchId: string,
  ): Promise<void> {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, companyId },
      select: { id: true },
    });
    if (!branch) throw new BranchAccessInvalidException();
  }
}

type AuditableAccountFields = Record<
  | 'name'
  | 'branchId'
  | 'allowsNegativeBalance'
  | 'bankName'
  | 'accountNumber'
  | 'cbu'
  | 'alias'
  | 'notes'
  | 'active',
  unknown
>;

function pickAuditFields(a: TreasuryAccount): AuditableAccountFields {
  return {
    name: a.name,
    branchId: a.branchId,
    allowsNegativeBalance: a.allowsNegativeBalance,
    bankName: a.bankName,
    accountNumber: a.accountNumber,
    cbu: a.cbu,
    alias: a.alias,
    notes: a.notes,
    active: a.active,
  };
}

function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: T,
): { before: Partial<T>; after: Partial<T> } {
  const changedBefore: Partial<T> = {};
  const changedAfter: Partial<T> = {};
  for (const key of Object.keys(before) as (keyof T)[]) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changedBefore[key] = before[key];
      changedAfter[key] = after[key];
    }
  }
  return { before: changedBefore, after: changedAfter };
}
