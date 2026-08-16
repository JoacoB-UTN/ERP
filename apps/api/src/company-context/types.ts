/**
 * Validated, request-scoped operating context: "which company (and
 * optionally branch) is this request allowed to act as," derived AFTER
 * verifying the authenticated user's membership — never trusted from the
 * client as-is. See CLAUDE.md and docs/multi-company-architecture.md.
 *
 * Deliberately IDs only (no embedded Company/Tenant/Branch entities) so
 * services stay decoupled from Prisma shapes and this stays cheap to pass
 * around/log.
 */
export interface RequestContext {
  userId: string;
  companyId: string;
  tenantId: string;
  branchId?: string;
  sessionId?: string;
  /**
   * Correlation/audit metadata, populated automatically by
   * CompanyContextGuard from the raw request — so AuditService callers
   * never have to reconstruct it by hand (see CLAUDE.md and
   * docs/audit-architecture.md). Not used for authorization decisions.
   */
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
}
