# Implementation Status

Last verified: 2026-08-16 (against the code, migrations, and test suite in
this repository — not against prior chat history or documentation
intent).

This file is authoritative for "what exists right now." If it disagrees
with a domain doc, the domain doc is stale — fix it. If it disagrees with
the code, the code is right — fix this file.

## Completed

### Foundation
**Status: DONE**
NestJS + Prisma + PostgreSQL + Redis backend; two Next.js frontends
(Gestión, Facturación) sharing `packages/shared`/`packages/auth-client`;
npm workspaces monorepo; global exception filter, structured logging,
security headers, CORS. `GET /api/v1/health`.

### Authentication
**Status: DONE**
`apps/api/src/auth`. Argon2id passwords, JWT access + rotating refresh
sessions (`UserSession`), password reset (`PasswordResetToken`), rate
limiting, security-event logging. Login/logout/logout-all/me/change-
password/forgot-password/reset-password all implemented and tested
(`auth.e2e-spec.ts`, `auth.service.spec.ts`, `password.service.spec.ts`,
`session.service.spec.ts`).

### Multi-company context
**Status: DONE**
`apps/api/src/company-context`. `X-Company-Id`/`X-Branch-Id` headers,
validated against active `UserCompany` membership, `RequestContext`
propagated to every company-scoped handler. `GET /context/companies`,
`/context/companies/:id`, `/context/companies/:id/branches`,
`/context/current`. Tenant isolation covered in
`company-context.e2e-spec.ts`.

### Branch context
**Status: DONE**
Branch selection is part of the same `company-context` module above —
not a separate module. Frontend branch selector implemented in both
Gestión and Facturación, namespaced per app in `localStorage`.

### RBAC (Roles and Permissions)
**Status: DONE**
`apps/api/src/authorization` + `src/administration`.
Role/Permission/RolePermission/UserRole, `@RequirePermissions()` guard,
`GET /context/permissions`, role CRUD, permission-replace, user↔role
assignment. 8 system roles seeded per company (Administrador, Gerente,
Ventas, Depósito, Compras, Tesorería, Contabilidad, Solo lectura).
Frontend `usePermissions()`/`can()`/`canAny()`/`canAll()`. Covered by
`authorization.e2e-spec.ts` (9 mandatory scenarios).

### Audit / Traceability
**Status: DONE**
`apps/api/src/audit`. Company-scoped `AuditLog`, `AuditSanitizer`,
per-entity history endpoint, Gestión's Auditoría list/detail UI. Wired
into Roles, Auth, Customers, Products, Warehouses, Inventory
(StockAdjustment), and Pricing mutations. Covered by
`audit.e2e-spec.ts`.

### Customers
**Status: DONE**
`apps/api/src/customers`. Customer/CustomerAddress/CustomerContact/
CustomerCategory, CUIT/document validation, code sequencing, search,
history. Gestión: `/clientes` list/create/detail/edit. No Facturación
customer administration UI (by design — see
[product-ui-principles.md](product-ui-principles.md)); a lightweight
`GET /customers/lookup` exists for a future Facturación selector but is
not yet consumed by Facturación. Covered by `customers.e2e-spec.ts`.

### Products
**Status: DONE**
`apps/api/src/products` + `src/warehouses` (warehouse is master data,
covered under Inventory below for the stock side). Product/
ProductVariant/ProductCode/ProductCategory/Brand/UnitOfMeasure. Gestión:
`/productos` list/create/detail/edit + categorías/marcas/unidades. `GET
/products/lookup` exists for a future Facturación/POS selector but is
not yet consumed by Facturación. Covered by `products.e2e-spec.ts`.

### Inventory
**Status: DONE**
`apps/api/src/inventory` + `src/warehouses`. `StockMovement` ledger,
`InventoryBalance` projection, `StockReservation` (service-level only —
no public API yet, see below), `StockAdjustment` (draft/confirm/cancel).
Gestión: `/stock` (Existencias/Movimientos/Ajustes/Depósitos + Carga
inicial). Facturación: warehouse-selection **foundation only** (selector
in the top bar; no stock-aware sale flow exists to use it yet). Covered
by `inventory.e2e-spec.ts` (concurrency, reconciliation/rebuild,
negative-stock policy).

Sub-item — **Stock reservations**: **PARTIAL**. `InventoryService.reserve`/
`release`/`consume` are implemented and tested at the service level, but
there is no public API endpoint and nothing in either frontend creates a
reservation — there's no sales flow yet to reserve stock for.

### Pricing
**Status: DONE**
`apps/api/src/pricing`. `Currency` (global) + `PriceList` +
`PriceListItem` + `PriceHistory`; FIXED vs. DERIVED resolution
(recursive, cycle-safe), bulk adjustment (preview/confirm), Decimal-safe
arithmetic. Gestión: `/listas-de-precios` list/create/detail (fixed price
table + derived read-only view), bulk update UI, per-variant price
history, Product detail "Precios" tab. Facturación: price-list-selection
**foundation only** (selector in the top bar; no sale/cart consumes it
yet). Covered by `pricing.e2e-spec.ts`.

## Foundation-only (deliberately incomplete)

### Gestión (as a product)
**Status: DONE for what exists, growing.** Every implemented backoffice
module above has a real Gestión UI. No sales/purchases/treasury/
accounting/reporting UI exists yet because those backend modules don't
exist yet either.

### Facturación (as a product)
**Status: FOUNDATION ONLY.** Session/company/branch/warehouse/price-list
context is fully wired (selectors, isolation, re-validation). No sale,
invoice, cart, checkout, or payment flow of any kind exists. The
authenticated home page is a placeholder.

### POS
**Status: NOT IMPLEMENTED.** POS is designed to be an operating mode
inside Facturación (see AGENTS.md), not a separate app. No POS-specific
code, route, or UI exists anywhere in the repository yet — Facturación's
top bar shows a non-functional "POS" pill as a placeholder for the
future mode switch.

## Not implemented

### Sales
**Status: NOT IMPLEMENTED.** No `SalesOrder`/`SalesQuote`/`Invoice`/
`CreditNote`/`DebitNote`/`DeliveryNote` model, service, or route exists.
No cart or checkout flow. This is the top roadmap priority — see
[roadmap.md](roadmap.md).

### Purchases
**Status: NOT IMPLEMENTED.** No `Supplier`/`PurchaseOrder`/`GoodsReceipt`
model or module exists.

### Treasury
**Status: NOT IMPLEMENTED.** No payments, bank accounts, checks, or cash
management.

### Tax / Fiscal (ARCA)
**Status: NOT IMPLEMENTED.** `PriceList.includesTax` is stored metadata
only — no VAT/tax calculation engine exists. No ARCA/AFIP integration of
any kind.

### Accounting
**Status: NOT IMPLEMENTED.** No chart of accounts, journal entries, or
ledger posting.

### Reporting
**Status: NOT IMPLEMENTED.** No dedicated reporting module or dashboard
beyond the placeholder Gestión home page.

## Known technical debt

- **`apps/api/src/modules/*` is stale.** One README-only placeholder
  folder per originally-planned domain (customers, products, sales,
  purchases, accounting, treasury, tax, ...) was created in the very
  first foundation commit and never removed. Several of these domains
  (customers, products, inventory, pricing, auth, audit) are now
  implemented for real under `apps/api/src/<module>` — a *different*
  path from the stale placeholder. `src/modules/*` should eventually be
  deleted for the domains that now have a real implementation elsewhere,
  and kept (or removed and re-created when the domain is actually
  started) for the domains that are still genuinely unimplemented. Not
  cleaned up as part of Prompt #9.5 (organizational task, no code
  changes).
- **`Customer.lookup` and `Product.lookup` are unused.** Both exist as
  lightweight endpoints intended for a future Facturación selector, but
  Facturación doesn't call either yet — there's no sale flow to need
  them for.
- **`StockReservation` has no public API.** Service-level only (see
  Inventory above).
- **No GitHub remote existed and no commit history existed past the
  initial foundation skeleton** until Prompt #9.5 — everything above was
  previously verified only in-session, not in git. This is now fixed;
  see [multi-agent-workflow.md](multi-agent-workflow.md) for the
  branch/PR workflow going forward.

## Next recommended milestone

A demonstrable vertical slice (Gestión → create customer/product/stock/
price → Facturación → select customer, look up product, see price/stock,
build and confirm a simulated sale → inventory changes → visible back in
Gestión), before any advanced ERP module (accounting, fiscal, treasury).
See [roadmap.md](roadmap.md) for the full milestone breakdown — nothing
in that roadmap is implemented yet.
