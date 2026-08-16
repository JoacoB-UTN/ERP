# Authorization (RBAC)

This document covers how the platform decides "what may this authenticated
user, operating this specific company, actually do." Read this before
adding any permission-protected backend endpoint or any UI that should be
gated by what the user can do.

See also [multi-company-architecture.md](multi-company-architecture.md)
for company context (a prerequisite this builds on) and the root
[CLAUDE.md](../CLAUDE.md) for the permanent rules extracted from this doc.

## Three separate questions, three separate mechanisms

```
Authentication        →  Who is the user?
Company Context       →  Which company are they operating?
Authorization (RBAC)  →  What may they do inside that company?
```

Each is a distinct mechanism (`apps/api/src/auth`, `apps/api/src/company-context`,
`apps/api/src/authorization` + `apps/api/src/administration`). None of them
substitutes for another:

- A valid session does not imply company access.
- Active company membership (`UserCompany`) does not imply any specific
  permission — it only answers "can this user act as this company at
  all," never "what may they do there."
- A role assignment (`UserRole`) is meaningless without active
  `UserCompany` membership first — see below.

## Data model

```
User
 │
 ├── UserCompany ──────────────► Company ──► Tenant
 │      (can they access this company at all?)
 │
 └── UserRole (scoped to one company)
      │
      ▼
     Role (scoped to one company — never shared across companies)
      │
      ▼
 RolePermission
      │
      ▼
 Permission (platform-defined, stable "module.resource.action" code)
```

- **`Permission`** — a stable, system-defined capability code (e.g.
  `administration.roles.read`). Not user-inventable; the catalog lives in
  `packages/shared/src/permissions.ts` and is seeded deterministically.
- **`Role`** — a named bundle of permissions, scoped to exactly one
  `(tenantId, companyId)`. `isSystem: true` roles are seeded per company
  and can never be deleted or renamed. The same role name can exist in
  different companies as entirely separate rows — roles are never shared
  across companies, even within the same tenant.
- **`RolePermission`** — the many-to-many join, composite PK `(roleId, permissionId)`.
- **`UserRole`** — a role assignment scoped to `(userId, roleId, companyId)`.
  The service layer enforces `role.companyId === userRole.companyId` (Prisma
  can't express that constraint declaratively) and requires the target
  user to already have active `UserCompany` membership for that company.

A user can hold **different roles in different companies** — e.g. ADMIN in
Company A, VIEWER in Company B — and **multiple roles in the same
company** at once (effective permissions are the union; see below).

## Effective permissions

```
Role A: customers.read, sales.orders.read
Role B: sales.orders.create
─────────────────────────────────────────
Effective: customers.read, sales.orders.read, sales.orders.create
```

Effective permissions for `(userId, companyId)` are the union of every
`Permission.code` reachable through every **active** `Role` the user holds
an **active** `UserRole` for, in that exact company. No allow/deny conflict
resolution exists in this version — a permission is either granted (by at
least one active role) or it isn't.

An inactive role, or an inactive `UserCompany` membership, contributes
nothing — see `AuthorizationService.computeEffectivePermissions` and
`CompanyContextGuard` (membership is checked first, before authorization
ever runs — see request flow below).

## Request flow

```
Request (+ X-Company-Id, + cookie)
        │
        ▼
  JwtAuthGuard            — valid session? (401 if not)
        │
        ▼
  CompanyContextGuard      — active UserCompany membership? valid company/tenant? (400/403 if not)
        │                    attaches RequestContext { userId, companyId, tenantId, ... }
        ▼
  PermissionGuard          — effective permissions include every @RequirePermissions() code? (403 if not)
        │
        ▼
    Controller  →  Application service
```

`@RequirePermissions('administration.roles.read')` applies all three
guards, in that order, in one decorator — see
`apps/api/src/authorization/decorators/require-permissions.decorator.ts`.
No controller calls `AuthorizationService` directly; nothing manually
re-parses headers. Authorization always uses the already-validated
`RequestContext` — **never** a company ID from anywhere else (request
body, query string). See CLAUDE.md.

### Error codes

| Code                        | Status | Meaning                                                                                                                                                         |
| --------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PERMISSION_DENIED`         | 403    | Authenticated, valid company context, missing permission. Message is deliberately generic — never states which permission was missing (server logs do, safely). |
| `ROLE_NOT_FOUND`            | 404    | Role doesn't exist, or belongs to a different company than the active context — identical response either way (see "don't leak existence," CLAUDE.md).          |
| `SYSTEM_ROLE_PROTECTED`     | 400    | Attempted to rename/deactivate/delete a system role.                                                                                                            |
| `UNKNOWN_PERMISSION_CODE`   | 400    | `PUT .../permissions` included a code that isn't in the catalog.                                                                                                |
| `USER_NOT_COMPANY_MEMBER`   | 400    | Attempted to assign a role to a user without active `UserCompany` membership in the active company.                                                             |
| `DUPLICATE_ROLE_ASSIGNMENT` | 409    | The user already holds that exact role in that company.                                                                                                         |
| `LAST_SECURITY_ADMIN`       | 409    | See below.                                                                                                                                                      |

## Permission cache

`AuthorizationService` caches effective permissions in Redis under
`authz:{userId}:{companyId}` with a 30s TTL — short on purpose (see
CLAUDE.md: correctness over cache speed). Every mutation that can change a
user's effective permissions explicitly invalidates the relevant key(s)
rather than waiting out the TTL:

- Assigning/removing a `UserRole` → invalidates that one `(userId, companyId)` key.
- Changing a role's permission set, or its `active` flag → invalidates every
  user currently assigned that role, in that company.

If Redis is unreachable, `AuthorizationService` falls back to computing
from Postgres directly rather than failing the request — a cache outage
must never become an authorization outage (or a security gap).

## Preventing a company from locking itself out

Deactivating a role, removing a user's last relevant role assignment, or
stripping `administration.roles.assign` from a role's permission set could
otherwise leave a company with **zero** users able to manage roles at all
— an unrecoverable state (see CLAUDE.md, "privilege accident" protection).

`RolesService.assertNotOrphaningSecurityAdministration` refuses such an
action with `LAST_SECURITY_ADMIN` (409) when it would drop the count of
distinct users holding `administration.roles.assign` (via any active role)
to zero. **Scope**, deliberately kept narrow and understandable:

- Direct role-assignment removal (`DELETE /administration/users/:userId/roles/:roleId`).
- Disabling a role (`DELETE /administration/roles/:id`, or `PATCH` with `active: false`).
- Replacing a role's permission set in a way that drops `administration.roles.assign`.

It does **not** attempt to reason about every conceivable path to the same
outcome (e.g. it doesn't simulate cumulative effects across multiple
in-flight requests). This is a safety net against the common accident, not
a formal proof of non-lockout.

## System roles (seeded per company)

| Role          | Purpose                                                                                               |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| Administrador | Every permission in the catalog — see below, not a hardcoded `role === 'ADMIN'` check.                |
| Gerente       | Broad read visibility across modules; no security administration.                                     |
| Ventas        | `apps.facturacion.access` + read/create/update on orders and invoices — never costs or price changes. |
| Depósito      | `apps.gestion.access` + inventory read/adjust/transfer.                                               |
| Compras       | `apps.gestion.access` + purchase order read/create/approve.                                           |
| Tesorería     | Receipts/payments in both apps.                                                                       |
| Contabilidad  | Accounting entries + reports.                                                                         |
| Solo lectura  | Read-only across the operation.                                                                       |

Full permission lists: `apps/api/prisma/seed.ts` (`SYSTEM_ROLES`). Every
company seeded by `prisma/seed.ts` gets all 8; the dev admin holds
Administrador in both demo companies.

**Why ADMIN is "assign every permission" instead of a special-cased role
name:** so the exact same `PermissionGuard`/`AuthorizationService`
machinery evaluates every user identically. There is no `if (role === 'ADMIN')`
anywhere in the authorization code path — see CLAUDE.md's permanent rule.

## Application access permissions

`apps.gestion.access` and `apps.facturacion.access` are independent — a
user can hold either, both, or neither. `apps.facturacion.pos.access` is
registered now for the future POS mode (see
[product-ui-principles.md](product-ui-principles.md)) but nothing checks
it yet, since POS isn't implemented.

Both frontend shells check their own app-access permission after company
resolution and show a denial screen (`AppAccessDenied`, Spanish copy) if
it's missing — with "Cambiar empresa" / "Cerrar sesión" actions. **This is
UX, not the security boundary** — every real backend operation is
independently gated by its own `@RequirePermissions()`, so hiding the
frontend shell changes nothing about what the API will actually allow.

## API surface

| Endpoint                                             | Guard                         | Notes                                                                                                               |
| ---------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `GET /context/permissions`                           | `@CompanyScoped()` only       | Your own effective permissions — no permission required to ask this, or no one could discover what they're missing. |
| `GET /administration/roles`                          | `administration.roles.read`   | Roles in the active company.                                                                                        |
| `GET /administration/roles/:id`                      | `administration.roles.read`   | 404 if the role belongs to another company.                                                                         |
| `POST /administration/roles`                         | `administration.roles.create` | `{name, description?}` — tenant/company always come from `RequestContext`, never the request body.                  |
| `PATCH /administration/roles/:id`                    | `administration.roles.update` | System roles reject `name`/`active` changes.                                                                        |
| `DELETE /administration/roles/:id`                   | `administration.roles.delete` | Soft-disable (`active: false`), never a hard delete — see below. System roles rejected.                             |
| `PUT /administration/roles/:id/permissions`          | `administration.roles.update` | Atomic replace; unknown codes rejected as a whole (400), never silently dropped.                                    |
| `GET /administration/permissions`                    | `administration.roles.read`   | The full catalog, for the role editor UI.                                                                           |
| `GET /administration/users`                          | `administration.users.read`   | Only users with active membership to the active company — never a global directory.                                 |
| `GET /administration/users/:userId/roles`            | `administration.roles.assign` |                                                                                                                     |
| `POST /administration/users/:userId/roles`           | `administration.roles.assign` | Validates membership + role-company match + no duplicate.                                                           |
| `DELETE /administration/users/:userId/roles/:roleId` | `administration.roles.assign` | See last-admin protection above.                                                                                    |

### Why DELETE is a soft-disable

A role currently assigned to users must never silently vanish out from
under them — `DELETE /administration/roles/:id` sets `active: false`
rather than removing the row. Every read path already filters/labels by
`active`, so a disabled role stops granting anything immediately (with
cache invalidation) without breaking foreign-key history on `UserRole`/
`RolePermission`. System roles reject the operation entirely.

## Frontend

`packages/auth-client`'s `usePermissions()` returns `{ permissions, can(code), canAny([...]), canAll([...]) }`,
backed by a TanStack Query keyed `["company", companyId, "permissions"]` —
see CLAUDE.md's cache-isolation rule: switching the active company changes
the key, so a previous company's permissions can never leak into the new
one, and `useActiveCompany().setActiveCompany()` already clears every
`"company"`-rooted query on an explicit switch.

Used for:

- **Application access** — `apps/gestion` and `apps/facturacion`'s
  `(app)/layout.tsx` check `apps.gestion.access`/`apps.facturacion.access`
  respectively, after company resolution, before rendering the shell.
- **Navigation visibility** — Gestión's sidebar only shows "Administración
  → Usuarios/Roles" if the corresponding `*.read` permission is present.
- **Direct-route handling** — every `/administracion/*` page independently
  re-checks its own required permission and renders `<Unauthorized/>` if
  it's missing, so navigating there directly (bookmark, typed URL) doesn't
  require finding the hidden nav link first. The API still returns 403
  regardless — the frontend check only avoids a confusing broken page.

**None of this is the security boundary.** See CLAUDE.md: frontend
permission checks are UX; the backend is authoritative, full stop.

## Deferred (explicitly out of scope for this task)

- Business modules (customers, products, inventory, sales, invoices,
  purchases, treasury, accounting).
- Field-level ACLs (e.g. "can edit `Customer.phone` but not
  `Customer.creditLimit`") — beyond the coarse, deliberately-named
  capabilities already in the catalog (`sales.prices.change`,
  `sales.costs.read`).
- Row-level policies (e.g. "salesperson only sees their assigned
  customers") — will be considered once Sales/Customers exist.
- Per-user branch restrictions — branch context exists
  (`docs/multi-company-architecture.md`) but nothing gates access by
  branch yet; company + permission is the current authorization scope.
- Full audit logging of role/permission changes — no `AuditLog`
  infrastructure exists yet in this codebase, so none was built here. The
  service methods that mutate roles/assignments are the natural hook
  points for a future audit layer (Prompt #5).
