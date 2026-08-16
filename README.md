# ERP Platform

A multi-tenant, multi-company ERP platform with two frontend products —
**Gestión** (backoffice) and **Facturación** (fast operational sales,
with a future POS mode) — sharing one backend, one database, and one
domain layer. Authentication, multi-company context, RBAC, audit,
Customers, Products, Inventory, Pricing, and a demo Sales core are
implemented; fiscal invoicing, Purchases, Treasury, Tax/Fiscal,
Accounting, and Reporting are not yet — see
[docs/implementation-status.md](docs/implementation-status.md) for the
verified, current state of every module.

## Documentation

Read [AGENTS.md](AGENTS.md) first — it's the shared rules file for every
coding agent (and human) working in this repository. Then see
[docs/README.md](docs/README.md) for the full documentation index:
architecture, implementation status, roadmap, development workflow, and
the multi-agent collaboration workflow. `CLAUDE.md` supplements
`AGENTS.md` with Claude Code-specific detail.

## Architecture

Modular monolith (not microservices) on the backend, split into **two
separate frontend products** that share the same API/auth/DB/domain
layer. Full stack, repository map, and a diagram:
[docs/architecture.md](docs/architecture.md). Product boundary rationale
and what must never be duplicated between the two frontends:
[docs/product-ui-principles.md](docs/product-ui-principles.md).

## Requirements

- Node.js ≥ 20
- npm (workspaces are used for the monorepo — no pnpm/yarn required)
- PostgreSQL 16 and Redis 7, either via Docker or installed locally

## Setup

```bash
npm install
cp .env.example apps/api/.env             # then edit apps/api/.env if needed
cp .env.example apps/gestion/.env.local    # only NEXT_PUBLIC_API_URL is used here
cp .env.example apps/facturacion/.env.local # same
```

### Infrastructure: Docker (preferred)

```bash
docker compose up -d   # starts postgres (:5433) and redis (:6380)
```

Then point `apps/api/.env`'s `DATABASE_URL`/`REDIS_URL` at those ports (see
`.env.example`, already configured for the compose ports).

### Infrastructure: without Docker

If Docker isn't available, install Postgres 16 and Redis locally (e.g. via
Homebrew: `brew install postgresql@16 redis`) and point `DATABASE_URL`/
`REDIS_URL` in `apps/api/.env` at your local instances instead. This is how
the foundation was actually verified in this environment (Docker wasn't
installed on the build machine) — functionally equivalent, just not via
`docker compose up -d`. See "Decisions" in the PR/commit description for
details.

## Ports

| App                | Port   | URL                            |
| ------------------ | ------ | ------------------------------ |
| `apps/api`         | `3001` | `http://localhost:3001/api/v1` |
| `apps/gestion`     | `3000` | `http://localhost:3000`        |
| `apps/facturacion` | `3002` | `http://localhost:3002`        |

Different `localhost` ports count as the same "site" for browser
same-site-cookie purposes, so the auth session cookies (host-only, no
explicit `Domain`) are shared across all three in local dev without extra
configuration — see `AUTH_COOKIE_DOMAIN` below and `packages/auth-client`.

## Environment variables

Defined and validated in `packages/config/src/env.ts`; the app will not
start if these are missing or malformed.

| Variable                                              | Required      | Default                                       | Notes                                                                                                |
| ----------------------------------------------------- | ------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                            | no            | `development`                                 | `development` \| `test` \| `production`                                                              |
| `API_PORT`                                            | no            | `3001`                                        |                                                                                                      |
| `DATABASE_URL`                                        | **yes**       | —                                             | Postgres connection string                                                                           |
| `REDIS_URL`                                           | **yes**       | —                                             | Redis connection string                                                                              |
| `CORS_ORIGIN`                                         | no            | `http://localhost:3000,http://localhost:3002` | comma-separated allowed origins (Gestión, Facturación)                                               |
| `LOG_LEVEL`                                           | no            | `info`                                        | pino level                                                                                           |
| `AUTH_ACCESS_TOKEN_SECRET`                            | prod: **yes** | dev-only default                              | signs access-token JWTs; app refuses the dev default in production                                   |
| `AUTH_ACCESS_TOKEN_TTL`                               | no            | `15m`                                         |                                                                                                      |
| `AUTH_REFRESH_TOKEN_TTL`                              | no            | `30d`                                         |                                                                                                      |
| `AUTH_COOKIE_DOMAIN`                                  | no            | unset                                         | leave unset in dev (host-only cookie shared across localhost ports); set a real domain in production |
| `AUTH_COOKIE_SECURE`                                  | no            | `false`                                       | set `true` in any HTTPS deployment                                                                   |
| `AUTH_RATE_LIMIT_TTL_SECONDS` / `AUTH_RATE_LIMIT_MAX` | no            | `60` / `10`                                   | rate limiting on login/forgot-password/reset-password/refresh                                        |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`            | prod: **yes** | dev-only default                              | only read by `npm run db:seed`, never by the running API                                             |

`apps/gestion` and `apps/facturacion` only read `NEXT_PUBLIC_API_URL`
(defaults to `http://localhost:3001/api/v1`).

## Database

```bash
npm run db:migrate   # apply migrations (creates the DB schema from empty)
npm run db:seed      # demo Tenant/Company/Branch + real admin user (see Credentials below)
npm run db:studio    # Prisma Studio
```

Models: `Tenant`, `Company`, `Branch`, `User`, `UserCompany`, `UserSession`,
`PasswordResetToken`, `Permission`, `Role`, `RolePermission`, `UserRole`,
`AuditLog`, `Customer`, `CustomerAddress`, `CustomerContact`,
`CustomerCategory`, `CustomerCategoryAssignment`, `CustomerCodeSequence`,
`Product`, `ProductVariant`, `ProductCode`, `ProductCategory`, `Brand`,
`UnitOfMeasure`, `ProductCodeSequence`, `Warehouse`, `StockMovement`,
`InventoryBalance`, `StockReservation`, `StockAdjustment`,
`StockAdjustmentLine`, `StockAdjustmentSequence`, `Currency`, `PriceList`,
`PriceListItem`, `PriceHistory` — see `apps/api/prisma/schema.prisma`.
The seed creates:

- **Demo Organization** (tenant) → **Demo Company**, branches _Casa
  Central_ and _Sucursal 2_, plus **Second Demo Company** — the admin user
  has access to both companies, so multi-company selection is actually
  testable locally.
- **Other Organization** (a separate tenant) → **Other Org Company** —
  deliberately _not_ granted to the seeded admin, for manually exercising
  tenant isolation (see
  [docs/multi-company-architecture.md](docs/multi-company-architecture.md)).
- The full permission catalog (including `administration.audit.read`/`export`
  — see [docs/audit-architecture.md](docs/audit-architecture.md)), and 8
  system roles (Administrador, Gerente, Ventas, Depósito, Compras,
  Tesorería, Contabilidad, Solo lectura) per company — see
  [docs/authorization.md](docs/authorization.md). The admin user holds
  **Administrador** in both demo companies; only Administrador is granted
  audit access by default.
- 3 illustrative customers in Demo Company (Consumidor Final, Cliente Demo
  S.A., Comercial del Sur S.R.L.) with different types/tax conditions/
  addresses/contacts/categories — see [docs/customers.md](docs/customers.md).
- 8 standard units of measure per company, and 4 illustrative products in
  Demo Company (a barcoded simple product, a plain simple product, a
  2-variant product, and a service) — see [docs/products.md](docs/products.md).
- 2 warehouses (Depósito Central, Depósito Sucursal 2) with initial stock
  via real `StockMovement` rows in Demo Company — see
  [docs/inventory.md](docs/inventory.md).
- 3 global currencies (ARS/USD/EUR) and 3 price lists in Demo Company
  (Minorista — fixed, predeterminada; Mayorista — derived, -10%;
  Distribuidor — derived, -15%), with initial prices via real
  `PriceListItem` rows — see [docs/pricing.md](docs/pricing.md).

The admin user's email/password come from `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`. Idempotent — safe to re-run, and re-running rotates the password if `SEED_ADMIN_PASSWORD` changed.

## Authentication

Implemented in `apps/api/src/auth`. Argon2id password hashing; short-lived
JWT access tokens (cookie, httpOnly) + rotating refresh sessions stored
server-side as `UserSession` (hashed token, not raw); password reset via
`PasswordResetToken` (hashed, single-use, expiring).

| Endpoint                     | Notes                                                                     |
| ---------------------------- | ------------------------------------------------------------------------- |
| `POST /auth/login`           | rate-limited; generic error on bad credentials/unknown email              |
| `POST /auth/refresh`         | rotates the refresh session                                               |
| `POST /auth/logout`          | revokes the current session                                               |
| `POST /auth/logout-all`      | revokes all sessions for the user                                         |
| `GET /auth/me`               | requires a valid session; identity only — see Multi-company context below |
| `POST /auth/change-password` | requires current password                                                 |
| `POST /auth/forgot-password` | rate-limited; always returns success (anti-enumeration)                   |
| `POST /auth/reset-password`  | consumes the reset token, revokes all sessions                            |

Password reset delivery is abstracted (`PasswordResetDelivery`) — dev logs
the link to the console, no real email provider is wired up yet.

## Multi-company context

Full architecture: [docs/multi-company-architecture.md](docs/multi-company-architecture.md).
Summary: authentication answers "who," this answers "which company," and
authorization (below) answers "what they may do there" — kept as separate
mechanisms.

| Endpoint                                     | Guard              | Notes                                                          |
| -------------------------------------------- | ------------------ | -------------------------------------------------------------- |
| `GET /context/companies`                     | `@Authenticated()` | Companies the current user can access                          |
| `GET /context/companies/:companyId`          | `@Authenticated()` | 403 if inaccessible                                            |
| `GET /context/companies/:companyId/branches` | `@Authenticated()` | Active branches of an accessible company                       |
| `GET /context/current`                       | `@CompanyScoped()` | Verifies the header-based guard chain — not a business feature |

Company-scoped requests carry an `X-Company-Id` header (a validated UUID
of a company the authenticated user has active access to); an optional
`X-Branch-Id` further scopes to a branch of that same company. Both apps'
shared client (`packages/auth-client`) attaches these automatically once
a company/branch is selected — for manual API testing:

```bash
curl http://localhost:3001/api/v1/context/current \
  -H "X-Company-Id: <uuid from GET /context/companies>" \
  -b cookies.txt
```

### Testing Gestión / Facturación manually

1. `npm run dev` (or `dev:api` + `dev:gestion` + `dev:facturacion` in separate terminals).
2. Log in to either app with the seeded admin — it has access to **two**
   companies, so a company selector appears instead of auto-selecting.
3. In Facturación, after picking a company, a branch selector appears too
   (Demo Company has two branches; Second Demo Company has one — auto-selected).
4. Switch companies in one app and confirm the other app's selection is
   unaffected (they're namespaced separately in `localStorage`).

## Authorization (RBAC)

Full architecture: [docs/authorization.md](docs/authorization.md). Roles
are permission bundles scoped to one company; effective permissions are
the union of every active role a user holds in the active company.

| Endpoint                                             | Guard                         | Notes                                                       |
| ---------------------------------------------------- | ----------------------------- | ----------------------------------------------------------- |
| `GET /context/permissions`                           | `@CompanyScoped()` only       | Your own effective permission codes for the active company  |
| `GET /administration/roles`                          | `administration.roles.read`   |                                                             |
| `GET /administration/roles/:id`                      | `administration.roles.read`   |                                                             |
| `POST /administration/roles`                         | `administration.roles.create` |                                                             |
| `PATCH /administration/roles/:id`                    | `administration.roles.update` |                                                             |
| `DELETE /administration/roles/:id`                   | `administration.roles.delete` | Soft-disable, not a hard delete                             |
| `PUT /administration/roles/:id/permissions`          | `administration.roles.update` | Atomic replace                                              |
| `GET /administration/permissions`                    | `administration.roles.read`   | The full catalog                                            |
| `GET /administration/users`                          | `administration.users.read`   | Only users with active membership to the active company     |
| `GET /administration/users/:userId/roles`            | `administration.roles.assign` |                                                             |
| `POST /administration/users/:userId/roles`           | `administration.roles.assign` |                                                             |
| `DELETE /administration/users/:userId/roles/:roleId` | `administration.roles.assign` | Refuses to remove the company's last security administrator |

In Gestión, log in as the seeded admin and go to **Administración → Roles**
or **Administración → Usuarios** (both require Administrador's permissions,
which the seed already grants). Creating a role with only
`apps.facturacion.access` and assigning it to a second user is the fastest
way to see the Gestión/Facturación access split in practice.

## Audit trail

Full architecture: [docs/audit-architecture.md](docs/audit-architecture.md).
Business/administrative audit log — distinct from application logs — that
records who did what, when, in which company, and what changed. Critical
mutations (role create/update/deactivate, permission changes, role
assign/unassign) and account-security events (login, logout, password
change/reset, session revocation) write an `AuditLog` row; reads and
routine traffic are never audited.

| Endpoint                                                | Guard                         | Notes                                              |
| -------------------------------------------------------- | ------------------------------ | --------------------------------------------------- |
| `GET /administration/audit`                             | `administration.audit.read`   | Company-scoped, paginated, filterable, newest first |
| `GET /administration/audit/:id`                          | `administration.audit.read`   | 404 if the record belongs to a different company    |
| `GET /administration/audit/entity/:entityType/:entityId` | `administration.audit.read`   | Backs a future per-entity "Historial" tab           |

In Gestión, log in as the seeded admin and go to **Administración →
Auditoría**. No CRUD is exposed for `AuditLog` anywhere — it's read-only
by construction.

## Customers

Full architecture: [docs/customers.md](docs/customers.md). The first real
business/master-data module — company-scoped customer records with
CUIT/document validation, addresses, contacts, and categories. No
balances, sales documents, or AR yet (see CLAUDE.md — those derive from a
future ledger, never a stored column).

| Endpoint | Permission | Notes |
| --- | --- | --- |
| `GET /customers` | `customers.read` | Paginated, searchable, filterable |
| `GET /customers/lookup` | `customers.read` | Lightweight — future Facturación selector |
| `GET/PATCH /customers/:id` | `customers.read`/`update` | |
| `GET /customers/:id/history` | `customers.read` | Customer-scoped audit history |
| `POST /customers` | `customers.create` | Nested addresses/contacts/categories, atomic |
| `POST /customers/:id/(de)activate` | `customers.deactivate` | Soft status only, never deleted |
| `.../addresses`, `.../contacts` | `customers.update` | Dedicated sub-resource CRUD |
| `/customer-categories` | `customers.read`/`create`/`update` | |

In Gestión, go to **Clientes**. No customer administration UI exists in
Facturación by design — see docs/customers.md.

## Products

Full architecture: [docs/products.md](docs/products.md). The second
business/master-data module — a shared, company-scoped product catalog
(Product/ProductVariant/ProductCode/ProductCategory/Brand/UnitOfMeasure).
`Product` never owns authoritative stock or sale price — see Inventory
and Pricing below (and CLAUDE.md's invariants) for where those actually
live.

| Endpoint | Permission | Notes |
| --- | --- | --- |
| `GET /products` | `products.read` | Paginated, searchable, filterable |
| `GET /products/lookup` | `products.read` | Sellable-variant granularity — future Facturación/POS selector |
| `GET/PATCH /products/:id` | `products.read`/`update` | |
| `GET /products/:id/history` | `products.read` | Product-scoped audit history |
| `POST /products` | `products.create` | Nested variants/codes, atomic |
| `POST /products/:id/(de)activate` | `products.deactivate` | Soft status only, never deleted |
| `.../variants`, `.../codes` | `products.update` | Dedicated sub-resource CRUD |
| `/product-categories`, `/brands`, `/units` | `products.read`/`create`/`update` | |

In Gestión, go to **Productos**. No product administration UI exists in
Facturación by design — see docs/products.md.

## Inventory

Full architecture: [docs/inventory.md](docs/inventory.md). Ledger-based
stock — `StockMovement` is the only authoritative source of physical
inventory, `InventoryBalance` a rebuildable projection. Warehouses,
reservations (service-level only, no public API yet), and stock
adjustments (draft/confirm/cancel).

| Endpoint | Permission | Notes |
| --- | --- | --- |
| `GET /warehouses` | `inventory.warehouses.read` | |
| `POST/PATCH /warehouses` | `inventory.warehouses.create`/`update` | |
| `POST /warehouses/:id/(de)activate` | `inventory.warehouses.deactivate` | Rejected while stock/reservations remain |
| `GET /inventory/stock` | `inventory.stock.read` | Físico/Reservado/Disponible, paginated/filterable |
| `GET /inventory/lookup` | `inventory.stock.read` | Future Facturación/POS selector |
| `POST /inventory/initial-balance` | `inventory.initial-balance.create` | One-time per variant+warehouse |
| `GET /inventory/movements` | `inventory.movements.read` | Immutable ledger, read-only |
| `GET/POST /inventory/adjustments` | `inventory.adjustments.read`/`create` | Draft; only `/confirm` moves stock |
| `POST /inventory/adjustments/:id/confirm` | `inventory.adjustments.confirm` | Separate permission — the one action that moves stock |

In Gestión, go to **Stock** (Existencias/Movimientos/Ajustes/Depósitos).
Facturación has a warehouse-selection **foundation only** — a selector in
the top bar, no stock-aware sale flow yet — see docs/inventory.md.

## Pricing

Full architecture: [docs/pricing.md](docs/pricing.md). `Product` never
owns a sale price — prices belong to `PriceList`/`PriceListItem`,
resolved through `PricingService`. FIXED lists hold explicit prices;
DERIVED lists compute from another list + an adjustment, recursively, and
are never materialized. `PriceHistory` tracks commercial price evolution,
distinct from `AuditLog`.

| Endpoint | Permission | Notes |
| --- | --- | --- |
| `GET/POST /pricing/lists` | `pricing.lists.read`/`create` | |
| `PATCH /pricing/lists/:id` | `pricing.lists.update` | `pricingMode`/`currencyId` locked after creation |
| `POST /pricing/lists/:id/(de)activate` | `pricing.lists.deactivate` | |
| `PUT /pricing/lists/:id/products/:variantId` | `pricing.prices.update` | FIXED lists only |
| `PUT /pricing/lists/:id/prices` | `pricing.prices.update` | Batch set, transactional |
| `POST /pricing/lists/:id/bulk-adjust(/preview)` | `pricing.prices.bulk_update` | Preview writes nothing; confirm is transactional |
| `GET /pricing/lookup` | `pricing.prices.read` | Never returns 0 for a missing price |
| `GET /pricing/products/:productId/prices` | `pricing.prices.read` | Backs Product detail's "Precios" tab |

In Gestión, go to **Listas de precios**. Facturación has a price-list
selection **foundation only** — a selector in the top bar, no sale/cart
consumes it yet — see docs/pricing.md.

## Sales (demo core)

Full architecture: [docs/sales.md](docs/sales.md). An internal
`SalesDocument`/`SalesDocumentLine` — one document type (`SALE`), NOT a
fiscal/electronic invoice. DRAFT/CONFIRMED/CANCELLED; a line's price and
description are resolved once through `PricingService` and snapshotted,
never re-resolved after the fact. Confirming is atomic and idempotent —
one transaction updates status, deducts inventory-tracked lines through
`InventoryService`, and records an audit event, or none of it happens.

| Endpoint | Permission | Notes |
| --- | --- | --- |
| `GET/POST /sales` | `sales.documents.read`/`create` | Search by number or customer |
| `GET /sales/:id` | `sales.documents.read` | |
| `PATCH /sales/:id` | `sales.documents.update` | DRAFT only |
| `POST /sales/:id/confirm` | `sales.documents.confirm` | DRAFT only, transactional, idempotent |
| `POST /sales/:id/cancel` | `sales.documents.cancel` | DRAFT only, no inventory effect |

In Gestión, go to **Ventas**. No Facturación sales UI exists yet —
Facturación/POS will call this same `SalesService`, not a parallel
implementation — see docs/sales.md.

## Development

```bash
npm run dev             # builds packages/*, then runs api (:3001) + gestion (:3000) + facturacion (:3002)
npm run dev:api          # api only
npm run dev:gestion      # gestion only
npm run dev:facturacion  # facturacion only
```

## Tests

```bash
npm test            # apps/api unit tests (mocked dependencies, no I/O)
npm run test:e2e     # apps/api e2e tests (real Postgres + Redis required)
```

`test:e2e` needs `NODE_OPTIONS=--experimental-vm-modules` (already wired
into the script) — Prisma 7's WASM query compiler uses a dynamic `import()`
that plain Jest can't evaluate without it.

## Quality gates

```bash
npm run lint
npm run typecheck
npm run format        # write
npm run format:check  # check only, no writes
npm run build             # api + gestion + facturacion
npm run build:api
npm run build:gestion
npm run build:facturacion
```

## Project structure

```
apps/api/src/
  app.module.ts
  main.ts
  config/          AppConfigModule (validated env)
  database/        PrismaService + DatabaseModule
  redis/           RedisService + RedisModule
  health/          GET /api/v1/health
  auth/            Login/refresh/logout/me/password reset — see Authentication above
  company-context/ X-Company-Id/X-Branch-Id guard + /context/* — see Multi-company context above
  authorization/   PermissionGuard, @RequirePermissions(), AuthorizationService — see Authorization above
  administration/  /administration/roles + /administration/users + /administration/audit
  audit/           AuditService, AuditSanitizer — see Audit trail above
  customers/       /customers + /customer-categories — see Customers above
  products/        /products + /product-categories + /brands + /units — see Products above
  warehouses/      /warehouses master data — see Inventory above
  inventory/       /inventory/* (stock, movements, adjustments) — see Inventory above
  pricing/         /pricing/* (lists, prices, lookup) — see Pricing above
  sales/           /sales/* (demo core — SalesDocument) — see Sales above
  common/filters/   Global exception filter (error envelope)
  common/pipes/     ZodValidationPipe
  queue/           README only — BullMQ boundary, not wired up yet
  modules/         Stale — one README-only folder per originally-planned domain;
                   several now have a real implementation elsewhere in src/
                   (see docs/implementation-status.md's "known technical debt")
apps/api/prisma/
  schema.prisma
  seed.ts
  migrations/

apps/gestion/src/  and  apps/facturacion/src/
  app/login, forgot-password, reset-password/   auth pages (shared pattern, not shared components)
  app/(app)/       session-gated + company-gated + app-access-gated route group
  app/(app)/administracion/  Gestión-only: roles list/editor, user list + role assignment, audit list/detail
  app/(app)/clientes/        Gestión-only: customer list/create/detail/edit — see Customers above
  app/(app)/productos/       Gestión-only: product list/create/detail/edit + categorías/marcas/unidades — see Products above
  app/(app)/stock/           Gestión-only: existencias/movimientos/ajustes/depósitos — see Inventory above
  app/(app)/listas-de-precios/  Gestión-only: price list list/create/detail/bulk-update — see Pricing above
  app/(app)/ventas/         Gestión-only: sale list/nueva/detail/edit — see Sales above
  components/layout/  app shell (sidebar+header for Gestión, single top bar for Facturación), company/branch/warehouse/price-list selectors, access-denied states
  components/providers/ QueryProvider (TanStack Query)
  components/ui/    shadcn/ui primitives
  lib/auth-client.ts  thin wrapper around @erp/auth-client for this app

docs/     — see docs/README.md for the full index
prompts/  — durable task specifications, see prompts/README.md
.github/  — CI workflow, PR template, issue templates
```
