# Architecture

High-level, current-state view of the system. For rules (not just
description), see [AGENTS.md](../AGENTS.md). For what's actually
implemented vs. planned, see [implementation-status.md](implementation-status.md).

## Diagram

```
                         PostgreSQL 16  ──  Redis 7
                               │
                         apps/api (NestJS)
                     modular monolith, one process
                               │
                ┌──────────────┴──────────────┐
                │                              │
          apps/gestion                  apps/facturacion
          (backoffice)                  (fast operational sales)
                                                │
                                                └── POS mode
                                                    (/pos — see docs/pos.md)
```

One backend, one database, one set of users/companies/domain rules.
Gestión and Facturación are two Next.js frontends against the same API —
neither owns its own copy of business logic. There is no `apps/pos` —
POS is a mode inside Facturación, not a separate frontend.

## Repository map

```
apps/
  api/            NestJS backend — the only backend
  gestion/        Next.js — ERP backoffice ("Gestión")
  facturacion/    Next.js — fast operational sales app ("Facturación")
packages/
  config/             Shared, validated environment schema (Zod)
  shared/             Framework-agnostic types + Zod schemas used by API and both frontends
  auth-client/        Shared TanStack Query client (auth, company context, and one hook
                       module per implemented domain: customers, products, inventory,
                       pricing, warehouses, administration, audit)
  eslint-config/      Shared ESLint flat config (base + NestJS variant)
  typescript-config/  Shared tsconfig bases
infrastructure/   Reserved for deployment infra (empty placeholder)
docs/             This documentation set
prompts/          Durable task specifications — see prompts/README.md
.github/          CI workflow, PR template, issue templates
```

## Backend (`apps/api`)

NestJS + TypeScript + Prisma + PostgreSQL + Redis, one process, `/api/v1`
prefix. Modular monolith: one Nest module per bounded domain area, each
with its own `*.service.ts` (business logic), `*.controller.ts` (thin —
validation + delegation), and `*.exceptions.ts` (typed, coded errors).

Implemented modules (see `apps/api/src/app.module.ts` for the exact
import list):

| Module | Path | Owns |
| --- | --- | --- |
| Config | `src/config` | Validated env (`AppConfigModule`), fails fast on boot |
| Database | `src/database` | `PrismaService` (global), `@prisma/adapter-pg` |
| Redis | `src/redis` | Connection only — no queues wired up (see `src/queue/README.md`) |
| Health | `src/health` | `GET /api/v1/health` |
| Auth | `src/auth` | Login/refresh/logout/me, password reset, sessions |
| Company context | `src/company-context` | `X-Company-Id`/`X-Branch-Id`, `RequestContext` |
| Authorization | `src/authorization` | `PermissionGuard`, `@RequirePermissions()` |
| Administration | `src/administration` | Roles, users, audit read endpoints |
| Audit | `src/audit` | `AuditService`, sanitization, entity history |
| Customers | `src/customers` | Customer master data |
| Products | `src/products` | Product catalog |
| Warehouses | `src/warehouses` | Warehouse master data |
| Inventory | `src/inventory` | Stock ledger, adjustments, reservations |
| Pricing | `src/pricing` | Price lists, resolution, price history |
| Sales | `src/sales` | `SalesDocument` (internal sale, not a fiscal invoice), draft/confirm/cancel, `SalesTender` |

`src/modules/*` is a **stale leftover** from the original foundation
commit — one README-only placeholder folder per originally-planned domain
(customers, products, sales, purchases, accounting, ...). Several of
these domains are now implemented for real under `src/<module>` (not
`src/modules/<module>`) — see
[implementation-status.md](implementation-status.md#known-technical-debt).

## Database

PostgreSQL 16, one schema, Prisma ORM (`apps/api/prisma/schema.prisma`),
one migration per schema change under `apps/api/prisma/migrations/`.
Multi-tenant by design: `Tenant` → `Company` → `Branch`, with every
business/master-data table carrying `tenantId` + `companyId` and scoped
accordingly (see AGENTS.md's company-isolation rule). `apps/api/prisma/seed.ts`
provides deterministic, idempotent demo data.

## Authentication

`src/auth`. Argon2id password hashing; short-lived JWT access tokens
(httpOnly cookie) + rotating refresh sessions stored server-side as
`UserSession` (hashed token); password reset via `PasswordResetToken`
(hashed, single-use, expiring); rate limiting and structured security-event
logging. Full detail: inline in `src/auth` and the "Authentication"
section of the root [README.md](../README.md).

## Company context

`src/company-context`. Answers "which company/branch is this request
operating against" — separate from authentication (who) and authorization
(what they may do). See
[multi-company-architecture.md](multi-company-architecture.md).

## Authorization

`src/authorization` + `src/administration`. Role/Permission/RolePermission/
UserRole; effective permissions are the union of every active role a user
holds in the active company. See [authorization.md](authorization.md).

## Audit

`src/audit`. Company-scoped `AuditLog` of business/administrative
mutations and account-security events — distinct from application logs.
See [audit-architecture.md](audit-architecture.md).

## Customers

`src/customers`. Company-scoped customer master data — addresses,
contacts, categories, CUIT/document validation. See
[customers.md](customers.md).

## Products

`src/products` + `src/warehouses`. Catalog master data
(Product/ProductVariant/ProductCode/ProductCategory/Brand/UnitOfMeasure).
See [products.md](products.md).

## Inventory

`src/inventory`. Ledger-based stock: `StockMovement` is the only
authoritative source of physical inventory, `InventoryBalance` a
rebuildable projection. Reservations, stock adjustments (draft/confirm/cancel),
concurrency-safe balance mutation. See [inventory.md](inventory.md).

## Pricing

`src/pricing`. `Currency` (global reference data) + `PriceList` +
`PriceListItem` + `PriceHistory`; FIXED vs. DERIVED price-list resolution,
Decimal-safe arithmetic, bulk adjustment, price history distinct from
`AuditLog`. See [pricing.md](pricing.md).

## Sales

`src/sales`. `SalesDocument`/`SalesDocumentLine` — an internal commercial
transaction (document type `SALE` only), never a fiscal/electronic
invoice. DRAFT/CONFIRMED/CANCELLED state machine, atomic + idempotent
confirmation, price snapshot via `PricingService`, inventory decrement
via `InventoryService`. `SalesTender` (POS/Facturación payment metadata)
is an operational snapshot, never a Treasury ledger. This is the one
Sales domain — Gestión's `/ventas`, Facturación's `/ventas/nueva`, and
POS's `/pos` all call the same `SalesService`, never a parallel
implementation. See [sales.md](sales.md), [facturacion.md](facturacion.md),
and [pos.md](pos.md).

## Frontend: Gestión (`apps/gestion`)

Next.js (App Router) + TypeScript + Tailwind + shadcn/ui + TanStack Query
+ React Hook Form + Zod. Sidebar + top-bar shell, session/company/
permission-gated `(app)` route group. Current nav: Clientes, Productos
(+ Categorías/Marcas/Unidades), Listas de precios, Ventas, Stock
(Existencias/Movimientos/Ajustes/Depósitos), Administración
(Usuarios/Roles/Auditoría).

## Frontend: Facturación (`apps/facturacion`)

Next.js (App Router), same stack. Single top-bar shell (deliberately no
sidebar — see [product-ui-principles.md](product-ui-principles.md)),
same auth pages. Company/branch/warehouse/price-list selectors live in
the top bar. A real operational sale workflow (`/ventas/nueva`,
`/ventas/:id`, `/ventas`) and a keyboard-first POS checkout mode (`/pos`)
both call the exact same backend `SalesService` Gestión's own `/ventas`
uses — see [facturacion.md](facturacion.md) and [pos.md](pos.md).

## Shared packages

- `packages/shared` — Zod schemas, TypeScript types, enums, and Spanish
  label maps used identically by the API and both frontends. This is
  where "don't duplicate domain logic between frontends" is enforced in
  practice — validation and shape live here once.
- `packages/auth-client` — a `createAuthClient(config)` factory each app
  calls once with its own API base URL and `storageKeyPrefix`, returning
  every TanStack Query hook for auth, company/branch/warehouse/price-list
  context, and each implemented domain module.

Neither frontend app talks to the database or re-implements a domain
rule — both call the same hooks against the same API.
