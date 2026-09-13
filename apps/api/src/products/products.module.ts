import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CompanyContextModule } from '../company-context/company-context.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AuditModule } from '../audit/audit.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { ProductsController } from './products.controller';
import { ProductCategoriesController } from './product-categories.controller';
import { ProductLinesController } from './product-lines.controller';
import { ProductsService } from './products.service';
import { ProductCategoriesService } from './product-categories.service';
import { ProductLinesService } from './product-lines.service';

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
    ProductLinesController,
  ],
  providers: [
    ProductsService,
    ProductCategoriesService,
    ProductLinesService,
  ],
})
export class ProductsModule {}
