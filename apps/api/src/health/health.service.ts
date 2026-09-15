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
   * - Redis has three states, not two. A Redis that was CONFIGURED and is
   *   unreachable reports "error" and makes the server "degraded". A
   *   deployment with no REDIS_URL at all reports "disabled" and stays "ok":
   *   running without the permission cache is supported, and PostgreSQL
   *   answers instead.
   *
   *   That split exists because it was missing: REDIS_URL was mandatory, so
   *   the Windows installer pointed it at a Redis it deliberately never
   *   ships, and every installed machine reported "degraded" forever. A
   *   health panel that is permanently yellow tells an operator nothing.
   *
   * The Current Accounts backfill state rides along but deliberately does
   * NOT move `status`. `status` is about infrastructure liveness, and a
   * backfill that has not finished does not make the server unhealthy — it
   * makes one module unable to answer, which is enforced where that matters,
   * by the readiness gate on the Current Accounts endpoints themselves.
   */
  async check(): Promise<HealthResponse> {
    const [databaseOk, redis] = await Promise.all([
      this.prisma.isHealthy(),
      this.redis.getStatus(),
    ]);

    const status: HealthResponse['status'] = !databaseOk
      ? 'error'
      : redis === 'error'
        ? 'degraded'
        : 'ok';

    return {
      status,
      services: {
        database: databaseOk ? 'ok' : 'error',
        redis,
      },
      currentAccountsBackfill: this.currentAccountsBackfill.getState(),
    };
  }
}
