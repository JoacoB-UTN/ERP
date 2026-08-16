import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@erp/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { SessionService } from './session.service';
import { ConsolePasswordResetDelivery } from './password-reset-delivery';
import { PASSWORD_RESET_DELIVERY } from './auth.constants';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    AuditModule,
    JwtModule.register({}), // secret/expiry are passed explicitly per-call by TokenService
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<Env, true>) => ({
        throttlers: [
          {
            ttl:
              configService.get('AUTH_RATE_LIMIT_TTL_SECONDS', {
                infer: true,
              }) * 1000,
            limit: configService.get('AUTH_RATE_LIMIT_MAX', { infer: true }),
          },
        ],
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    SessionService,
    {
      provide: PASSWORD_RESET_DELIVERY,
      useClass: ConsolePasswordResetDelivery,
    },
  ],
  exports: [PasswordService, TokenService],
})
export class AuthModule {}
