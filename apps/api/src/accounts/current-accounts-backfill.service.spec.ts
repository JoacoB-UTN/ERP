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

  describe('reported state', () => {
    it('starts pending — before anything ran, nothing is known', () => {
      const { service } = build();
      expect(service.getState()).toBe('pending');
    });

    it('is `disabled` when turned off and the ledger really is missing rows', async () => {
      mockedHasPending.mockResolvedValue(true);
      const { service } = build({ enabled: false });
      await service.onApplicationBootstrap();
      // Handing the job to an operator is not doing the job.
      expect(service.getState()).toBe('disabled');
    });

    it('is `complete` when turned off but the ledger has nothing outstanding', async () => {
      // The operator ran the CLI by hand and restarted — exactly what the
      // flag is for. `disabled` used to be terminal, so this process would
      // have refused current accounts for its whole life over a ledger that
      // was already loaded. The flag decides whether to POST, never whether
      // the ledger is correct: that is the probe's answer.
      mockedHasPending.mockResolvedValue(false);
      const { service, transaction } = build({ enabled: false });

      await service.onApplicationBootstrap();

      expect(service.getState()).toBe('complete');
      // Still posted nothing: probing is not loading.
      expect(transaction).not.toHaveBeenCalled();
      expect(mockedBackfill).not.toHaveBeenCalled();
    });

    it('is `disabled` when turned off and the ledger cannot be checked', async () => {
      // A probe that cannot run establishes nothing, so nothing is claimed.
      mockedHasPending.mockRejectedValue(new Error('no connection'));
      const { service } = build({ enabled: false });
      await service.onApplicationBootstrap();
      expect(service.getState()).toBe('disabled');
    });

    it('is `complete` once a pass ends with nothing outstanding', async () => {
      mockedHasPending.mockResolvedValue(false);
      const { service } = build();
      await service.onApplicationBootstrap();
      expect(service.getState()).toBe('complete');
    });

    it('stays `pending` when a pass ends with work still outstanding', async () => {
      // What a skipped pass looks like: another instance held the lock.
      mockedHasPending.mockResolvedValue(true);
      const { service } = build({ lockAcquired: false });
      await service.onApplicationBootstrap();
      expect(service.getState()).toBe('pending');
    });

    it('is `failed`, with the reason, when a pass throws', async () => {
      mockedHasPending.mockRejectedValue(new Error('database is on fire'));
      const { service } = build();
      await service.onApplicationBootstrap();
      expect(service.getState()).toBe('failed');
      expect(service.getLastError()).toContain('database is on fire');
    });

    it('re-checks a pending state on demand, and only a pending one', async () => {
      mockedHasPending.mockResolvedValue(true);
      const { service } = build({ lockAcquired: false });
      await service.onApplicationBootstrap();
      expect(service.getState()).toBe('pending');

      // The sibling that held the lock finished in the meantime.
      mockedHasPending.mockResolvedValue(false);
      await expect(service.refreshIfPending()).resolves.toBe('complete');

      // Already resolved: no further probing, however many times it is asked.
      const calls = mockedHasPending.mock.calls.length;
      await service.refreshIfPending();
      expect(mockedHasPending.mock.calls).toHaveLength(calls);
    });

    it('keeps refusing when the re-check itself cannot run', async () => {
      mockedHasPending.mockResolvedValue(true);
      const { service } = build({ lockAcquired: false });
      await service.onApplicationBootstrap();

      mockedHasPending.mockRejectedValue(new Error('no connection'));
      await expect(service.refreshIfPending()).resolves.toBe('pending');
    });
  });

  it('posts nothing when disabled, but still looks at the ledger', async () => {
    // The distinction the flag actually draws. It turns off the WRITE, not
    // the question: one cheap EXISTS is what separates "the operator loaded
    // it themselves" from "nobody has loaded it", and without it the module
    // refuses forever in both cases alike.
    mockedHasPending.mockResolvedValue(true);
    const { service, transaction } = build({ enabled: false });

    await service.onApplicationBootstrap();

    expect(mockedHasPending).toHaveBeenCalledTimes(1);
    expect(transaction).not.toHaveBeenCalled();
    expect(mockedBackfill).not.toHaveBeenCalled();
  });

  it('probes without opening a transaction when the ledger is complete', async () => {
    mockedHasPending.mockResolvedValue(false);
    const { service, transaction, audit } = build();

    await service.onApplicationBootstrap();

    // Two: the cheap probe that decides whether to open a transaction, and
    // the one after the pass that decides `complete` vs `pending`.
    expect(mockedHasPending).toHaveBeenCalledTimes(2);
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

    // Three: the cheap probe, the re-probe inside the lock, and the one
    // after the pass that settles the reported state.
    expect(mockedHasPending).toHaveBeenCalledTimes(3);
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
