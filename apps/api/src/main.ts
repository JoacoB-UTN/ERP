import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import type { Env } from '@erp/config';
import { AppModule } from './app.module';
import { RealtimeIoAdapter } from './realtime/realtime.adapter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });

  app.useLogger(app.get(Logger));

  const configService = app.get(ConfigService<Env, true>);

  app.use(helmet());
  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());

  // Comma-separated allow-list — never a wildcard, since credentialed
  // (cookie-based) requests require an explicit origin. Both Gestión and
  // Facturación must be listed here to authenticate.
  const allowedOrigins = configService
    .get('CORS_ORIGIN', { infer: true })
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: allowedOrigins, credentials: true });

  // Same CORS allow-list as the HTTP API above, applied to the realtime
  // (Socket.IO) transport too — see realtime.adapter.ts.
  app.useWebSocketAdapter(new RealtimeIoAdapter(app));

  app.setGlobalPrefix('api/v1');

  const port = configService.get('API_PORT', { infer: true });
  await app.listen(port);

  app
    .get(Logger)
    .log(`API listening on http://localhost:${port}/api/v1`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  console.error('Fatal error during bootstrap:', error);
  process.exit(1);
});
