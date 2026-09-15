import { Injectable } from '@nestjs/common';
import type {
  CreateTreasuryAccountInput,
  UpdateTreasuryAccountInput,
  SetTreasuryOpeningBalanceInput,
  TreasuryAccountDto,
  TreasuryAccountsQuery,
  TreasuryStatementQuery,
  TreasuryStatementResponse,
  TreasuryStatementRowDto,
} from '@erp/shared';
import { TreasuryAccountType } from '@erp/shared';
import { Prisma } from '../generated/prisma/client';
import type {
  Branch,
  Currency,
  TreasuryAccount,
} from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../company-context/types';
import { BranchAccessInvalidException } from '../company-context/company-context.exceptions';
import { TreasuryService } from './treasury.service';
import {
  CashBoxCannotAllowNegativeException,
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

/**
 * Oldest first, and fully deterministic: `occurredAt` alone ties whenever
 * two movements share a business date, and a tie makes a running balance
 * non-reproducible between two reads of the same page.
 */
const STATEMENT_ORDER = [
  { occurredAt: 'asc' },
  { createdAt: 'asc' },
  { id: 'asc' },
] satisfies Prisma.TreasuryMovementOrderByWithRelationInput[];

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
    balance: (a.balance?.balance ?? new Prisma.Decimal(0)).toFixed(2),
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

    const created = await this.prisma.$transaction(async (tx) => {
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

    return this.getById(ctx.companyId, created.id);
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
          branchId: input.branchId === undefined ? undefined : input.branchId,
          allowsNegativeBalance: input.allowsNegativeBalance ?? undefined,
          bankName: input.bankName ?? undefined,
          accountNumber: input.accountNumber ?? undefined,
          cbu: input.cbu ?? undefined,
          alias: input.alias ?? undefined,
          notes: input.notes ?? undefined,
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
              amount: movement.amount.toFixed(2),
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

    const where: Prisma.TreasuryMovementWhereInput = {
      companyId,
      treasuryAccountId: id,
      ...(query.movementType ? { movementType: query.movementType } : {}),
      ...(query.from || query.to
        ? {
            occurredAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };

    const skip = (query.page - 1) * query.pageSize;

    const [total, movements] = await Promise.all([
      this.prisma.treasuryMovement.count({ where }),
      this.prisma.treasuryMovement.findMany({
        where,
        orderBy: STATEMENT_ORDER,
        skip,
        take: query.pageSize,
      }),
    ]);

    // Everything before this page, so page 2's running balance continues
    // page 1's instead of restarting at zero. Skipped entirely on page 1
    // — `take: 0` is not "sum nothing", it is a query with no meaningful
    // answer, and asking it would be a bug waiting for a reader.
    let running = new Prisma.Decimal(0);
    if (skip > 0) {
      const previous = await this.prisma.treasuryMovement.aggregate({
        where,
        _sum: { amount: true },
        orderBy: STATEMENT_ORDER,
        take: skip,
      });
      running = previous._sum.amount ?? new Prisma.Decimal(0);
    }

    const rows: TreasuryStatementRowDto[] = movements.map((m) => {
      running = running.add(m.amount);
      return {
        id: m.id,
        treasuryAccountId: m.treasuryAccountId,
        movementType: m.movementType,
        amount: m.amount.toFixed(2),
        occurredAt: m.occurredAt.toISOString(),
        sourceType: m.sourceType,
        sourceId: m.sourceId,
        description: m.description,
        notes: m.notes,
        reversalOfId: m.reversalOfId,
        createdAt: m.createdAt.toISOString(),
        runningBalance: running.toFixed(2),
      };
    });

    return {
      account,
      rows,
      pagination: { page: query.page, pageSize: query.pageSize, total },
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
