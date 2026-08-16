import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/**
 * Pure domain module — only AuditService, no controller and no guard
 * dependencies (PrismaService is global, see database.module.ts). Kept
 * import-free deliberately so both AuthModule (pre-company-context auth
 * events) and AdministrationModule (which also hosts AuditController, see
 * administration.module.ts) can import this without creating a module
 * cycle — see docs/audit-architecture.md.
 */
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
