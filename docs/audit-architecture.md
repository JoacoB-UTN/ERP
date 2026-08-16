# Audit trail

This document covers the business/administrative audit trail: how it's
modeled, how backend services write to it, how it's protected, and how
Gestión presents it. Read this before adding an operation that should
leave a trace, or before touching `apps/api/src/audit`.

See also [authorization.md](authorization.md) (permissions gating who can
*read* the audit trail) and [multi-company-architecture.md](multi-company-architecture.md)
(company isolation, which the audit trail inherits).

## Purpose

The ERP must be able to answer, for a critical operation:

```
Who did it?            → AuditLog.userId (+ actorName/actorEmail snapshot)
When?                   → AuditLog.occurredAt
In which company?       → AuditLog.companyId
What operation?         → AuditLog.action
Which entity?           → AuditLog.entityType / entityId
What changed?           → AuditLog.beforeData / afterData / metadata
From which session/request? → AuditLog.sessionId / requestId
```

This is part of the ERP's **data integrity model** — not optional debug
logging, and not something a normal user or even most admin operations can
turn off, bypass, or delete.

## AuditLog vs. application logs

Two distinct systems exist, and they are never merged:

| | Application logs (nestjs-pino) | AuditLog (Postgres table) |
|---|---|---|
| Purpose | Errors, performance, infra, diagnostics | Business/administrative actions, security-sensitive changes |
| Audience | Engineers, on-call | Business administrators, auditors |
| Retention | Rotated/ephemeral, external sink in prod | Durable, part of the primary database |
| Correlates via | `requestId` (pino `req.id`) | `requestId` (same value, for cross-referencing) |

`AuthService`'s `securityLogger` (application log) and `AuditService`
(this document) both exist side by side in `apps/api/src/auth/auth.service.ts`
— e.g. a failed login is logged (`securityLogger.warn`) but never audited
(see "Failed operations" below); a successful login is both logged *and*
audited, because it's also a meaningful account-security fact.

## Data model

```prisma
model AuditLog {
  id         String       @id
  tenantId   String?      // nullable — see "Why tenant/company can be null" below
  companyId  String?
  branchId   String?

  userId     String?      // nullable — system processes have no user
  actorName  String?      // snapshot at write time, see "Historical identity"
  actorEmail String?
  sessionId  String?

  action     AuditAction  // stable, closed catalog (see below)
  entityType String       // stable, machine-readable ("Role", not "Rol")
  entityId   String?

  beforeData Json?        // relevant changed fields only, never the full row
  afterData  Json?
  metadata   Json?

  requestId  String?      // correlates with application logs
  ipAddress  String?
  userAgent  String?

  occurredAt DateTime     @default(now()) @db.Timestamptz(6)
}
```

Indexes: `(companyId, occurredAt)`, `(companyId, entityType, entityId)`,
`(companyId, userId, occurredAt)`, `(companyId, action, occurredAt)` — all
the query shapes the list/detail/entity-history endpoints actually use.
No GIN index on the JSON columns — not justified without a demonstrated
need (see CLAUDE.md's "avoid premature abstraction").

### Why tenant/company/branch can be null

Most business events belong to exactly one company. Some don't:

- **LOGIN** happens *before* company selection (see
  `docs/authorization.md`/`multi-company-architecture.md` — authentication
  and company context are deliberately separate steps). At that point
  there is no `companyId`, and — because a `User` has no direct `tenantId`
  column (tenancy is only reachable through `UserCompany` rows, and a user
  can in principle hold memberships across more than one tenant) — no
  single unambiguous `tenantId` either.
- A hypothetical platform-level operation (tenant provisioning, a global
  admin action) may never have a company at all.

`AuditService` never forces a fake companyId/tenantId onto these events —
see CLAUDE.md's "don't force a fake companyId" rule (originally written
for business operations, applied here the same way).

### Audit action catalog

A small, closed, stable set — `entityType` + `metadata` supply the rest of
the context, so the action list doesn't need to grow per-entity:

```
CREATE  UPDATE  DELETE  ACTIVATE  DEACTIVATE
ASSIGN  UNASSIGN  APPROVE  REJECT  CANCEL  VOID
LOGIN  LOGOUT  PASSWORD_CHANGE  PASSWORD_RESET  SESSION_REVOKE
PERMISSIONS_CHANGE  EXPORT
```

Defined once in `packages/shared/src/enums.ts` (`AuditAction`), mirrored
from the Prisma enum the same way every other enum in this codebase is
(see `TenantStatus`/`UserStatus` etc. in the same file). Stored codes stay
English/stable; `AUDIT_ACTION_LABELS` in `packages/shared/src/audit.ts` is
the Spanish presentation layer for Gestión only.

### Entity types

Stable, machine-readable identifiers — `Role`, not `"Rol"`. Today's set
(`AUDITABLE_ENTITY_TYPES` in `packages/shared/src/audit.ts`, also the
allow-list for the entity-history endpoint): `User`, `UserCompany`,
`Role`, `Permission`, `UserRole`, `Company`, `Branch`. Future business
modules will add their own (`Customer`, `SalesInvoice`, `StockMovement`,
...) — this list is meant to grow, one vertical slice at a time, the same
way `packages/shared/src/permissions.ts`'s catalog does.

## Security: sanitization

`AuditSanitizer` (`apps/api/src/audit/audit-sanitizer.ts`) recursively
redacts any object key whose normalized (lowercased, non-alpha-stripped)
form contains a sensitive substring: `password`, `token`, `secret`,
`authorization`, `cookie`, `privatekey`, `apikey`, `cardnumber`, `cvv`,
`certificate`. This runs:

1. **On write** (`AuditService.record`) — every `before`/`after`/`metadata`
   value is sanitized before it reaches Postgres.
2. **On read** (`AuditService.getById`) — sanitized *again* on the way
   out. Defense in depth: never assume old data is safe just because the
   sanitizer in place at insertion time was sufficient (a real risk if the
   sanitizer's pattern list is ever narrowed or a bug slips through it).

This is a safety net, not a substitute for judgment — callers should still
only pass the specific fields that are actually meaningful to the action
(see "Before/after snapshots" below), not entire request bodies.

**No Prisma middleware, no "log every UPDATE."** Automatic ORM-level
auditing produces exactly the kind of noise this system exists to avoid —
see CLAUDE.md. Every audit record traces back to a deliberate
`AuditService.record(...)` call inside the domain service that performed
the mutation.

## Before/after snapshots

Only the relevant *changed business fields*, never the full row. Example —
`RolesService.update`:

```ts
const before = { name: role.name, description: role.description, active: role.active };
// ...
await this.auditService.recordFromContext(ctx, {
  action: 'UPDATE',
  entityType: 'Role',
  entityId: role.id,
  before,
  after: { name: u.name, description: u.description, active: u.active },
}, tx);
```

For a set-valued change (a role's permissions), don't record 40 rows for
one save — record ONE `PERMISSIONS_CHANGE` event with the diff in
`metadata`:

```json
{ "permissionsAdded": ["sales.invoices.cancel"], "permissionsRemoved": ["sales.prices.change"] }
```

`RolesService.replacePermissions` computes this diff once, and skips
writing an audit record entirely if the set didn't actually change (a
no-op save is not a business fact worth recording).

## RequestContext integration

Authenticated, company-scoped mutations never reconstruct actor metadata
by hand. `RequestContext` (`apps/api/src/company-context/types.ts`) now
carries `requestId`/`ipAddress`/`userAgent` alongside the existing
`userId`/`companyId`/`tenantId`/`branchId`/`sessionId`, populated once by
`CompanyContextGuard` from the raw request. `AuditService.recordFromContext(ctx, params, tx)`
derives all of that automatically — callers only supply
`action`/`entityType`/`entityId`/`before`/`after`/`metadata`.

Pre-company-context auth events (LOGIN, LOGOUT, PASSWORD_CHANGE,
PASSWORD_RESET, SESSION_REVOKE) don't have a `RequestContext` yet, so
`AuthService` calls the lower-level `AuditService.record(...)` directly,
building the same ip/userAgent/requestId metadata from `SessionMeta`
(`apps/api/src/auth/session.service.ts`) via `getSessionMeta(req)`.

### Request ID correlation

`requestId` is pino-http's `req.id` (see `app.module.ts`'s `genReqId`) —
the same value that appears in every application log line for that
request, via `apps/api/src/common/utils/request-id.util.ts`'s
`getRequestId()`. This lets an operator go from an audit record to the
exact application log lines for that request, or vice versa. It is never
surfaced in the main Gestión audit table — only in the detail view's
"Detalle técnico (avanzado)" section, and only for users who already have
`administration.audit.read`.

## Transaction semantics

**Critical business mutations commit atomically with their audit
record.** Every write path in `RolesService` (create, update,
deactivate/remove, replacePermissions, assignRole, removeRole) wraps the
Prisma mutation AND `auditService.recordFromContext(ctx, params, tx)` in
the same `prisma.$transaction(async (tx) => {...})`. If the audit insert
fails (e.g. a constraint violation), the whole transaction rolls back —
"role changed successfully but audit silently missing" cannot happen for
these operations. See `apps/api/test/audit.e2e-spec.ts` for a test that
forces the audit write itself to fail (an invalid FK) and asserts the
paired business mutation rolled back too.

**Auth/security events are best-effort, not transactional.** LOGIN,
LOGOUT, PASSWORD_CHANGE, PASSWORD_RESET, and SESSION_REVOKE call a private
`AuthService.safeAudit()` helper that catches and logs (never rethrows) a
failed audit write. Rationale: unlike a role edit — where an
administrator explicitly expects "this is a tracked change" — blocking a
user's login or password change on an audit-table hiccup would be a worse
failure mode than an occasional missing audit row for a routine security
event that's already independently visible in application logs
(`securityLogger`).

**No automatic retry/dedup framework.** `prisma.$transaction` here is a
single attempt with no built-in retry, so no artificial duplicate-record
risk exists to guard against — see CLAUDE.md's "don't build machinery you
don't need."

## Company isolation

Every read path is scoped by the validated `RequestContext.companyId`,
never a client-supplied value used directly, and never trusts an id alone
(same rule as every other company-owned lookup in this codebase — see
CLAUDE.md):

- `GET /administration/audit` — `WHERE companyId = ctx.companyId`, plus filters.
- `GET /administration/audit/:id` — `findFirst({ where: { id, companyId: ctx.companyId } })`.
  A record that exists but belongs to a different company responds
  identically to one that doesn't exist at all (`AUDIT_LOG_NOT_FOUND`,
  404) — see `AuditLogNotFoundException`.
- `GET /administration/audit/entity/:entityType/:entityId` — same
  company scoping, plus `entityType` is validated against
  `AUDITABLE_ENTITY_TYPES` before it ever reaches a query (400
  `UNSUPPORTED_AUDIT_ENTITY_TYPE` otherwise) — no arbitrary dynamic table
  access.

Platform-level records (`companyId: null`) never appear in these
endpoints — there is no platform-admin capability yet that would need
them (see "Deferred").

## Historical actor identity

`AuditLog.actorName`/`actorEmail` are resolved once, by `AuditService.record`,
at write time — a lookup by `userId`, snapshotted onto the row. This is
informational only; `userId` (indexed, FK) remains the durable key for
"every action by this user." The snapshot exists so that if a user is
later renamed, old audit history still reads correctly ("Juan Pérez
modificó el rol X" stays true to what was displayed at the time) instead
of silently updating to whatever the user is called today.

## Immutability

No controller anywhere exposes `PATCH`/`PUT`/`DELETE` for `AuditLog`.
`AuditController` (`apps/api/src/administration/audit.controller.ts`) is
read-only by construction — three `GET` routes, nothing else. Data
retention/archival through a controlled system process is explicitly
future/out-of-scope (see "Deferred").

## Permissions

- `administration.audit.read` — required for every audit route.
- `administration.audit.export` — reserved for a future `EXPORT` audit
  action once exports of sensitive data actually exist; not required by
  any route today.

Neither is granted automatically to every role. Per the seeded system
roles (`apps/api/prisma/seed.ts`), only **Administrador** (`'ALL'`
permissions) holds `administration.audit.read` — Gerente and every other
system role deliberately do not, matching their existing conservative
defaults (Gerente doesn't hold `administration.roles.read`/
`administration.users.read` either). SALES/WAREHOUSE/VIEWER never get it
without an explicit, separate decision.

## Reads are not audited

`GET`/list/search/page-view traffic is never audited by default — that
would produce enormous, low-value noise. The audit scope is mutations and
high-value security events (login/logout/password/session changes). A
later, deliberate decision could add audited reads for specific sensitive
views (viewing payroll, exporting accounting data) — see "Deferred."

## Failed operations

A mutation that fails validation and rolls back does **not** get an audit
record — application/security logs already capture the failure, and the
audit trail should describe facts that actually happened, not attempts.
This is different from a future domain action like "purchase order
rejected" — a rejection is itself a successful business fact (the
approver *did* reject it) and should be audited as such (e.g. `REJECT`
against `PurchaseOrder`), not treated as a failure.

## Entity history (reusable, not yet surfaced per-entity)

`AuditService.getEntityHistory(companyId, entityType, entityId, pagination)`
is the same paginated query as the main list, pre-filtered by entity —
this is what a future business entity's "Historial" tab will call. It's
already exposed today at `GET /administration/audit/entity/:entityType/:entityId`
(company-scoped, `administration.audit.read`, `entityType` restricted to
`AUDITABLE_ENTITY_TYPES`) even though no entity currently has a
"Historial" tab in the UI — see "Deferred."

## Gestión UI

`/administracion/auditoria` (Gestión only — see CLAUDE.md, audit
administration belongs to Gestión, not Facturación; Facturación's future
operations will still generate audit records through backend domain
services, the operator just never sees the audit UI itself). Gated by
`administration.audit.read` both in the sidebar (hidden if absent) and on
direct navigation (`<Unauthorized/>` if absent) — frontend visibility is
UX, the backend route is independently gated regardless.

- **List**: Fecha y hora / Usuario / Acción / Entidad / Detalle breve
  columns, no raw JSON. Compact default filters (Desde/Hasta/Acción) with
  a "Más filtros" progressive-disclosure toggle for Usuario/Tipo de
  entidad. Paginated (25/page), newest first.
- **Detail**: who/when/action/entity header, then a readable diff — a
  dedicated renderer for `PERMISSIONS_CHANGE` (added/removed permission
  labels), a generic field-by-field before/after renderer for everything
  else, and raw JSON tucked behind a collapsed "Detalle técnico" section
  for advanced inspection only.

Action/entity/field labels are translated via `packages/shared/src/audit.ts`
(`auditActionLabel`, `auditEntityLabel`, `auditFieldLabel`) — small,
hand-maintained maps; unknown values fall back to the raw code rather than
growing into an all-purpose translation engine (see CLAUDE.md's
anti-over-engineering guidance).

## Deferred (explicitly out of scope for this task)

- Business module integration: customers, products, inventory, sales,
  purchases, treasury, accounting, fiscal documents. No new audit actions
  or entity types for these exist yet — they'll be added one vertical
  slice at a time, following the same `AuditService.recordFromContext`
  pattern established here.
- Exports of sensitive/business data (`EXPORT` action is reserved, not
  wired to anything).
- Generic sensitive-read auditing (viewing payroll, restricted cost data).
- A "Historial" tab inside any business entity screen (the backing query
  and endpoint exist; no UI consumes them yet).
- Data retention/archival policy and tooling.
- Sending audit records to any external/observability system — the
  primary record is Postgres; nothing here streams to an outbox or
  external sink.
