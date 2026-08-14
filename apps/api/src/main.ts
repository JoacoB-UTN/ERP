import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { Logger } from 'nestjs-pino';
import type { Env } from '@erp/config';
import { AppModule } from './app.module';

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

  app.enableCors({ origin: configService.get('CORS_ORIGIN', { infer: true }) });

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
