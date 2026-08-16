import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CompanyContextModule } from '../company-context/company-context.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AuditModule } from '../audit/audit.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PricingModule } from '../pricing/pricing.module';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

@Module({
  imports: [
    AuthModule,
    CompanyContextModule,
    AuthorizationModule,
    AuditModule,
    InventoryModule,
    PricingModule,
  ],
  controllers: [SalesController],
  providers: [SalesService],
})
export class SalesModule {}
