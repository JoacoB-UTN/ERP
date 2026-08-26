import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CompanyContextModule } from '../company-context/company-context.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AuditModule } from '../audit/audit.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { ProductsController } from './products.controller';
import { ProductCategoriesController } from './product-categories.controller';
import { BrandsController } from './brands.controller';
import { UnitsController } from './units.controller';
import { ProductsService } from './products.service';
import { ProductCategoriesService } from './product-categories.service';
import { BrandsService } from './brands.service';
import { UnitsService } from './units.service';

@Module({
  imports: [
    AuthModule,
    CompanyContextModule,
    AuthorizationModule,
    AuditModule,
    RealtimeModule,
  ],
  controllers: [
    ProductsController,
    ProductCategoriesController,
    BrandsController,
    UnitsController,
  ],
  providers: [
    ProductsService,
    ProductCategoriesService,
    BrandsService,
    UnitsService,
  ],
})
export class ProductsModule {}
