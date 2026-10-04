import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CompanyContextModule } from '../company-context/company-context.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AuditModule } from '../audit/audit.module';
import { FiscalController } from './fiscal.controller';
import { FiscalService } from './fiscal.service';
import { FiscalSettingsService } from './fiscal-settings.service';
import { FiscalSettingsController } from './fiscal-settings.controller';
import { ArcaConnectivityService } from './arca-connectivity.service';
@Module({
  imports: [AuthModule, CompanyContextModule, AuthorizationModule, AuditModule],
  controllers: [FiscalController, FiscalSettingsController],
  providers: [FiscalService, FiscalSettingsService, ArcaConnectivityService],
})
export class FiscalModule {}
