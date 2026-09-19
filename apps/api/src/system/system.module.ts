import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CompanyContextModule } from '../company-context/company-context.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { BackupsController } from './backups.controller';
import { BackupsService } from './backups.service';
import { DiagnosticsController } from './diagnostics.controller';
import { DiagnosticsService } from './diagnostics.service';

/**
 * Server-level operational status (as opposed to business data): backup health
 * and install diagnostics.
 *
 * Everything here is read-only and instance-wide rather than company-scoped —
 * see BackupsService for why that is a deliberate limit and not an oversight.
 */
@Module({
  imports: [AuthModule, CompanyContextModule, AuthorizationModule],
  controllers: [BackupsController, DiagnosticsController],
  providers: [BackupsService, DiagnosticsService],
  exports: [BackupsService],
})
export class SystemModule {}
