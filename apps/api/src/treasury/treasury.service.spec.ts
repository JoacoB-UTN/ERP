import { Prisma } from '../generated/prisma/client';
import type {
  TreasuryAccount,
  TreasuryMovement,
} from '../generated/prisma/client';
import { TreasuryService } from './treasury.service';
import type { PrismaService } from '../database/prisma.service';
import {
  InsufficientTreasuryFundsException,
  InvalidTreasuryAmountException,
  TreasuryAccountInactiveException,
  TreasuryAccountNotFoundException,
  TreasuryCurrencyMismatchException,
} from './treasury.exceptions';

/**
 * The decisions `post()` makes before and after it touches the database.
 * The e2e suite proves the ledger and the balance against a real
 * PostgreSQL; these are the branches that are cheaper and clearer to pin
 * down in isolation — especially the negative-balance one, which has to
 * be checked against what the DATABASE returned rather than against
 * anything this process computed.
 */

const COMPANY = '11111111-1111-1111-1111-111111111111';
const TENANT = '22222222-2222-2222-2222-222222222222';
const ACCOUNT = '33333333-3333-3333-3333-333333333333';
const ARS = '44444444-4444-4444-4444-444444444444';
const USD = '55555555-5555-5555-5555-555555555555';

const ctx = { companyId: COMPANY, tenantId: TENANT, userId: undefined };

function account(overrides: Partial<TreasuryAccount> = {}): TreasuryAccount {
  return {
    id: ACCOUNT,
    tenantId: TENANT,
    companyId: COMPANY,
    branchId: null,
    code: 'CAJA-01',
    name: 'Caja principal',
    type: 'CASH_BOX',
    currencyId: ARS,
    allowsNegativeBalance: false,
    bankName: null,
    accountNumber: null,
    cbu: null,
    alias: null,
    notes: null,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: null,
    ...overrides,
  };
}

/**
 * A transaction client with just the three calls `post()` makes. The
 * balance the upsert returns is the knob the negative-policy tests turn:
 * it stands in for what Postgres decided after serializing every other
 * writer, which is the only value the policy is allowed to trust.
 */
function fakeTx(options: {
  found?: TreasuryAccount | null;
  balanceAfter?: string;
  /** Empty array = the insert hit the unique constraint and did nothing. */
  insertReturns?: { id: string }[];
}) {
  const executeRaw = jest.fn(() => Promise.resolve(1));
  // Two different raw reads: the lock-key query returns keys, the insert
  // returns the new id (or nothing, on conflict). Discriminated by shape
  // so a change to either one is visible here rather than silently
  // matching the wrong branch.
  const queryRaw = jest.fn((sql: { strings?: string[]; sql?: string }) => {
    const text = JSON.stringify(sql);
    if (text.includes('hashtextextended')) {
      return Promise.resolve([{ key: 1n }]);
    }
    return Promise.resolve(options.insertReturns ?? [{ id: 'movement-1' }]);
  });
  const upsert = jest.fn(() =>
    Promise.resolve({
      balance: new Prisma.Decimal(options.balanceAfter ?? '0'),
    }),
  );
  const findUniqueOrThrow = jest.fn(() =>
    Promise.resolve({ id: 'movement-1' } as unknown as TreasuryMovement),
  );
  const tx = {
    $queryRaw: queryRaw,
    $executeRaw: executeRaw,
    treasuryAccount: {
      findFirst: jest.fn(() =>
        Promise.resolve(
          options.found === undefined ? account() : options.found,
        ),
      ),
    },
    treasuryMovement: { findUniqueOrThrow },
    treasuryAccountBalance: { upsert },
  };
  return {
    tx: tx as unknown as Prisma.TransactionClient,
    queryRaw,
    executeRaw,
    upsert,
  };
}

/** JSON.stringify, but tolerant of the BigInt lock keys. */
function sqlText(calls: unknown): string {
  return JSON.stringify(calls, (_key, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
}

function service() {
  return new TreasuryService({} as unknown as PrismaService);
}

const baseParams = {
  treasuryAccountId: ACCOUNT,
  movementType: 'COLLECTION' as const,
  amount: new Prisma.Decimal('100.00'),
  occurredAt: new Date('2026-09-15T10:00:00.000Z'),
  sourceType: 'CustomerCollection',
  sourceId: '66666666-6666-6666-6666-666666666666',
  currencyId: ARS,
};

describe('TreasuryService.post', () => {
  it('writes the movement and moves the balance', async () => {
    const { tx, queryRaw, upsert } = fakeTx({ balanceAfter: '100.00' });
    const movement = await service().post(tx, ctx, baseParams);

    expect(movement).not.toBeNull();
    // The insert never raises on a duplicate — see the ON CONFLICT note
    // in the service. A caught P2002 would abort the transaction.
    const insert = sqlText(queryRaw.mock.calls);
    expect(insert).toContain('ON CONFLICT');
    expect(insert).toContain('DO NOTHING');
    // The increment is handed to Postgres, never computed here from a
    // previous read — that is the whole point.
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { balance: { increment: baseParams.amount } },
      }),
    );
  });

  it('rejects a zero amount rather than writing a movement that means nothing', async () => {
    const { tx, queryRaw } = fakeTx({});
    await expect(
      service().post(tx, ctx, { ...baseParams, amount: new Prisma.Decimal(0) }),
    ).rejects.toBeInstanceOf(InvalidTreasuryAmountException);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('refuses a currency that is not the account’s, instead of converting', async () => {
    const { tx, queryRaw } = fakeTx({});
    await expect(
      service().post(tx, ctx, { ...baseParams, currencyId: USD }),
    ).rejects.toBeInstanceOf(TreasuryCurrencyMismatchException);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('does not reveal an account belonging to another company', async () => {
    const { tx } = fakeTx({ found: null });
    await expect(service().post(tx, ctx, baseParams)).rejects.toBeInstanceOf(
      TreasuryAccountNotFoundException,
    );
  });

  it('refuses to post to a retired account', async () => {
    const { tx } = fakeTx({ found: account({ active: false }) });
    await expect(service().post(tx, ctx, baseParams)).rejects.toBeInstanceOf(
      TreasuryAccountInactiveException,
    );
  });

  it('lets a reversal reach a retired account', async () => {
    // Money that already left has to be able to come back after the
    // drawer was closed; refusing would strand the balance wrong forever.
    const { tx } = fakeTx({
      found: account({ active: false }),
      balanceAfter: '0.00',
    });
    await expect(
      service().post(tx, ctx, {
        ...baseParams,
        movementType: 'COLLECTION_REVERSAL',
        amount: new Prisma.Decimal('-100.00'),
        allowInactiveAccount: true,
      }),
    ).resolves.not.toBeNull();
  });

  describe('the negative-balance policy', () => {
    it('rejects a cash box going below zero', async () => {
      const { tx } = fakeTx({ balanceAfter: '-0.01' });
      await expect(
        service().post(tx, ctx, {
          ...baseParams,
          movementType: 'PAYMENT',
          amount: new Prisma.Decimal('-100.00'),
        }),
      ).rejects.toBeInstanceOf(InsufficientTreasuryFundsException);
    });

    it('allows a bank account with an overdraft to go below zero', async () => {
      const { tx } = fakeTx({
        found: account({ type: 'BANK_ACCOUNT', allowsNegativeBalance: true }),
        balanceAfter: '-500.00',
      });
      await expect(
        service().post(tx, ctx, {
          ...baseParams,
          movementType: 'PAYMENT',
          amount: new Prisma.Decimal('-500.00'),
        }),
      ).resolves.not.toBeNull();
    });

    it('rejects a bank account without an overdraft', async () => {
      const { tx } = fakeTx({
        found: account({ type: 'BANK_ACCOUNT', allowsNegativeBalance: false }),
        balanceAfter: '-1.00',
      });
      await expect(
        service().post(tx, ctx, {
          ...baseParams,
          movementType: 'PAYMENT',
          amount: new Prisma.Decimal('-1.00'),
        }),
      ).rejects.toBeInstanceOf(InsufficientTreasuryFundsException);
    });

    it('judges the policy on what the database returned, not on the delta', async () => {
      // The caller is taking money OUT, but by the time Postgres applied
      // the increment another writer had put more in, so the account is
      // positive. A check against the delta — or against a balance read
      // before the update — would wrongly reject this.
      const { tx } = fakeTx({ balanceAfter: '250.00' });
      await expect(
        service().post(tx, ctx, {
          ...baseParams,
          movementType: 'PAYMENT',
          amount: new Prisma.Decimal('-100.00'),
        }),
      ).resolves.not.toBeNull();
    });
  });

  it('treats an already-posted movement as success, not as an error', async () => {
    // A retried confirm. The insert conflicts and returns no row, so the
    // ledger already says what the caller wanted — and, crucially, the
    // transaction is still usable for everything the caller does next.
    const { tx, upsert } = fakeTx({ insertReturns: [] });

    await expect(service().post(tx, ctx, baseParams)).resolves.toBeNull();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('locks the account before touching the ledger', async () => {
    // One protocol: every writer holds the account's lock. `post` takes
    // it itself so the rule does not depend on each caller remembering.
    const { tx, queryRaw, executeRaw } = fakeTx({ balanceAfter: '100.00' });
    await service().post(tx, ctx, baseParams);

    // A BigInt lock key is in there, which plain JSON.stringify refuses.
    expect(sqlText(queryRaw.mock.calls)).toContain('hashtextextended');
    expect(sqlText(executeRaw.mock.calls)).toContain('pg_advisory_xact_lock');
  });
});
