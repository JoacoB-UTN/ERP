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
 * queues are implemented yet, see `src/queue/README.md`.
 *
 * `HealthService` distinguishes three cases, and the distinction matters: a
 * Redis that was CONFIGURED and is unreachable reports `error` and degrades
 * the server, while a deployment with no `REDIS_URL` at all reports
 * `disabled` and stays healthy. Without that split every installed machine
 * read `degraded` forever, because the installer had to name some Redis and
 * named one it never ships.
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

  /**
   * Whether this deployment has a Redis at all.
   *
   * An empty REDIS_URL means the operator is running without a cache, which
   * is supported: permissions are recomputed from PostgreSQL. That is a
   * different fact from "a Redis was configured and cannot be reached", and
   * conflating them is what made every installed machine report `degraded`
   * permanently -- the installer had to supply some URL, so it pointed at a
   * Redis it never installs.
   */
  readonly isConfigured: boolean;

  constructor(configService: ConfigService<Env, true>) {
    const url = configService.get('REDIS_URL', { infer: true });
    this.isConfigured = Boolean(url && url.trim());
    this.client = new Redis(url || 'redis://127.0.0.1:6379', {
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
    if (!this.isConfigured) {
      // No URL: never connect, and say so once. The client object still
      // exists so no call site needs a null check -- with the offline queue
      // disabled its commands reject immediately, which is exactly what
      // AuthorizationService already handles by going to PostgreSQL.
      this.logger.log(
        'No REDIS_URL configured: running without the permission cache. Permissions are read from PostgreSQL on every check.',
      );
      return;
    }

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
   * Three states, because two cannot express this: a deployment with no Redis
   * is not an unhealthy one. `disabled` must never move the overall health
   * status; only a Redis that was asked for and is missing should.
   */
  async getStatus(): Promise<'ok' | 'error' | 'disabled'> {
    if (!this.isConfigured) return 'disabled';
    return (await this.isHealthy()) ? 'ok' : 'error';
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
    if (!this.isConfigured) return false;
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
