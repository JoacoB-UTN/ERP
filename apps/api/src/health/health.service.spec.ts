import { HealthService } from './health.service';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';

describe('HealthService', () => {
  function build(databaseOk: boolean, redisOk: boolean) {
    const prisma = { isHealthy: jest.fn().mockResolvedValue(databaseOk) };
    const redis = { isHealthy: jest.fn().mockResolvedValue(redisOk) };
    const service = new HealthService(
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
    );
    return service;
  }

  it('reports "ok" when both database and redis are healthy', async () => {
    const service = build(true, true);
    await expect(service.check()).resolves.toEqual({
      status: 'ok',
      services: { database: 'ok', redis: 'ok' },
    });
  });

  it('reports "degraded" (not "error") when only redis is down', async () => {
    const service = build(true, false);
    await expect(service.check()).resolves.toEqual({
      status: 'degraded',
      services: { database: 'ok', redis: 'error' },
    });
  });

  it('reports "error" when the database is down, regardless of redis', async () => {
    const service = build(false, true);
    await expect(service.check()).resolves.toEqual({
      status: 'error',
      services: { database: 'error', redis: 'ok' },
    });
  });

  it('reports "error" when both dependencies are down', async () => {
    const service = build(false, false);
    await expect(service.check()).resolves.toEqual({
      status: 'error',
      services: { database: 'error', redis: 'error' },
    });
  });
});
