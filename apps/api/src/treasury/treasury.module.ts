import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CompanyContextModule } from '../company-context/company-context.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AuditModule } from '../audit/audit.module';
import { TreasuryAccountsController } from './treasury-accounts.controller';
import { TreasuryAccountsService } from './treasury-accounts.service';
import { TreasuryService } from './treasury.service';
import { TreasuryTransfersController } from './treasury-transfers.controller';
import { TreasuryTransfersService } from './treasury-transfers.service';

/**
 * Treasury — see docs/treasury.md.
 *
 * `TreasuryService` is exported because the modules that will post to
 * the ledger (Cobros and Pagos, in `src/accounts`) have to do it inside
 * their own transaction. Nothing outside this module writes a
 * `TreasuryMovement` directly.
 */
@Module({
  imports: [AuthModule, CompanyContextModule, AuthorizationModule, AuditModule],
  controllers: [TreasuryAccountsController, TreasuryTransfersController],
  providers: [
    TreasuryService,
    TreasuryAccountsService,
    TreasuryTransfersService,
  ],
  exports: [TreasuryService],
})
export class TreasuryModule {}
