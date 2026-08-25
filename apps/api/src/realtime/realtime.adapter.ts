import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ConfigService } from '@nestjs/config';
import type { ServerOptions } from 'socket.io';
import type { Env } from '@erp/config';

/**
 * Reuses the exact same CORS_ORIGIN allow-list the HTTP API enforces (see
 * main.ts) — never a wildcard, since this is a credentialed (cookie-based)
 * connection. `@WebSocketGateway()`'s own `cors` option is evaluated at
 * decorator/class-definition time, before ConfigService exists, so the
 * origin allow-list is applied here instead, at server-creation time.
 */
export class RealtimeIoAdapter extends IoAdapter {
  constructor(private readonly app: INestApplicationContext) {
    super(app);
  }

  createIOServer(
    port: number,
    options?: ServerOptions,
  ): ReturnType<IoAdapter['createIOServer']> {
    const configService = this.app.get(ConfigService<Env, true>);
    const allowedOrigins = configService
      .get('CORS_ORIGIN', { infer: true })
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);

    return super.createIOServer(port, {
      ...options,
      cors: { origin: allowedOrigins, credentials: true },
    });
  }
}
