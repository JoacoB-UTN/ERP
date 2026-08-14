import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { envSchema } from '@erp/config';

/**
 * Global, validated environment configuration.
 * `envSchema.parse` throws synchronously on missing/invalid variables,
 * so the application fails fast at boot instead of starting in a broken
 * state.
 */
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      validate: (config) => envSchema.parse(config),
    }),
  ],
})
export class AppConfigModule {}
