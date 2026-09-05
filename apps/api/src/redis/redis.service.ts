import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { Env } from '@erp/config';

/** How long the first health check waits for an in-flight connection. */
const READY_GRACE_MS = 2000;

/**
 * Redis connection.
 *
 * Redis is an OPTIONAL dependency and the API must start without it.
 *
 * Nothing in the product requires Redis to be correct: it caches effective
 * permissions (`AuthorizationService`, which recomputes from Postgres on any
 * cache error — "correctness over cache convenience") and nothing else. No
 * queues are implemented yet, see `src/queue/README.md`. `HealthService`
 * already encodes this by reporting a Redis outage as `degraded` rather than
 * `error`.
 *
 * Startup used to `await client.connect()` unconditionally, which made that
 * "optional" a fiction: with Redis unreachable the connect never resolved and
 * the whole application hung on boot. That blocks the local ERP Server install
 * outright — a single-PC deployment for a small business has no business
 * running a Redis just to satisfy a cache that degrades cleanly anyway. So the
 * connection is attempted, failure is logged, and ioredis keeps reconnecting in
 * the background; commands issued meanwhile reject and every call site already
 * handles that.
 *
 * The offline queue stays disabled: with it on, every permission lookup during
 * a Redis outage waits for the retry budget instead of failing fast, which is
 * enough to hang the application. The cost of that choice is paid in
 * `isHealthy()` below.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  /** Suppresses a log line per reconnect attempt while Redis stays down. */
  private connectionErrorLogged = false;

  /** The startup grace in `isHealthy()` is spent at most once per process. */
  private readyGraceUsed = false;

  constructor(configService: ConfigService<Env, true>) {
    this.client = new Redis(configService.get('REDIS_URL', { infer: true }), {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      // Fail cache commands immediately while disconnected instead of queueing
      // them until a reconnect. An optional cache must never make a user's
      // request wait: AuthorizationService catches the rejection and recomputes
      // from PostgreSQL, which is correct and fast. With the default offline
      // queue those commands would sit pending and turn a Redis outage into
      // slow requests.
      enableOfflineQueue: false,
    });

    // ioredis emits 'error' on every failed reconnect. Without a listener Node
    // treats it as an unhandled error event and terminates the process — which
    // would turn an optional dependency into a crash loop.
    this.client.on('error', (error: Error) => {
      if (this.connectionErrorLogged) return;
      this.connectionErrorLogged = true;
      this.logger.warn(
        `Redis unavailable (${error.message}). Continuing without the permission cache; further reconnect errors are not logged.`,
      );
    });

    this.client.on('ready', () => {
      this.connectionErrorLogged = false;
      this.logger.log('Connected to Redis');
    });
  }

  onModuleInit() {
    // Deliberately NOT awaited. ioredis's default retry strategy reconnects
    // forever, so with Redis down `connect()` neither resolves nor rejects —
    // awaiting it hangs application startup indefinitely rather than failing
    // fast. Kicking it off and letting it connect in the background is what
    // makes Redis genuinely optional; ioredis queues or rejects commands in
    // the meantime, and every call site already tolerates that.
    void this.client.connect().catch(() => {
      // Surfaced by the 'error' handler above.
    });
  }

  onModuleDestroy() {
    this.client.disconnect();
  }

  /**
   * Lightweight liveness check used by HealthService.
   *
   * Because `onModuleInit` deliberately does not await the connection, the very
   * first health check can land mid-handshake. With the offline queue disabled
   * a ping in that window fails instantly and reports a perfectly healthy Redis
   * as down — CI caught exactly that, on a runner where Redis was up.
   *
   * So the handshake gets ONE bounded chance to finish, once per process. Every
   * later call pings immediately, which is what keeps a genuine outage from
   * making this endpoint slow: the ERP desktop client polls it.
   */
  async isHealthy(): Promise<boolean> {
    if (!this.readyGraceUsed && this.client.status !== 'ready') {
      this.readyGraceUsed = true;
      await this.waitForReady(READY_GRACE_MS);
    }

    try {
      const pong = await this.client.ping();
      return pong === 'PONG';
    } catch {
      return false;
    }
  }

  /** Resolves when the client reports ready, or when the grace period expires. */
  private waitForReady(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      if (this.client.status === 'ready') {
        resolve();
        return;
      }
      const finish = () => {
        clearTimeout(timer);
        this.client.removeListener('ready', finish);
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      this.client.once('ready', finish);
    });
  }
}
