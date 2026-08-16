import type { AuditAction } from '@erp/shared';
import type { RequestContext } from '../company-context/types';

/**
 * Input to AuditService.record(). Deliberately flat and plain — every
 * field is nullable/optional except `action`/`entityType`, since some
 * events (system processes, pre-company-context auth events) legitimately
 * have less context than a full authenticated business mutation. See
 * docs/audit-architecture.md.
 */
export interface AuditRecordInput {
  tenantId?: string | null;
  companyId?: string | null;
  branchId?: string | null;
  userId?: string | null;
  sessionId?: string | null;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  /** Relevant changed business fields only — never the entire row (see CLAUDE.md). */
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
}

/** The subset of an audited mutation's params that comes from RequestContext — see AuditService.recordFromContext. */
export type AuditRecordFromContextInput = Pick<
  AuditRecordInput,
  'action' | 'entityType' | 'entityId' | 'before' | 'after' | 'metadata'
>;

export type { RequestContext };

export interface AuditListFilters {
  dateFrom?: Date;
  dateTo?: Date;
  userId?: string;
  action?: AuditAction;
  entityType?: string;
  entityId?: string;
}

export interface AuditPaginationInput {
  page: number;
  pageSize: number;
}
