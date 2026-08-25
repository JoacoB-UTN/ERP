import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CompanyContextModule } from '../company-context/company-context.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AuditModule } from '../audit/audit.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { PriceListsController } from './price-lists.controller';
import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';
import { PriceListsService } from './price-lists.service';

@Module({
  imports: [
    AuthModule,
    CompanyContextModule,
    AuthorizationModule,
    AuditModule,
    RealtimeModule,
  ],
  controllers: [PriceListsController, PricingController],
  providers: [PricingService, PriceListsService],
  exports: [PricingService, PriceListsService],
})
export class PricingModule {}
