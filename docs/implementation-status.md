# Implementation Status

Last verified: 2026-08-16, after Prompt #13 (end-to-end Sale/Inventory/
Pricing hardening) — against the code, migrations, and test suite in
this repository, not against prior chat history or documentation intent.

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

### Purchases (Suppliers, Purchase Orders, Goods Receipts)
**Status: DONE — see [purchases.md](purchases.md) for the exact scope.**
`apps/api/src/purchases`. `Supplier` (mirrors `Customer`'s shape/tax-id
handling, smaller surface); `PurchaseOrder`/`PurchaseOrderLine` — pure
commercial intent, DRAFT/CONFIRMED/CANCELLED, confirming never touches
stock; `PurchaseReceipt`/`PurchaseReceiptLine` — the only Purchases
document that moves inventory, via two new `InventoryService` methods
(`applyPurchaseReceiptLine`/`reversePurchaseReceiptLine`), supporting
partial receiving (received/pending quantity always derived from
confirmed receipt-line history, never a stored counter) and, uniquely in
this codebase, a `CONFIRMED -> CANCELLED` reversal path. Over-receipt is
prevented both as an advisory check and, authoritatively, via
`SELECT ... FOR UPDATE` row locking inside `confirm()` — proven safe
under genuine concurrent requests. ARS/USD (at least) supported as
document currencies; no FX conversion. Gestión: `/compras/proveedores`,
`/compras/ordenes`, `/compras/recepciones`. Covered by
`purchases.e2e-spec.ts` (company isolation, PO/receipt state machines,
partial receipts, over-receipt rejection under genuine concurrency,
permissions, audit, currency validation, realtime-after-commit).

Explicitly NOT implemented as part of this: supplier current-account/
accounts payable, fiscal purchase invoices/ARCA, accounting entries, FX
conversion, lots/batches, AI document ingestion, imports — see
purchases.md's "Deferred"/"Extension points" sections for the full list.

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

### End-to-end Sale / Inventory / Pricing hardening
**Status: DONE — hardening only, no new surface area.** Confirmed, via
new integration tests and manual verification, that Gestión, Facturación,
and POS remain three UIs over exactly one Sales domain, one pricing
engine, and one inventory ledger. No real defect was found in the backend
domain services under this scrutiny — every gap identified (draft
repricing, cross-company reference rejection at write time, concurrent
same-draft double confirm, two sales racing for the same stock,
concurrent sale numbering, ledger/projection consistency after a
confirmed sale) was **already correctly handled** by the existing
`SalesService`/`InventoryService`/`PricingService` and simply lacked
dedicated test coverage — see the new
`apps/api/test/sale-integration.e2e-spec.ts` (13 tests). One real
frontend defect was found and fixed: Facturación's `/ventas/nueva` →
confirm-fails-with-insufficient-stock path computed the correct Spanish
error message but then immediately discarded it — the reconciling
`router.replace('/ventas/:id')` (see facturacion.md) unmounts the
`/ventas/nueva` page before React ever paints local `error` state set
just before it. Fixed by stashing the message in `sessionStorage` right
before the navigate and consuming it once on the destination page's
mount (`apps/facturacion/src/components/ventas/sale-workspace.tsx`) —
verified to reproduce and to be fixed via a real browser flow, backend
`INSUFFICIENT_STOCK` response included, DB-inspected (sale stays DRAFT,
zero `StockMovement`, zero `SalesTender`). Manually verified end-to-end:
a Facturación sale, a POS CASH sale (exact change, tender persisted), a
POS CARD sale (no cash fields, `amountReceived`/`change` both `null`, no
card data stored), and the insufficient-stock failure above — all four
cross-checked directly against `SalesDocument`/`SalesDocumentLine`/
`SalesTender`/`StockMovement` rows in the database, and all three
confirmed sales verified visible in Gestión with matching number/
customer/total/status and the correct `StockMovement` reference.
Documentation reconciled: `docs/architecture.md` (added the missing
Sales module entry, fixed a stale "POS not implemented yet" diagram
label and an equally stale Facturación paragraph), `docs/customers.md`
and `docs/inventory.md`/`docs/pricing.md` (fixed stale "no Facturación/
POS behavior exists yet" language in their own "Facturación" sections —
all three had fallen behind Prompts #11/#12 landing). No schema change,
no new backend endpoint, no new UI surface. See
[sales.md](sales.md), [inventory.md](inventory.md),
[pricing.md](pricing.md), [facturacion.md](facturacion.md), and
[pos.md](pos.md) — none of their documented invariants changed, all were
re-verified.

### Demo Dashboard / UX polish
**Status: DONE.** Gestión's home route (`/`) is now a real permission-aware
operational dashboard — see [dashboard.md](dashboard.md) — backed by one
small read-only `GET /dashboard/summary` aggregate (company-scoped,
per-field permission-gated, zero duplicated business rules: reuses
`SalesService.list`/`InventoryService.listStock` wherever those already
existed, with a single genuinely new currency-grouped Prisma `groupBy` for
today's confirmed-sales total). Replaces the stale "Bienvenido / no hay
módulos instalados" placeholder. Loading skeletons, a fresh-company empty
state, and one retryable error state (single aggregate request, so no
per-widget partial-failure machinery was needed) — never flashes 0/$0
before data arrives. Wording is careful to describe internal sales, not
fiscal revenue ("Ventas confirmadas hoy" / "Total operado hoy", never
"Facturación fiscal" / "Ingresos contables"). Manually verified end-to-end:
a Facturación sale and a POS cash sale both appear in the dashboard's
summary/recent-sales within one query-cache refresh, and the confirmed
POS sale's stock decrement is visible in Gestión's Movimientos ledger —
see the hardening entry above for the same cross-app chain. Also fixed
during this pass: a real date-formatting inconsistency (`dateStyle:
'short'` producing "16/8/26" instead of "16 ago 2026") found in five
places — Facturación's recent-sales list and Gestión's audit log/stock
movements/customer/product/price-list history feeds — now all consistent
with the rest of the app. Stale foundation-era copy removed from
`AppShell`'s doc comment and `product-ui-principles.md`'s Gestión/
Facturación sections (both still described their shells as "structural
placeholders" long after real navigation/modes existed). No schema
change, no new business logic — see dashboard.md for why the one new
aggregate endpoint was justified.

### Realtime (LAN notification foundation)
**Status: DONE for the transport and the events listed below; most
company data is still not wired to a realtime event.** A company-scoped
Socket.IO layer (`apps/api/src/realtime/`) notifies other connected
sessions when business data changes, so a second open workstation can
refetch without a manual reload — see
[desktop-lan-architecture.md](desktop-lan-architecture.md)'s "Realtime
architecture" section for the full design, including the exact
"IMPLEMENTED NOW vs STILL FUTURE" split. Summary:

- Sockets authenticate with the same session cookie the REST API
  already trusts (no second credential); company-room subscription is
  independently re-validated server-side via `CompanyContextService`
  (no client-supplied `companyId` is ever trusted).
- Six events are wired, each emitted only after its mutation's
  transaction has committed: `sale.confirmed`/`sale.cancelled`
  (`SalesService`), `stock.changed` (`SalesService`,
  `StockAdjustmentsService`, `InventoryService.createInitialBalance`),
  `customer.updated` (`CustomersService`), `product.updated`
  (`ProductsService`), `price.changed` (`PricingService`). Deliberately
  **not** wired yet: product category/brand/unit-of-measure master
  data, and product variant deactivate/reactivate.
  **This does not mean "all ERP data is realtime"** — only the flows
  above push a live invalidation hint; every other read is still only
  as fresh as its next manual refetch/navigation, same as before this
  milestone.
- Events are pure invalidation hints (ids + companyId only, never
  authoritative data) — the client always refetches through the normal
  permission-checked REST endpoint. `apps/gestion` and
  `apps/facturacion` both consume one shared client
  (`packages/auth-client/src/realtime-client.ts`'s `useRealtimeSync()`),
  one socket per app session, with a small debounce/coalescing batcher
  and one broad current-company invalidation on reconnect.
- No durable event log/outbox and no Redis adapter — a single
  `apps/api` process only, and a client disconnected when an event
  fires simply recovers via the reconnect-triggered broad invalidation,
  not a replay. See the architecture doc for why this is a deliberate
  limitation, not an oversight.
- Backend: `apps/api/test/realtime.e2e-spec.ts` (real sockets/Postgres;
  unauthenticated rejection, authenticated connect, server-validated
  subscription, cross-company isolation, transaction-safety). Frontend:
  `apps/facturacion/src/lib/realtime-invalidation.test.ts` +
  `realtime-sync.test.tsx` (event→invalidation mapping, reconnect
  recovery, company-switch isolation). Manually verified with two
  browsers: a Facturación sale confirmation updated an already-open
  Gestión dashboard/stock/ventas view with no reload, a customer
  created in one Gestión session updated another session's Clientes
  list with no reload, and stopping/restarting the API produced an
  automatic reconnect and refetch with no reload.

### Desktop client (Electron thin shell)
**Status: DONE — a real, usable thin client; not yet an ERP Server
installer.** `apps/desktop`, one installed Electron application (never
two separate binaries) that never bundles Gestión, Facturación,
`apps/api`, or PostgreSQL — see
[desktop-lan-architecture.md](desktop-lan-architecture.md)'s "Desktop
client (Electron thin shell)" for the full design.

- A launcher window (local packaged content only, strict CSP, the app's
  only privileged preload surface) lets an operator configure the ERP
  Server's host, run a real connection diagnostic (API health +
  Gestión/Facturación reachability, with a best-effort CORS advisory),
  and open a workspace. A workspace window loads the server's own
  Gestión/Facturación URL with **no preload at all** — sandboxed,
  context-isolated, no Node integration — and only ever navigates within
  that server's own two workspace origins.
- `--workspace=gestion`/`--workspace=facturacion` launch straight into a
  workspace when a reachable server is already configured (the mechanism
  behind future "ERP Gestión"/"ERP Facturación" Windows shortcuts, which
  the launcher can also create on Windows); a single-instance lock means
  a second launch brings the existing app forward instead of spawning a
  duplicate.
- **Fixed the historical build-time host assumption** this milestone
  depended on: Gestión and Facturación now resolve the API's URL (and
  each other's URL) at runtime from the page's own host
  (`packages/shared/src/runtime-url.ts`), not a baked-in
  `NEXT_PUBLIC_API_URL`. Verified with zero rebuild between `localhost`,
  `127.0.0.1`, and (via server access logs showing the real Electron
  browser's own client-side fetches, correct CORS headers included) a
  reconfigured host.
- Tests: 67 desktop unit tests (`apps/desktop/test/`: server-input
  validation/normalization, URL derivation, navigation allow-list,
  startup-arg parsing, shortcut spec building, connection diagnostic
  logic) + 9 frontend runtime-host-resolution tests
  (`apps/facturacion/src/lib/runtime-url.test.ts`). Manually verified:
  real Electron process launch, single-instance lock, direct
  `--workspace=` startup against real dev servers, the 127.0.0.1
  acceptance scenario (proven via server access logs, not screenshots —
  this session had no screen-recording/accessibility permission for
  native macOS UI automation), and the unreachable-server safe-fallback
  path (launcher shown, never a blank remote window).
- **Not yet implemented**: an ERP Server installer/service, TLS/
  certificate provisioning, LAN auto-discovery, offline writes, branded
  installer/icon, printer/fiscal hardware integration — see the
  architecture doc's "Explicitly not part of this phase".

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
**Status: NOT IMPLEMENTED.** No dedicated reporting/BI module — Gestión's
home dashboard (see "Demo Dashboard / UX polish" above and
[dashboard.md](dashboard.md)) is a compact operational summary, not a
reporting surface: no historical trends, exports, or configurable
widgets.

## Known technical debt

- **`apps/api/src/modules/*` is stale.** One README-only placeholder
  folder per originally-planned domain (customers, products, sales,
  accounting, treasury, tax, ...) was created in the very first
  foundation commit and never removed. Several of these domains
  (customers, products, inventory, pricing, auth, audit, sales,
  purchases/suppliers) are now implemented for real under
  `apps/api/src/<module>` — a *different* path from the stale
  placeholder; the `purchases`/`suppliers` placeholder folders were
  deleted as part of this task since a real implementation now exists.
  `src/modules/*` should eventually be deleted for the remaining domains
  that now have a real implementation elsewhere, and kept (or removed and
  re-created when the domain is actually started) for the domains that
  are still genuinely unimplemented. Not cleaned up as part of Prompt #9.5
  (organizational task, no code
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
Facturación MVP, and POS MVP above — and has been hardened end to end
(Prompt #13, see "End-to-end Sale / Inventory / Pricing hardening"
above), with integration/concurrency test coverage proving all three
entry points share one Sales domain, one pricing engine, and one
inventory ledger. See [sales.md](sales.md), [facturacion.md](facturacion.md),
[pos.md](pos.md), and [dashboard.md](dashboard.md) (Prompt #14, demo
dashboard/UX polish — see above). The next milestone is demo data/
presentation flow (Prompt #15) before any advanced ERP module
(accounting, fiscal, treasury). See [roadmap.md](roadmap.md) for the full
milestone breakdown.
