import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CompanyContextModule } from '../company-context/company-context.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AuditModule } from '../audit/audit.module';
import { FiscalController } from './fiscal.controller';
import { FiscalService } from './fiscal.service';
@Module({
  imports: [AuthModule, CompanyContextModule, AuthorizationModule, AuditModule],
  controllers: [FiscalController],
  providers: [FiscalService],
})
export class FiscalModule {}
