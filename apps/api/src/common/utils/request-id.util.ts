import type { Request } from 'express';

/**
 * pino-http (see app.module.ts) assigns `req.id` for log correlation, but
 * its ambient IncomingMessage augmentation types it as `ReqId` (string |
 * number | object), not directly assignable to `string | undefined` —
 * same pragmatic escape hatch used in all-exceptions.filter.ts. genReqId
 * (app.module.ts) always returns a string, so the runtime check is just
 * defensive. Used by both company-context (RequestContext.requestId) and
 * auth (pre-company-context audit events) so AuditLog.requestId can be
 * populated without every call site repeating the cast.
 */
export function getRequestId(request: Request): string | undefined {
  const id = (request as unknown as { id?: unknown }).id;
  return typeof id === 'string' ? id : undefined;
}
