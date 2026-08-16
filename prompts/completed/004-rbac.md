# 004 — RBAC / Roles and Permissions

Status: DONE

## Implemented scope

`apps/api/src/authorization` + `src/administration`.
Role/Permission/RolePermission/UserRole, `PermissionGuard` +
`@RequirePermissions()`, `GET /context/permissions`, role CRUD +
permission-replace, user↔role assignment. 8 system roles seeded per
company (Administrador, Gerente, Ventas, Depósito, Compras, Tesorería,
Contabilidad, Solo lectura). Frontend `usePermissions()`/`can()`/
`canAny()`/`canAll()`. Gestión: Administración → Roles/Usuarios.

## Relevant docs

[docs/authorization.md](../../docs/authorization.md)

## Verification

`apps/api/test/authorization.e2e-spec.ts` (9 mandatory scenarios).
