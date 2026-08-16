# Implementation Status

Last verified: 2026-08-16, after Prompt #12 (POS MVP) — against
the code, migrations, and test suite in this repository, not against
prior chat history or documentation intent.

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
[product-ui-principles.md](product-ui-principles.md)); `GET
/customers/lookup` is now consumed by Facturación's `CustomerPicker` (see
[facturacion.md](facturacion.md)). Covered by `customers.e2e-spec.ts`.

### Products
**Status: DONE**
`apps/api/src/products` + `src/warehouses` (warehouse is master data,
covered under Inventory below for the stock side). Product/
ProductVariant/ProductCode/ProductCategory/Brand/UnitOfMeasure. Gestión:
`/productos` list/create/detail/edit + categorías/marcas/unidades. `GET
/products/lookup` still has no caller — Facturación's product search uses
`GET /inventory/lookup` instead (see [facturacion.md](facturacion.md)),
since it already returns warehouse-scoped availability alongside product
identity in one call. Covered by `products.e2e-spec.ts`.

### Inventory
**Status: DONE**
`apps/api/src/inventory` + `src/warehouses`. `StockMovement` ledger,
`InventoryBalance` projection, `StockReservation` (service-level only —
no public API yet, see below), `StockAdjustment` (draft/confirm/cancel).
Gestión: `/stock` (Existencias/Movimientos/Ajustes/Depósitos + Carga
inicial). Facturación: the warehouse selector now drives a real
stock-aware sale flow (`GET /inventory/lookup` for product search +
availability — see [facturacion.md](facturacion.md)) in addition to
Gestión's own sale flow. Covered by `inventory.e2e-spec.ts` (concurrency,
reconciliation/rebuild, negative-stock policy) and `sales.e2e-spec.ts`
(the `SALE` movement type, added by Prompt #10).

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
history, Product detail "Precios" tab. Facturación: the price-list
selector now drives real cart pricing (`POST /pricing/lookup/batch`,
batched across the search results and cart lines — see
[facturacion.md](facturacion.md)), including a reprice-and-notify on
price-list change. Covered by `pricing.e2e-spec.ts`.

### Sales (demo core)
**Status: DONE — demo core only, see [sales.md](sales.md) for the exact
scope.** `apps/api/src/sales`. `SalesDocument`/`SalesDocumentLine`
(document type `SALE` only — an internal transaction, NOT a fiscal
invoice), DRAFT/CONFIRMED/CANCELLED state machine, atomic + idempotent
confirmation, price snapshotting via `PricingService`, inventory
decrement via a new `InventoryService.applySaleLine` (SERVICE lines
never move stock). Gestión: `/ventas` list/nueva/detail/editar, with live
price + availability lookup while building a draft. Facturación
(Prompt #11) now has its own sales UI calling this exact same
`SalesService` — see Facturación below and
[facturacion.md](facturacion.md). Covered by `sales.e2e-spec.ts` (pricing
snapshot, inventory effect, confirmation atomicity, idempotent confirm,
status transitions, decimal precision, company isolation, all 5
permission codes).

Explicitly NOT implemented as part of this: customer account/
receivables, payment methods, fiscal invoices/ARCA/CAE, credit notes,
delivery notes, sales quotes/orders, tax calculation, POS UI, or
reversing a confirmed sale — see sales.md's "Deferred" section for the
full list.

### Facturación MVP
**Status: DONE — MVP scope only, see [facturacion.md](facturacion.md) for
the exact scope.** `apps/facturacion/src/app/(app)/ventas/*` +
`src/components/ventas`. A real operational sale workflow — customer
search, product search/barcode-scan with live price and availability,
cart with editable quantity/discount, save-draft and confirm — built
entirely on Prompt #10's `SalesService` with **zero new backend
endpoints, zero new Sales tables**. `/ventas/nueva` (new sale),
`/ventas/:id` (draft edit or confirmed/cancelled read-only detail),
`/ventas` (recent sales + drafts, status filter), plus a "Nueva
venta"/"Ventas recientes" home page. Manually verified: full golden-path
demo (search → price/stock → add → discount → save draft → confirm →
stock decremented → visible in Gestión → Ventas with matching
`StockMovement`), barcode exact-match add, a mixed PRODUCT+SERVICE sale
(SERVICE line priced and totaled but generates no `StockMovement`), and
company-switch isolation (cart/customer cleared, no cross-company data
visible). Not covered by a dedicated Facturación e2e spec — see "Explicitly
NOT implemented" below for why, and `apps/facturacion/src/components/ventas/*.test.ts`
(Vitest) for the new unit coverage this task added.

Explicitly NOT implemented as part of this: POS mode (see POS below —
now done as a separate follow-up), payment methods, customer balances/AR,
treasury, fiscal invoices/ARCA/CAE, credit/debit notes, delivery notes,
sales orders/quotes, returns, reversing a confirmed sale, tax/VAT
calculation, promotions/customer-specific pricing, sales commissions,
accounting entries, offline sync — see facturacion.md's "Current
limitations" for the full list.

### POS MVP
**Status: DONE — MVP scope only, see [pos.md](pos.md) for the exact
scope.** `apps/facturacion/src/app/(app)/pos` + `src/components/pos`. A
specialized, ultra-fast checkout mode inside Facturación (not a separate
app) reusing the exact same customer/product/pricing/inventory/Sales
infrastructure facturacion.md documents — **zero new backend endpoints**
beyond one optional `tender` field on the existing `POST
/sales/:id/confirm`, and one new table, `SalesTender` (see below). Auto-
focused product search, barcode add, quantity/discount via keyboard
(+/-/Delete on an "active line"), F2 customer switch, F10 checkout with
a payment panel (Efectivo/Tarjeta/Transferencia/Otro, live change
calculation and client+server insufficient-cash validation for cash),
customer persisted across consecutive POS sales in a session. Manually
verified: barcode add + quantity-increment on repeat scan, +/- and F2/F10
keyboard shortcuts (via direct KeyboardEvent dispatch — the browser
automation tool used for verification has a timing quirk with
programmatic Enter/+/- dispatch documented in facturacion.md's own
verification notes; underlying app behavior confirmed correct), a full
CASH checkout (received > total, correct change, stock decremented,
`SalesTender` persisted) and a full CARD checkout (no cash fields, no
`amountReceived`/`change`), client-side insufficient-cash rejection,
"Nueva venta" preserving the customer while clearing the cart, and
company-switch isolation (cart/customer cleared, "Sin depósito
disponible"/"Sin lista de precios" shown, no cross-company data). Cross-
app verified: both confirmed sales appeared in Gestión → Ventas with
matching number/customer/total/status, and Gestión's sale detail now
shows a compact "Método de pago" line when a tender exists. Covered by
`apps/api/test/sales.e2e-spec.ts`'s new "payment / tender" suite (9
tests: no-tender confirm, CASH with/without explicit amountReceived,
insufficient-cash rejection with no orphan tender, CARD/TRANSFER/OTHER
never carrying amountReceived, non-CASH amountReceived rejected,
exactly-one-tender-per-sale, tender atomicity under an insufficient-
stock rollback, and company isolation) and
`apps/facturacion/src/components/pos/pos-tender.test.ts` (Vitest, cash/
change math and tender-payload building).

Explicitly NOT implemented as part of this: cash register opening/
closing, a cash drawer ledger, bank reconciliation, split/partial
payments, any real payment gateway or card-terminal integration, card
tokenization, refunds/returns, credit/debit notes, reversing a confirmed
sale, suspended/parked carts, promotions/customer-specific pricing,
sales commissions, accounting entries, offline mode — see pos.md's
"Current limitations" for the full list. **`SalesTender` is explicitly
NOT a Treasury/AR ledger** — it's an operational payment snapshot only;
no cash/bank/customer-account balance is ever updated by it.

## Foundation-only (deliberately incomplete)

### Gestión (as a product)
**Status: DONE for what exists, growing.** Every implemented backoffice
module above has a real Gestión UI. No sales/purchases/treasury/
accounting/reporting UI exists yet because those backend modules don't
exist yet either.

## Not implemented

### Fiscal invoicing, sales orders/quotes, credit/debit notes, delivery notes
**Status: NOT IMPLEMENTED.** The demo `SalesDocument`/`SALE` core exists
(see Sales above) and both Gestión and Facturación can build/confirm one,
but no `SalesOrder`/`SalesQuote`/fiscal `Invoice`/`CreditNote`/`DebitNote`/
`DeliveryNote` model, service, or route exists anywhere. See
[roadmap.md](roadmap.md) for what comes next (end-to-end hardening)
before any of these.

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
- **`Product.lookup` is still unused.** `Customer.lookup` is now consumed
  by Facturación's `CustomerPicker`; `Product.lookup` remains uncalled by
  either frontend — Facturación's product search uses `GET
  /inventory/lookup` instead (see facturacion.md).
- **`StockReservation` has no public API.** Service-level only (see
  Inventory above).
- **No GitHub remote existed and no commit history existed past the
  initial foundation skeleton** until Prompt #9.5 — everything above was
  previously verified only in-session, not in git. This is now fixed;
  see [multi-agent-workflow.md](multi-agent-workflow.md) for the
  branch/PR workflow going forward.

## Next recommended milestone

The demonstrable vertical slice (create customer/product/stock/price →
select customer/product → confirm a sale, with a payment method at
counter speed → inventory changes → visible back in Gestión) is now
implemented from Gestión, Facturación, **and** POS — see Sales,
Facturación MVP, and POS MVP above, [sales.md](sales.md),
[facturacion.md](facturacion.md), and [pos.md](pos.md). The next
milestone is end-to-end hardening (Prompt #13) before any advanced ERP
module (accounting, fiscal, treasury). See [roadmap.md](roadmap.md) for the full
milestone breakdown.
