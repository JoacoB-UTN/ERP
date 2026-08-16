import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CompanyContextModule } from '../company-context/company-context.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AuditModule } from '../audit/audit.module';
import { InventoryController } from './inventory.controller';
import { StockAdjustmentsController } from './stock-adjustments.controller';
import { InventoryService } from './inventory.service';
import { StockAdjustmentsService } from './stock-adjustments.service';

@Module({
  imports: [AuthModule, CompanyContextModule, AuthorizationModule, AuditModule],
  controllers: [InventoryController, StockAdjustmentsController],
  providers: [InventoryService, StockAdjustmentsService],
  exports: [InventoryService],
})
export class InventoryModule {}
