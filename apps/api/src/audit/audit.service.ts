import { Injectable } from '@nestjs/common';
import type {
  AuditListResponse,
  AuditEntityHistoryResponse,
  AuditLogDetail,
  AuditLogSummary,
} from '@erp/shared';
import { PrismaService } from '../database/prisma.service';
import { AuditSanitizer } from './audit-sanitizer';
import type {
  AuditListFilters,
  AuditPaginationInput,
  AuditRecordFromContextInput,
  AuditRecordInput,
  RequestContext,
} from './audit.types';
import type { AuditLog, Prisma } from '../generated/prisma/client';

function toJsonInput(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return AuditSanitizer.sanitize(value) as Prisma.InputJsonValue;
}

function toSummary(row: AuditLog): AuditLogSummary {
  return {
    id: row.id,
    occurredAt: row.occurredAt.toISOString(),
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    branchId: row.branchId,
    user: row.userId ? { id: row.userId, name: row.actorName } : null,
  };
}

function toDetail(row: AuditLog): AuditLogDetail {
  return {
    ...toSummary(row),
    companyId: row.companyId,
    userEmail: row.userId ? row.actorEmail : null,
    // Defense in depth (see docs/audit-architecture.md): re-sanitize on the
    // way out too, rather than trusting that the sanitizer in place at
    // insertion time is still sufficient for old rows.
    beforeData: AuditSanitizer.sanitize(row.beforeData),
    afterData: AuditSanitizer.sanitize(row.afterData),
    metadata: AuditSanitizer.sanitize(row.metadata),
    requestId: row.requestId,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
  };
}

function buildWhere(
  companyId: string,
  filters: AuditListFilters,
): Prisma.AuditLogWhereInput {
  return {
    companyId,
    ...(filters.action ? { action: filters.action } : {}),
    ...(filters.entityType ? { entityType: filters.entityType } : {}),
    ...(filters.entityId ? { entityId: filters.entityId } : {}),
    ...(filters.userId ? { userId: filters.userId } : {}),
    ...(filters.dateFrom || filters.dateTo
      ? {
          occurredAt: {
            ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
            ...(filters.dateTo ? { lte: filters.dateTo } : {}),
          },
        }
      : {}),
  };
}

/**
 * Single write/read path for the business audit trail — see
 * docs/audit-architecture.md. Never called from a Prisma middleware or any
 * other "automatic" mechanism (see CLAUDE.md): every call site is a
 * deliberate statement of "this is a meaningful thing a user/process did,"
 * chosen by the domain service that performed the mutation.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Writes one AuditLog row. Pass `tx` (the callback param of
   * `prisma.$transaction(async (tx) => {...})`) for any mutation that must
   * commit atomically with its audit record — see CLAUDE.md and section 14
   * of docs/audit-architecture.md. Resolves and snapshots the actor's
   * current name/email once, at write time (never re-derived later), so
   * history stays readable even if the user is later renamed.
   */
  async record(
    input: AuditRecordInput,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;

    let actorName: string | null = null;
    let actorEmail: string | null = null;
    if (input.userId) {
      const actor = await client.user.findUnique({
        where: { id: input.userId },
        select: { firstName: true, lastName: true, email: true },
      });
      if (actor) {
        actorName = `${actor.firstName} ${actor.lastName}`.trim();
        actorEmail = actor.email;
      }
    }

    await client.auditLog.create({
      data: {
        tenantId: input.tenantId ?? null,
        companyId: input.companyId ?? null,
        branchId: input.branchId ?? null,
        userId: input.userId ?? null,
        actorName,
        actorEmail,
        sessionId: input.sessionId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        beforeData: toJsonInput(input.before),
        afterData: toJsonInput(input.after),
        metadata: toJsonInput(input.metadata),
        requestId: input.requestId ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  }

  /**
   * Convenience wrapper for the common case: an authenticated,
   * company-scoped mutation. Derives tenantId/companyId/branchId/userId/
   * sessionId/requestId/ipAddress/userAgent from the validated
   * RequestContext so callers never manually reconstruct that metadata
   * (see CLAUDE.md) — they only supply what's specific to the action.
   */
  recordFromContext(
    ctx: RequestContext,
    params: AuditRecordFromContextInput,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    return this.record(
      {
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        branchId: ctx.branchId ?? null,
        userId: ctx.userId,
        sessionId: ctx.sessionId ?? null,
        requestId: ctx.requestId ?? null,
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ?? null,
        ...params,
      },
      tx,
    );
  }

  /** Company-scoped, paginated, newest first — never an unbounded table scan. */
  async list(
    companyId: string,
    filters: AuditListFilters,
    pagination: AuditPaginationInput,
  ): Promise<AuditListResponse> {
    const where = buildWhere(companyId, filters);
    const skip = (pagination.page - 1) * pagination.pageSize;

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip,
        take: pagination.pageSize,
      }),
    ]);

    return {
      items: rows.map(toSummary),
      pagination: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total,
      },
    };
  }

  /** Never trust an ID alone — always scoped by the validated companyId (see CLAUDE.md). */
  async getById(companyId: string, id: string): Promise<AuditLogDetail | null> {
    const row = await this.prisma.auditLog.findFirst({
      where: { id, companyId },
    });
    return row ? toDetail(row) : null;
  }

  /**
   * Reusable query backing per-entity "Historial" tabs (Customer's today,
   * see docs/customers.md; future business entities later) — restricted to
   * a known entityType by the caller (AuditController/CustomersController
   * validate before this is ever reached). Returns full detail per row
   * (not the lean list summary) so a readable inline diff can be rendered
   * without an N+1 detail fetch per event — see AuditEntityHistoryResponse.
   */
  async getEntityHistory(
    companyId: string,
    entityType: string,
    entityId: string,
    pagination: AuditPaginationInput,
  ): Promise<AuditEntityHistoryResponse> {
    const where = buildWhere(companyId, { entityType, entityId });
    const skip = (pagination.page - 1) * pagination.pageSize;

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip,
        take: pagination.pageSize,
      }),
    ]);

    return {
      items: rows.map(toDetail),
      pagination: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total,
      },
    };
  }
}
