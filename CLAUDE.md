# CLAUDE.md

Project rules and durable context for working in this repository. See
`README.md` for setup/architecture and `docs/` for design docs.

## Frontend products: Gestión and Facturación

This platform has **two separate frontend applications** — `apps/gestion`
(the ERP backoffice) and `apps/facturacion` (the fast operational sales
app). Full detail and rationale: [docs/product-ui-principles.md](docs/product-ui-principles.md).
Read that doc before any frontend UI task. In short:

- **Never duplicate business logic between the two apps.** They share one
  API, one auth system, one database, and one domain layer
  (`packages/shared`, `packages/auth-client`). Only UI/layout may differ.
- **POS belongs to Facturación** — it's an operating mode inside
  `apps/facturacion`, not a separate app or backend.
- **Do not visually clone Tango or any other existing ERP.** Functional
  workflow inspiration is fine; copying branding, colors, or exact screen
  layouts is not.
- Prefer simple workflows and progressive disclosure over dense,
  do-everything screens — this applies to Gestión especially.
- Facturación (and POS within it) must optimize for speed and keyboard
  usage: minimal navigation/clicks, keyboard shortcuts as first-class,
  immediate feedback.

## Company context and isolation

Authentication answers "who is the user." Company context (see
[docs/multi-company-architecture.md](docs/multi-company-architecture.md))
answers "which company are they operating right now." Authorization/RBAC
(see [docs/authorization.md](docs/authorization.md), next section) answers
"what are they allowed to do there." Keep these three concerns separate —
don't fold company selection or permissions into the auth mechanism
itself.

- **Never load a company-owned entity by its ID alone in an authenticated
  business operation.** Always scope the lookup by the validated
  `companyId` from the request's `RequestContext` (see
  `@CompanyScoped()` / `@CurrentCompany()` in `apps/api/src/company-context`).
  BAD: `prisma.someEntity.findUnique({ where: { id } })`. GOOD (conceptually):
  `prisma.someEntity.findFirst({ where: { id, companyId: ctx.companyId } })`
  — exact Prisma API depends on the model's unique constraints, but the
  principle is the same: ID alone is never sufficient authorization.
- A company/branch ID sent by the client (`X-Company-Id`, `X-Branch-Id`,
  a route param) is never trusted as authorization by itself — it must be
  validated against the authenticated user's active `UserCompany`
  membership on every request.
- Prefer a response that doesn't reveal whether a company/branch the
  caller can't access even exists (see `CompanyAccessDeniedException` /
  `BranchAccessInvalidException`) over one that distinguishes "not found"
  from "not yours."
- Frontend company-scoped queries must key their TanStack Query cache by
  the active company (e.g. `['company', companyId, 'customers']`, never
  bare `['customers']`), so switching companies can never show stale data
  from the previous one. See `docs/multi-company-architecture.md`.

## Authorization (RBAC)

Full model, diagrams, and request flow: [docs/authorization.md](docs/authorization.md).
Three permanent rules:

- **Every protected company-scoped operation must explicitly declare its
  required permissions** (`@RequirePermissions('module.resource.action')`
  in `apps/api/src/authorization`). Never rely on a controller's location,
  which module imports it, or frontend navigation to imply authorization
  — if an operation needs a permission check, it declares one, at the
  route.
- **Never use a role name to authorize a business action.**
  BAD: `if (role === 'ADMIN')` or `if (role === 'SALES')`. GOOD: require
  the specific permission the action actually needs, e.g.
  `@RequirePermissions('sales.invoices.create')`. Roles are just
  permission bundles administrators configure — even the seeded ADMIN
  role is "every permission in the catalog," not a special-cased string
  anywhere in the authorization code path.
- **Frontend permission checks (`usePermissions()`, `can()`/`canAny()`/`canAll()`
  from `@erp/auth-client`) are UX, not security.** They hide navigation
  and disable actions a user can't use, which supports the "don't show
  unnecessary complexity" product principle above — but they never
  replace backend authorization. Every real operation is independently
  gated server-side regardless of what the frontend shows.

## Audit trail

Full model, sanitization, and transaction semantics: [docs/audit-architecture.md](docs/audit-architecture.md).
Five permanent rules:

- **Critical business and administrative mutations must be auditable.**
  If you add a new operation that creates/changes/removes a company-owned
  or security-sensitive record, give it an `AuditService.record(...)` (or
  `recordFromContext(...)`) call — see `apps/api/src/audit` and the
  existing calls in `RolesService`/`AuthService` for the pattern. Don't
  make callers reconstruct actor/company/session metadata by hand.
- **Never place secrets, passwords, tokens, or credentials in AuditLog.**
  `AuditSanitizer` (`apps/api/src/audit/audit-sanitizer.ts`) redacts known
  sensitive keys recursively, but it is a safety net, not a license to
  pass raw request bodies into `before`/`after`/`metadata` — only include
  the specific fields that are actually meaningful to the action.
- **Audit records are immutable through normal application behavior.** No
  controller exposes update or delete for `AuditLog`, and none should —
  data retention/archival is a future, explicitly out-of-scope, controlled
  process, not a user-facing feature.
- **Audit describes meaningful domain/user actions, not raw SQL changes.**
  Never wire up an ORM/database-level "log every UPDATE" mechanism. One
  save that changes a role's permission set is one `PERMISSIONS_CHANGE`
  audit record with `permissionsAdded`/`permissionsRemoved`, not N rows
  for N inserted/deleted join-table rows.
- **A critical mutation and its audit record should normally commit
  atomically.** Wrap the business write and the `AuditService.record(...,
  tx)` call in the same `prisma.$transaction(async (tx) => {...})` — see
  `RolesService` for the pattern. (Pre-company-context auth events like
  LOGIN are the deliberate exception: see docs/audit-architecture.md for
  why those are best-effort instead.)

## Customers (master data)

Full model, validation, and API: [docs/customers.md](docs/customers.md).
Two permanent rules:

- **Customer balances are never stored directly on `Customer`.** No
  `balance`/`currentBalance`/`debt` column, now or later — a customer's
  balance must always derive from a future Accounts Receivable ledger
  (`CustomerAccountMovement` or equivalent), computed at read time, never
  cached as an authoritative field on the master record.
- **Customer ownership is always company-scoped**, same as every other
  business record — see "Company context and isolation" above.
  `Customer.code` and `Customer.taxId` are unique/checked per company,
  never globally; a lookup by `id` alone is never sufficient authorization.

## Products (catalog master data)

Full model, validation, and API: [docs/products.md](docs/products.md).
`Product` is a catalog/master entity — it answers "what is the item?", not
"how many do we have?", "how much do we sell it for?", or "what does it
cost?". Permanent rules:

- **Never store authoritative stock directly on `Product` or
  `ProductVariant`.** No `stock`/`availableStock`/`reservedStock`/
  `warehouseStock` column, now or later — stock will always derive from a
  future Inventory ledger of movements/reservations, computed at read
  time. `minimumStock`/`maximumStock`/`reorderPoint` are the one allowed
  exception: they're policy configuration, not balances.
- **Never store the ERP's authoritative sale price directly on
  `Product`.** No `price`/`salePrice`/`wholesalePrice` column — prices
  will derive from a future Price List module, since the same product can
  have several simultaneous prices (retail, wholesale, e-commerce, ...).
  The same reasoning applies to purchase cost (`averageCost`/`lastCost`):
  that belongs to future Inventory/Purchases, not Product.
- **Products are always company-scoped**, same as every other business
  record — see "Company context and isolation" above. `Product.code` is
  unique per company, never globally; a lookup by `id` alone is never
  sufficient authorization. This applies to `ProductCategory`, `Brand`,
  and `UnitOfMeasure` too.
- **Gestión administers the full product catalog; Facturación/POS only
  ever consume it through the shared read-only lookup path** (`GET
  /products/lookup`) — never a second product administration UI, and
  never duplicated catalog logic between the two apps (see "Frontend
  products" above).

## Inventory (ledger, stock, warehouses)

Full model, concurrency strategy, and future integration flows:
[docs/inventory.md](docs/inventory.md). Inventory is ledger-based, not
balance-based — permanent rules:

- **`StockMovement` is the only authoritative source of physical
  inventory.** ON_HAND for a variant+warehouse is always derivable by
  summing its movements. Never do `product.stock -= quantity` or any
  direct-write mutation of a stock number anywhere in the codebase.
- **`InventoryBalance` is a rebuildable projection, never a second source
  of truth.** It exists only so reads don't have to sum the ledger every
  time. It must be updated in the same transaction as the movement/
  reservation that changes it, and must always be reconstructable from
  scratch via `InventoryService.rebuildInventoryBalances()`. If a balance
  and the ledger ever disagree, the ledger wins.
- **Never store authoritative stock on `Product`/`ProductVariant`/
  `Warehouse`.** Same rule as the "Products" section above — stock is
  always computed from `StockMovement`/`StockReservation`, never cached
  as an authoritative field on a master record.
- **`StockReservation` reduces AVAILABLE, never ON_HAND.** Reserving stock
  for a future sale/transfer must not touch physical inventory —
  `AVAILABLE = ON_HAND - RESERVED` is the only place reservations show up.
- **Physical stock changes are transactional.** A `StockMovement` insert
  and its corresponding `InventoryBalance` update always happen inside one
  `prisma.$transaction`, same pattern as audit records — see "Audit
  trail" above.
- **Confirmed movements and confirmed adjustments are immutable.** No
  controller exposes PATCH/DELETE for `StockMovement`, ever — corrections
  are always a new reversing/corrective movement or adjustment, never an
  edit of history.
- **Inventory writes must be concurrency-safe.** Never read a balance,
  modify it in memory, and write it back — that race loses updates under
  concurrent requests. Use a single atomic upsert-increment (Prisma
  `update: { onHand: { increment: delta } }`) so Postgres serializes
  concurrent writes to the same row; validate negative-stock policy
  against the value the database actually returned, inside the same
  transaction.
- **The negative-stock policy is always `Product.allowNegativeStock &&
  Warehouse.allowNegativeStock`** (conservative AND) — checked before any
  operation that would take ON_HAND negative, never after.

## Pricing (price lists, resolution, price history)

Full model, resolution algorithm, and Decimal/rounding strategy:
[docs/pricing.md](docs/pricing.md). Permanent rules:

- **A `Product`/`ProductVariant` never owns an authoritative sale price.**
  Sale prices belong to `PriceList`/`PriceListItem`, resolved only through
  `PricingService` — same reasoning as the "Products" section above (a
  product can have several simultaneous prices), extended to its logical
  conclusion now that Pricing actually exists.
- **All price arithmetic is Decimal-safe.** `Prisma.Decimal`
  (`packages/shared`'s money/adjustment schemas), never a JS `number`/
  float, and never `Math.round(price * 100) / 100` — see "Company context
  and isolation" above for the same rule applied to quantities.
- **A missing price is never silently zero.** `PricingService.getPrice`
  returns `null`/`PRICE_NOT_FOUND` when no price resolves — a future
  Facturación/POS checkout must never charge $0 for an unpriced item.
- **Historical prices are never destructively overwritten.** Setting a
  new price always creates a new `PriceListItem` + `PriceHistory` row and
  closes the previous validity range through `PricingService`'s
  documented auto-close rule — never an in-place update of a past row's
  `price`.
- **A DERIVED `PriceList` never cycles**, and never materializes its
  resolved prices as `PriceListItem` rows — cycles are rejected at write
  time (`PRICE_LIST_CYCLE`), and a DERIVED list's price is always
  computed at read time from its base.
- **Operational price lookups always validate company ownership**, same
  as every other module — a `PriceList`/`PriceListItem` from Company A
  must never resolve, or even be selectable as a derivation base, for
  Company B.
- **Facturación/POS will consume `PricingService`, never a separate price
  catalog.** When a future Sales module needs a price, it calls
  `PricingService.getPrice`/`getPrices` — it never re-implements price
  resolution or reads `PriceListItem` directly.
