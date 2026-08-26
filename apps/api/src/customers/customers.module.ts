import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CompanyContextModule } from '../company-context/company-context.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AuditModule } from '../audit/audit.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { CustomersController } from './customers.controller';
import { CustomerCategoriesController } from './customer-categories.controller';
import { CustomersService } from './customers.service';
import { CustomerCategoriesService } from './customer-categories.service';

@Module({
  imports: [
    AuthModule,
    CompanyContextModule,
    AuthorizationModule,
    AuditModule,
    RealtimeModule,
  ],
  controllers: [CustomersController, CustomerCategoriesController],
  providers: [CustomersService, CustomerCategoriesService],
})
export class CustomersModule {}
