# 005 — Audit / Traceability

Status: DONE

## Implemented scope

`apps/api/src/audit`. Company-scoped `AuditLog`, `AuditSanitizer`,
per-entity history endpoint, transactional recording pattern
(`AuditService.recordFromContext(..., tx)`). Wired into Roles, Auth
(security events), and every later business module (Customers, Products,
Warehouses, Inventory, Pricing). Gestión: Administración → Auditoría
list/detail.

## Relevant docs

[docs/audit-architecture.md](../../docs/audit-architecture.md)

## Verification

`apps/api/test/audit.e2e-spec.ts`.
