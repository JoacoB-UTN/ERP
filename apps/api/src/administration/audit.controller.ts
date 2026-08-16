import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  auditListQuerySchema,
  auditEntityHistoryQuerySchema,
  type AuditListQuery,
  type AuditEntityHistoryQuery,
  type AuditListResponse,
  type AuditEntityHistoryResponse,
  type AuditDetailResponse,
} from '@erp/shared';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { CurrentRequestContext } from '../company-context/decorators/current-request-context.decorator';
import type { RequestContext } from '../company-context/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AuditService } from '../audit/audit.service';
import { isAuditableEntityType } from '../audit/audit.constants';
import {
  AuditLogNotFoundException,
  UnsupportedAuditEntityTypeException,
} from './administration.exceptions';

/**
 * Read-only — no POST/PATCH/DELETE anywhere in this controller. Audit
 * records are effectively immutable: nothing in the application ever
 * updates or deletes one (see CLAUDE.md). Every route is company-scoped by
 * the validated RequestContext, never by a client-supplied companyId.
 */
@Controller('administration')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @RequirePermissions('administration.audit.read')
  @Get('audit')
  async list(
    @CurrentRequestContext() ctx: RequestContext,
    @Query(new ZodValidationPipe(auditListQuerySchema)) query: AuditListQuery,
  ): Promise<AuditListResponse> {
    return this.auditService.list(
      ctx.companyId,
      {
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        userId: query.userId,
        action: query.action,
        entityType: query.entityType,
        entityId: query.entityId,
      },
      { page: query.page, pageSize: query.pageSize },
    );
  }

  @RequirePermissions('administration.audit.read')
  @Get('audit/entity/:entityType/:entityId')
  async entityHistory(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Query(new ZodValidationPipe(auditEntityHistoryQuerySchema))
    query: AuditEntityHistoryQuery,
  ): Promise<AuditEntityHistoryResponse> {
    if (!isAuditableEntityType(entityType)) {
      throw new UnsupportedAuditEntityTypeException(entityType);
    }
    return this.auditService.getEntityHistory(
      ctx.companyId,
      entityType,
      entityId,
      {
        page: query.page,
        pageSize: query.pageSize,
      },
    );
  }

  @RequirePermissions('administration.audit.read')
  @Get('audit/:id')
  async getById(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<AuditDetailResponse> {
    const auditLog = await this.auditService.getById(ctx.companyId, id);
    if (!auditLog) {
      throw new AuditLogNotFoundException();
    }
    return { auditLog };
  }
}
