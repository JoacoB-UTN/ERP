import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CompanyContextModule } from '../company-context/company-context.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AuditModule } from '../audit/audit.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { InventoryController } from './inventory.controller';
import { StockAdjustmentsController } from './stock-adjustments.controller';
import { StockTransfersController } from './stock-transfers.controller';
import { InventoryService } from './inventory.service';
import { StockAdjustmentsService } from './stock-adjustments.service';
import { StockTransfersService } from './stock-transfers.service';

@Module({
  imports: [
    AuthModule,
    CompanyContextModule,
    AuthorizationModule,
    AuditModule,
    RealtimeModule,
  ],
  controllers: [
    InventoryController,
    StockAdjustmentsController,
    StockTransfersController,
  ],
  providers: [InventoryService, StockAdjustmentsService, StockTransfersService],
  exports: [InventoryService],
})
export class InventoryModule {}
