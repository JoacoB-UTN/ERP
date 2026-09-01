import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CompanyContextModule } from '../company-context/company-context.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AuditModule } from '../audit/audit.module';
import { InventoryModule } from '../inventory/inventory.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { AccountsModule } from '../accounts/accounts.module';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseReceiptsController } from './purchase-receipts.controller';
import { PurchaseReceiptsService } from './purchase-receipts.service';

/**
 * Suppliers + Purchase Orders + Goods Receipts — see docs/purchases.md.
 * Bundled in one module (same pattern as PricingModule's
 * PriceListsService/PricingService) since the three resources are tightly
 * related and share the same permission prefix (`purchases.*`).
 */
@Module({
  imports: [
    AuthModule,
    CompanyContextModule,
    AuthorizationModule,
    AuditModule,
    InventoryModule,
    RealtimeModule,
    AccountsModule,
  ],
  controllers: [
    SuppliersController,
    PurchaseOrdersController,
    PurchaseReceiptsController,
  ],
  providers: [SuppliersService, PurchaseOrdersService, PurchaseReceiptsService],
  exports: [SuppliersService, PurchaseOrdersService, PurchaseReceiptsService],
})
export class PurchasesModule {}
