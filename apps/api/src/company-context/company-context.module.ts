import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CompanyContextController } from './company-context.controller';
import { CompanyContextService } from './company-context.service';
import { CompanyContextGuard } from './guards/company-context.guard';

@Module({
  imports: [AuthModule], // for JwtAuthGuard's TokenService dependency
  controllers: [CompanyContextController],
  providers: [CompanyContextService, CompanyContextGuard],
  exports: [CompanyContextService],
})
export class CompanyContextModule {}
