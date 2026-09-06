import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CompanyContextModule } from '../company-context/company-context.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AuditModule } from '../audit/audit.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { CustomerAccountController, SalesDocumentOutstandingController } from './customer-account.controller';
import { CustomerAccountService } from './customer-account.service';
import { SupplierAccountController, PurchaseReceiptOutstandingController } from './supplier-account.controller';
import { SupplierAccountService } from './supplier-account.service';
import { CustomerCollectionsController } from './customer-collections.controller';
import { CustomerCollectionsService } from './customer-collections.service';
import { SupplierPaymentsController } from './supplier-payments.controller';
import { SupplierPaymentsService } from './supplier-payments.service';

/**
 * Customer/Supplier Current Accounts, Collections ("Cobros") and Supplier
 * Payments ("Pagos") — see docs/current-accounts.md. `CustomerAccountService`
 * and `SupplierAccountService` are exported so SalesModule/PurchasesModule
 * can call their `postSaleConfirmation`/`postReceiptAccrual` etc. from
 * within their own `confirm()`/`cancel()` transactions (same
 * cross-module-service-injection pattern SalesModule already uses for
 * InventoryService/PricingService).
 */
@Module({
  imports: [AuthModule, CompanyContextModule, AuthorizationModule, AuditModule, RealtimeModule],
  controllers: [
    CustomerAccountController,
    SalesDocumentOutstandingController,
    SupplierAccountController,
    PurchaseReceiptOutstandingController,
    CustomerCollectionsController,
    SupplierPaymentsController,
  ],
  providers: [CustomerAccountService, SupplierAccountService, CustomerCollectionsService, SupplierPaymentsService],
  exports: [CustomerAccountService, SupplierAccountService],
})
export class AccountsModule {}
