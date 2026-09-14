import { ConfigService } from '@nestjs/config';
import { CurrentAccountsBackfillService } from './current-accounts-backfill.service';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  backfillCurrentAccounts,
  hasPendingCurrentAccountsBackfill,
} from './current-accounts-backfill';

jest.mock('./current-accounts-backfill', () => ({
  backfillCurrentAccounts: jest.fn(),
  hasPendingCurrentAccountsBackfill: jest.fn(),
  isBackfillResultEmpty: (r: Record<string, number>) =>
    Object.values(r).every((n) => n === 0),
}));

const mockedBackfill = backfillCurrentAccounts as jest.MockedFunction<
  typeof backfillCurrentAccounts
>;
const mockedHasPending =
  hasPendingCurrentAccountsBackfill as jest.MockedFunction<
    typeof hasPendingCurrentAccountsBackfill
  >;

const NOTHING = {
  salesCharges: 0,
  salesSettlements: 0,
  receiptAccruals: 0,
  receiptReversals: 0,
};

type AuditRecordArgs = [Record<string, unknown>, unknown?];

interface AuditMock {
  record: jest.Mock<Promise<void>, AuditRecordArgs>;
}

describe('CurrentAccountsBackfillService', () => {
  function build(options: { enabled?: boolean; lockAcquired?: boolean } = {}) {
    const { enabled = true, lockAcquired = true } = options;

    // The transaction client the service is handed inside $transaction.
    const txQueryRaw = jest
      .fn()
      .mockResolvedValue([{ locked: lockAcquired }] as unknown);
    const tx = { $queryRaw: txQueryRaw };

    const transaction = jest
      .fn()
      .mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) =>
        fn(tx),
      );

    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([] as unknown),
      $transaction: transaction,
    };
    const audit: AuditMock = {
      record: jest.fn<Promise<void>, AuditRecordArgs>().mockResolvedValue(),
    };
    const configService = { get: jest.fn().mockReturnValue(enabled) };

    const service = new CurrentAccountsBackfillService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      configService as unknown as ConfigService<never, true>,
    );
    return { service, prisma, audit, transaction, tx, txQueryRaw };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockedHasPending.mockResolvedValue(false);
    mockedBackfill.mockResolvedValue(NOTHING);
  });

  it('does nothing at all when disabled — not even the probe', async () => {
    const { service, transaction } = build({ enabled: false });

    await service.onApplicationBootstrap();

    expect(mockedHasPending).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(mockedBackfill).not.toHaveBeenCalled();
  });

  it('probes without opening a transaction when the ledger is complete', async () => {
    mockedHasPending.mockResolvedValue(false);
    const { service, transaction, audit } = build();

    await service.onApplicationBootstrap();

    expect(mockedHasPending).toHaveBeenCalledTimes(1);
    expect(transaction).not.toHaveBeenCalled();
    expect(mockedBackfill).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('takes a transaction-scoped lock, never a session-scoped one', async () => {
    mockedHasPending.mockResolvedValue(true);
    const { service, txQueryRaw } = build();

    await service.onApplicationBootstrap();

    const sql = JSON.stringify(txQueryRaw.mock.calls);
    expect(sql).toContain('pg_try_advisory_xact_lock');
    // A session-scoped lock would leak: acquire and release can land on
    // different pooled connections.
    expect(sql).not.toContain('pg_advisory_unlock');
  });

  it('backfills and records one audit row inside the same transaction', async () => {
    mockedHasPending.mockResolvedValue(true);
    mockedBackfill.mockResolvedValue({
      salesCharges: 3,
      salesSettlements: 1,
      receiptAccruals: 2,
      receiptReversals: 1,
    });
    const { service, audit, tx } = build();

    await service.onApplicationBootstrap();

    expect(mockedBackfill).toHaveBeenCalledTimes(1);
    expect(mockedBackfill).toHaveBeenCalledWith(tx);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      {
        action: 'CREATE',
        entityType: 'CurrentAccountsBackfill',
        metadata: {
          trigger: 'startup',
          salesCharges: 3,
          salesSettlements: 1,
          receiptAccruals: 2,
          receiptReversals: 1,
        },
      },
      tx,
    );
  });

  it('never invents a company, tenant or actor on the audit row', async () => {
    mockedHasPending.mockResolvedValue(true);
    mockedBackfill.mockResolvedValue({ ...NOTHING, salesCharges: 1 });
    const { service, audit } = build();

    await service.onApplicationBootstrap();

    const input = audit.record.mock.calls[0]?.[0];
    expect(input).toBeDefined();
    expect(input?.companyId).toBeUndefined();
    expect(input?.tenantId).toBeUndefined();
    expect(input?.userId).toBeUndefined();
  });

  it('skips the work when another instance holds the lock', async () => {
    mockedHasPending.mockResolvedValue(true);
    const { service, audit } = build({ lockAcquired: false });

    await service.onApplicationBootstrap();

    expect(mockedBackfill).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('re-probes inside the lock and does nothing if another instance already finished', async () => {
    mockedHasPending
      .mockResolvedValueOnce(true) // cheap probe, outside the lock
      .mockResolvedValueOnce(false); // re-probe, inside it
    const { service, audit } = build();

    await service.onApplicationBootstrap();

    expect(mockedHasPending).toHaveBeenCalledTimes(2);
    expect(mockedBackfill).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('does not record an audit row when the backfill posted nothing', async () => {
    mockedHasPending.mockResolvedValue(true);
    mockedBackfill.mockResolvedValue(NOTHING);
    const { service, audit } = build();

    await service.onApplicationBootstrap();

    expect(mockedBackfill).toHaveBeenCalledTimes(1);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('never lets a failure escape and stop the API from booting', async () => {
    mockedHasPending.mockRejectedValue(new Error('database is on fire'));
    const { service } = build();

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});
