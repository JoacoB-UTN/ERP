import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CompanyContextModule } from '../company-context/company-context.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AuditModule } from '../audit/audit.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { TreasuryModule } from '../treasury/treasury.module';
import {
  CustomerAccountController,
  SalesDocumentOutstandingController,
} from './customer-account.controller';
import { CustomerAccountService } from './customer-account.service';
import {
  SupplierAccountController,
  PurchaseReceiptOutstandingController,
} from './supplier-account.controller';
import { SupplierAccountService } from './supplier-account.service';
import { CustomerCollectionsController } from './customer-collections.controller';
import { CustomerCollectionsService } from './customer-collections.service';
import { SupplierPaymentsController } from './supplier-payments.controller';
import { SupplierPaymentsService } from './supplier-payments.service';
import { CurrentAccountsBackfillService } from './current-accounts-backfill.service';
import { CurrentAccountsReadyGuard } from './current-accounts-ready.guard';

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
  imports: [
    AuthModule,
    CompanyContextModule,
    AuthorizationModule,
    AuditModule,
    RealtimeModule,
    // Confirming a Cobro or a Pago now moves a treasury balance inside the
    // same transaction — see docs/treasury.md. TreasuryModule exports
    // TreasuryService for exactly this.
    TreasuryModule,
  ],
  controllers: [
    CustomerAccountController,
    SalesDocumentOutstandingController,
    SupplierAccountController,
    PurchaseReceiptOutstandingController,
    CustomerCollectionsController,
    SupplierPaymentsController,
  ],
  providers: [
    CustomerAccountService,
    SupplierAccountService,
    CustomerCollectionsService,
    SupplierPaymentsService,
    CurrentAccountsBackfillService,
    CurrentAccountsReadyGuard,
  ],
  exports: [
    CustomerAccountService,
    SupplierAccountService,
    // HealthModule reports the backfill state; the readiness gate lives here.
    CurrentAccountsBackfillService,
  ],
})
export class AccountsModule {}
