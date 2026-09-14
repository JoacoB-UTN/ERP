import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CurrentAccountsBackfillService } from '../accounts/current-accounts-backfill.service';
import type { HealthResponse } from '@erp/shared';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly currentAccountsBackfill: CurrentAccountsBackfillService,
  ) {}

  /**
   * Aggregates infrastructure liveness into a single response.
   *
   * - Postgres is a hard dependency: if it's down the API cannot serve any
   *   business request, so overall status is "error".
   * - Redis is not on the critical path yet (no queues/cache wired up), so
   *   a Redis outage alone is reported as "degraded", not "error".
   *
   * The Current Accounts backfill state rides along but deliberately does
   * NOT move `status`. `status` is about infrastructure liveness, and a
   * backfill that has not finished does not make the server unhealthy — it
   * makes one module unable to answer, which is enforced where that matters,
   * by the readiness gate on the Current Accounts endpoints themselves.
   */
  async check(): Promise<HealthResponse> {
    const [databaseOk, redisOk] = await Promise.all([
      this.prisma.isHealthy(),
      this.redis.isHealthy(),
    ]);

    const status: HealthResponse['status'] = !databaseOk
      ? 'error'
      : !redisOk
        ? 'degraded'
        : 'ok';

    return {
      status,
      services: {
        database: databaseOk ? 'ok' : 'error',
        redis: redisOk ? 'ok' : 'error',
      },
      currentAccountsBackfill: this.currentAccountsBackfill.getState(),
    };
  }
}
