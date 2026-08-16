import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CompanyContextModule } from '../company-context/company-context.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AuditModule } from '../audit/audit.module';
import { RolesController } from './roles.controller';
import { UsersController } from './users.controller';
import { AuditController } from './audit.controller';
import { RolesService } from './roles.service';

@Module({
  imports: [AuthModule, CompanyContextModule, AuthorizationModule, AuditModule],
  controllers: [RolesController, UsersController, AuditController],
  providers: [RolesService],
})
export class AdministrationModule {}
