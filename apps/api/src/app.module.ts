import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import type { Env } from '@erp/config';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { CompanyContextModule } from './company-context/company-context.module';
import { AuthorizationModule } from './authorization/authorization.module';
import { AdministrationModule } from './administration/administration.module';
import { CustomersModule } from './customers/customers.module';
import { ProductsModule } from './products/products.module';
import { WarehousesModule } from './warehouses/warehouses.module';
import { InventoryModule } from './inventory/inventory.module';
import { PricingModule } from './pricing/pricing.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<Env, true>) => {
        const isProduction =
          configService.get('NODE_ENV', { infer: true }) === 'production';
        return {
          pinoHttp: {
            level: configService.get('LOG_LEVEL', { infer: true }),
            genReqId: (req: IncomingMessage) =>
              (req.headers['x-request-id'] as string) || randomUUID(),
            // Never log full request/response bodies (may contain secrets/PII).
            autoLogging: true,
            redact: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers["set-cookie"]',
            ],
            transport: isProduction
              ? undefined
              : { target: 'pino-pretty', options: { singleLine: true } },
            // pino-http's `ReqId` type (string | number | object) doesn't narrow
            // cleanly against IncomingMessage here; `any` is the pragmatic
            // escape hatch for this one third-party callback signature.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
            customProps: (req: any) => ({ requestId: req.id as string }),
          },
        };
      },
    }),
    DatabaseModule,
    RedisModule,
    HealthModule,
    AuthModule,
    CompanyContextModule,
    AuthorizationModule,
    AdministrationModule,
    CustomersModule,
    ProductsModule,
    WarehousesModule,
    InventoryModule,
    PricingModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
