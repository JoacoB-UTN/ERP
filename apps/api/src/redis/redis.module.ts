import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';

/**
 * Global Redis connectivity for the API.
 *
 * This module intentionally does NOT wire up BullMQ queues yet — it only
 * provides the shared connection. BullMQ is installed as a dependency and
 * the future queue boundary is documented in `src/queue/README.md`; adding
 * actual job producers/processors is deferred to the task that needs them.
 */
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
