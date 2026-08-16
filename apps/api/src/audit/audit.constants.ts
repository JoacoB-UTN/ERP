import { AUDITABLE_ENTITY_TYPES, type AuditableEntityType } from '@erp/shared';

/** Re-exported from @erp/shared so both the entity-history endpoint's allow-list and the frontend's filter dropdown stay in sync — see docs/audit-architecture.md. */
export { AUDITABLE_ENTITY_TYPES };

export function isAuditableEntityType(
  value: string,
): value is AuditableEntityType {
  return (AUDITABLE_ENTITY_TYPES as readonly string[]).includes(value);
}
