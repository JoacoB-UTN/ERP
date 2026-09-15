import { HealthService } from './health.service';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import type { CurrentAccountsBackfillService } from '../accounts/current-accounts-backfill.service';
import type { CurrentAccountsBackfillState } from '@erp/shared';

describe('HealthService', () => {
  function build(
    databaseOk: boolean,
    redisStatus: 'ok' | 'error' | 'disabled',
    backfill: CurrentAccountsBackfillState = 'complete',
  ) {
    const prisma = { isHealthy: jest.fn().mockResolvedValue(databaseOk) };
    const redis = { getStatus: jest.fn().mockResolvedValue(redisStatus) };
    const currentAccountsBackfill = { getState: () => backfill };
    const service = new HealthService(
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
      currentAccountsBackfill as unknown as CurrentAccountsBackfillService,
    );
    return service;
  }

  it('reports "ok" when both database and redis are healthy', async () => {
    const service = build(true, 'ok');
    await expect(service.check()).resolves.toEqual({
      status: 'ok',
      services: { database: 'ok', redis: 'ok' },
      currentAccountsBackfill: 'complete',
    });
  });

  it('reports "degraded" (not "error") when only redis is down', async () => {
    const service = build(true, 'error');
    await expect(service.check()).resolves.toEqual({
      status: 'degraded',
      services: { database: 'ok', redis: 'error' },
      currentAccountsBackfill: 'complete',
    });
  });

  it('reports "error" when the database is down, regardless of redis', async () => {
    const service = build(false, 'ok');
    await expect(service.check()).resolves.toEqual({
      status: 'error',
      services: { database: 'error', redis: 'ok' },
      currentAccountsBackfill: 'complete',
    });
  });

  it('stays "ok" when Redis is simply not configured', async () => {
    // The case that was missing, and that made every installed machine read
    // "degraded" forever: no REDIS_URL is a supported deployment, not a fault.
    const service = build(true, 'disabled');
    await expect(service.check()).resolves.toEqual({
      status: 'ok',
      services: { database: 'ok', redis: 'disabled' },
      currentAccountsBackfill: 'complete',
    });
  });

  it('reports "error" when both dependencies are down', async () => {
    const service = build(false, 'error');
    await expect(service.check()).resolves.toEqual({
      status: 'error',
      services: { database: 'error', redis: 'error' },
      currentAccountsBackfill: 'complete',
    });
  });

  it('reports the backfill state without letting it change `status`', async () => {
    // A backfill that has not finished does not make the SERVER unhealthy.
    // It makes one module unable to answer, and that is enforced by the
    // readiness gate on the Current Accounts endpoints, not here.
    for (const state of [
      'pending',
      'running',
      'failed',
      'disabled',
    ] as CurrentAccountsBackfillState[]) {
      const service = build(true, 'ok', state);
      await expect(service.check()).resolves.toEqual({
        status: 'ok',
        services: { database: 'ok', redis: 'ok' },
        currentAccountsBackfill: state,
      });
    }
  });
});
