import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import type { HealthResponse } from '@erp/shared';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Aggregates infrastructure liveness into a single response.
   *
   * - Postgres is a hard dependency: if it's down the API cannot serve any
   *   business request, so overall status is "error".
   * - Redis is not on the critical path yet (no queues/cache wired up), so
   *   a Redis outage alone is reported as "degraded", not "error".
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
    };
  }
}
