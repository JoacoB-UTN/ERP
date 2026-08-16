import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CompanyContextModule } from '../company-context/company-context.module';
import { AuthorizationController } from './authorization.controller';
import { AuthorizationService } from './authorization.service';
import { PermissionGuard } from './guards/permission.guard';

@Module({
  imports: [AuthModule, CompanyContextModule], // for JwtAuthGuard/CompanyContextGuard dependencies
  controllers: [AuthorizationController],
  providers: [AuthorizationService, PermissionGuard],
  exports: [AuthorizationService],
})
export class AuthorizationModule {}
