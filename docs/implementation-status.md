# Implementation Status

Last verified: 2026-09-14, against `main` at `6225928` — the code,
migrations, and test suite in this repository, not prior chat history or
documentation intent. Every "DONE" below was re-checked against the
source; the counts come from a full run of the suites on a real
PostgreSQL + Redis (61 API unit, 267 API e2e, 59 Facturación, 81 desktop,
38 server-agent — 506 total, all passing), a clean production build, and
a browser pass over the Gestión/Facturación/POS screens.

Between the previous verification (2026-08-16, after Prompt #13) and this
one, the following landed and had never been recorded here: Purchases,
Current accounts, Backups/restore, the Windows ERP Server installer, the
Gestión sales chart, Tango/Excel price import, user creation, and the
Brand → ProductLine rename.

**Partially reconciled 2026-09-14 against `main` at `83838a5`**, covering
the "ERP Server installer (Windows)" section only: PRs #34 (PostgreSQL in
the payload), #35 and #36 landed after the verification above and #34
changed what that section asserted, but did not update it. That section
now matches the merged workflow and `server-installer.md`. **The suites
were not re-run for this reconciliation** and the counts above are still
those of the `6225928` run — no other section was re-checked.

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
`authorization.e2e-spec.ts` (9 mandatory scenarios). The seeded catalogue
is 91 permissions — the length of `PERMISSION_CATALOG` in
`packages/shared`, which is the single source both `seed.ts` and
`provision.ts` iterate, cross-checked against the row count in a seeded
database.

**User creation: DONE.** `POST /administration/users` creates the
account, its membership in the *active* company and its initial roles in
one transaction, recording a single `CREATE` audit event that describes
the account including its roles — not a `CREATE` plus N `ASSIGN`, since
the roles chosen on the form are part of what was created rather than a
later change. Gestión exposes it as a dialog on `/administracion/usuarios`.
The administrator sets the initial password directly (minimum 12
characters, same policy as the rest of the system) and the account is
born `ACTIVE`: the product installs on a LAN and has no mail transport of
any kind — neither does password reset — so an invitation that cannot be
delivered would be worse than none.

**Company selection is no longer inherited.** Logging in always asks
which company to work in, except where there is no question to ask (a
user with exactly one company still goes straight in). Implemented by
clearing the remembered selection in `useLogin` rather than by adding a
screen: with nothing stored, `useActiveCompany()` auto-selects only for a
single company and otherwise reports `needsSelection`, which is the
condition that already rendered the selector. Logging out already did
this, but a logout is not the only way a session ends — an expired
refresh token, a cleared cookie, or a second person at the same
workstation all lead to a fresh login with the previous selection still
in `localStorage`, and which company gets invoiced is not something to
inherit from whoever used the browser last.

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
ProductVariant/ProductCode/ProductCategory/ProductLine/UnitOfMeasure.
Gestión: `/productos` list/create/detail/edit + categorías/líneas. `GET
/products/lookup` still has no caller — Facturación's product search uses
`GET /inventory/lookup` instead (see [facturacion.md](facturacion.md)),
since it already returns warehouse-scoped availability alongside product
identity in one call. Covered by `products.e2e-spec.ts`.

**Brand → ProductLine.** `Brand` was renamed to `ProductLine` in migration
`20260913120000_rename_brand_to_product_line`, written by hand as pure
`ALTER ... RENAME` statements on the table, column, constraints and
indexes — the diff Prisma generates for a renamed model is
`DROP TABLE` + `CREATE TABLE`, which would discard every row and null out
each product's `brandId`. The rename propagates through the bulk
price-update scope (`BRAND` → `LINE`), the stock and price-list-item
filters (`lineId`), audit (`entityType: 'ProductLine'`, `line_changed`),
the routes (`/brands` → `/product-lines`) and the Gestión screen
(`/productos/marcas` → `/productos/lineas`). **Units of measure were
removed from the UI, not from the engine**: the Unidades screen, the
Unidad field on the create/edit forms, the product-detail value, the
`/units` endpoints and their hooks are gone, and `baseUnitId` is no
longer accepted on `POST`/`PATCH /products`; `UnitOfMeasure` still exists
in the schema and still drives quantity precision in Inventory.

### Inventory
**Status: DONE**
`apps/api/src/inventory` + `src/warehouses`. `StockMovement` ledger,
`InventoryBalance` projection, `StockReservation` (service-level only —
no public API yet, see below), `StockAdjustment` (draft/confirm/cancel),
`StockTransfer` (draft/confirm/cancel-with-compensation).
Gestión: `/stock` (Existencias/Movimientos/Ajustes/Transferencias/
Depósitos + Carga inicial). Facturación: the warehouse selector now
drives a real stock-aware sale flow (`GET /inventory/lookup` for product
search + availability — see [facturacion.md](facturacion.md)) in addition
to Gestión's own sale flow. Covered by `inventory.e2e-spec.ts`
(concurrency, reconciliation/rebuild, negative-stock policy),
`stock-transfers.e2e-spec.ts` (both halves of a confirmation, insufficient
stock with full rollback, compensating cancellation, two concurrent
confirmations of the same transfer, company isolation, permissions) and
`sales.e2e-spec.ts` (the `SALE` movement type, added by Prompt #10).

Sub-item — **Warehouse transfers**: **DONE**. Moving stock between two
warehouses is one document (`TR-000001`) rather than two unrelated
adjustments. A confirmation writes a `TRANSFER_OUT`/`TRANSFER_IN` pair in
one transaction, OUT first so an insufficient source aborts before the
destination is credited; cancelling a confirmed transfer adds a
compensating pair with the warehouses swapped and never edits what was
already written. `confirm()` opens with a conditional status UPDATE, so a
double confirm is impossible rather than merely unlikely. See
[inventory.md](inventory.md).

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

**Tango import and Excel round-trip: DONE.** The "Precios por Excel"
dialog on a FIXED price list's Precios tab offers two flows over one
engine — *Importar de Tango*, which reads Tango's own "Lista de precios"
export as it comes out, and *Editar en Excel*, which downloads the rows
currently in view (or only the ticked ones), takes the edited file back,
and shows an analysis before applying. Verified in a browser on `main`:
the export downloads as `precios-<CODE>-<date>.xlsx`. Both flows end in
`PricingService.setPrices` and never write `PriceListItem` directly, so
the validity-range close, the `PriceHistory` row and the overlap
rejection in `applyPriceChange` apply identically to an import and to a
hand edit. Matching is internal id first, then barcode, then code against
`ProductVariant.sku`, with both sides normalised because Tango pads the
variant part of its code with spaces; a key resolving to more than one
variant is reported as AMBIGUOUS rather than silently resolved. This is
**price import only — it is not the Tango data migration** (see "Not
implemented" below).

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

Explicitly NOT implemented as part of this: fiscal purchase invoices/
ARCA, accounting entries, FX conversion, lots/batches, AI document
ingestion, imports — see purchases.md's "Deferred"/"Extension points"
sections for the full list. (Supplier current accounts / accounts payable
*were* listed here as not implemented; they landed afterwards — see
Current accounts below.)

### Current accounts, Collections and Supplier payments
**Status: DONE — see [current-accounts.md](current-accounts.md) for the
exact scope.** `apps/api/src/accounts`, migration
`20260827045116_add_current_accounts`. Two **immutable ledgers** — one per
customer, one per supplier: rows are never `UPDATE`d or `DELETE`d after
insert, and a correction is a new, reversing movement. On top of them,
two documents: `CustomerCollection` (Cobros) and `SupplierPayment`
(Pagos), each DRAFT/CONFIRMED/CANCELLED, with applications
(`imputaciones`) against the sales documents or goods receipts they
settle. Applying is optional — money can arrive before there is anything
to apply it to, and the remainder stays as unapplied credit. Balances are
**per currency and never collapsed into one number**: there is no
exchange rate anywhere in this system, so a customer owing ARS 100,000
while holding USD 200 in credit is two facts, and the UI shows one line
per currency. The statement's running balance is computed by the backend
and never recomputed in the browser. Concurrency and refusal rules are in
current-accounts.md. Covered by `current-accounts.e2e-spec.ts`.

Gestión (ten screens, added 2026-09-13): `/cuentas-corrientes/clientes`
and `/cuentas-corrientes/proveedores` (list with balance and last
movement; detail with the statement — debit/credit/running balance — plus
the documents pending collection or payment), and `/cobros` and `/pagos`
(list with status filter, create, and a detail that can confirm or
cancel). Backed by `accounts-hooks.ts` in `auth-client` and
`sumDecimalStrings` in `packages/shared` — the form's applied total is
summed with exact decimal-string arithmetic, never `+`, because it is
compared against the document amount and shown to the user as money.

**Historical backfill — runs on API startup.**
`backfillCurrentAccounts` posts movements for sales and receipts confirmed
*outside* the live service path (genuinely historical data, or seed
fixtures inserted directly). It is idempotent by construction rather than
by a flag — every insert is `createMany({ skipDuplicates: true })` against
the same unique constraint the live path uses — and it only ever inserts,
never updates or deletes.

`CurrentAccountsBackfillService` runs it on `onApplicationBootstrap`, so an
installation upgrading into this module posts its history the first time
the API comes up instead of reading as "nobody owes anything" until an
administrator finds the script. A cheap `EXISTS` probe runs first, so a
healthy boot costs one query; when there is work, it runs inside one
transaction holding a transaction-scoped advisory lock
(`pg_try_advisory_xact_lock`, so it cannot leak across pooled connections
the way a session-scoped lock does), re-probes inside that lock, reads
documents in batches, and writes one `AuditLog` row — no company, tenant or
actor invented — in the same transaction. A failure is logged and never
blocks startup. `ERP_CURRENT_ACCOUNTS_BACKFILL_ON_BOOT=false` turns it off;
`npm run db:backfill-current-accounts --workspace=apps/api` still runs it by
hand.

**The module refuses to answer until the ledger is loaded.**
`CurrentAccountsReadyGuard` sits on every Current Accounts controller and
returns **503 `CURRENT_ACCOUNTS_NOT_READY`** unless the state is
`complete` — `pending`, `running`, `failed` and `disabled` are all refused,
because a ledger missing its history answers *zero*, confidently, and that
is indistinguishable from "nobody owes anything". `disabled` is not
`complete`: turning the automatic load off hands the job to an operator, it
does not do the job. A `pending` state is re-checked per request
(`refreshIfPending`), so an instance that lost the advisory lock to a
sibling does not refuse forever over a ledger that is loaded.

Gestión's Estado del sistema panel shows the state — Al día / Ejecutando… /
Falló / Desactivado / Pendiente — read from `GET /health`, as a state word
with no counts, company names or amounts. Covered by
`current-accounts-backfill.service.spec.ts`,
`current-accounts-ready.guard.spec.ts`, `health.service.spec.ts`,
`system-status.test.ts` and `current-accounts-backfill.e2e-spec.ts`, which
drives the real boot path — fixtures inserted through a separate client
before any app exists, then `app.init()`, including two instances booting
at once and an injected transaction failure. See
[current-accounts.md](current-accounts.md) for why a startup check rather
than a migration or an installer step.

Explicitly NOT implemented as part of this: editing a draft from Gestión
(`PATCH` exists and is wired, but the UI only confirms or cancels), date
filters in the UI (the endpoints accept `dateFrom`/`dateTo`), any UI
tests for the ten screens, anything in Facturación/POS (a cashier cannot
take a payment against an account; the POS tender path posts
`TENDER_SETTLEMENT` and stops), credit-limit enforcement, and an aging
report.

### Treasury (cash boxes, bank accounts, movement ledger)
**Status: PARTIAL — the ledger and accounts exist; nothing posts to them
automatically yet.** See [treasury.md](treasury.md).

`apps/api/src/treasury/*` + `TreasuryAccount`, `TreasuryMovement` and
`TreasuryAccountBalance`. `TreasuryMovement` is the only authoritative
record of money entering or leaving an account; `TreasuryAccountBalance`
is a projection `TreasuryService.rebuildTreasuryBalances()` can always
reconstruct from it — the same contract `InventoryService` has with
`InventoryBalance`. Balance updates are a single atomic
upsert-increment and the sign policy is validated against the value
Postgres returned inside the same transaction, never against a prior
read.

A `CASH_BOX` can never go below zero; a `BANK_ACCOUNT` can when
`allowsNegativeBalance` says so, and that flag can never be set on a cash
box. Accounts are single-currency and a movement in another currency is
rejected, never converted — no exchange rate exists in this module.
`@@unique([companyId, sourceType, sourceId, movementType])` makes a
retried or concurrent post idempotent by construction: `post()` returns
`null` rather than double-counting.

What exists on the API: account CRUD, the opening balance (a real
`OPENING_BALANCE` movement, settable once and only while the ledger is
empty), the account statement with a running balance computed from the
ledger, and **transfers between two of the company's own accounts** —
`TreasuryTransfer`, DRAFT/CONFIRMED/CANCELLED, both movements written in
one transaction with the OUT first, cancellation by compensating pair,
and `lockAccountsInStableOrder` so two opposing simultaneous transfers
cannot deadlock. The status flip is a conditional `updateMany` that
always writes `updatedAt`, because an update with empty `data` takes no
row lock — the defect PR #39 had to fix on `StockTransfer`. Permissions are `treasury.accounts.*` and
`treasury.movements.*` — `treasury.receipts.*`/`treasury.payments.*` were
already taken by Cobros and Pagos in `src/accounts`. Reading an account
and reading its ledger are separate codes on purpose.

**Cobros and Pagos post here.** Confirming a Cobro puts the money into a
treasury account and confirming a Pago takes it out, inside the same
transaction as the current-accounts movement; cancelling appends the
reversal. `treasuryAccountId` is required on new documents and nullable
for the ones confirmed before Treasury existed — those keep posting to
the customer/supplier ledger and stay out of every treasury balance,
which is the documented rule (task 019, criterion 7), not an oversight.
A Pago cannot overdraw a cash box: the confirmation fails whole.

**What this deliberately does NOT do, and it matters:** a POS sale's
`SalesTender` reaches no account at all — see `AGENTS.md`'s invariant and
treasury.md's "Deliberately not wired". **A cash box balance is therefore
wrong for a business running POS**, not merely incomplete, which is why
the statement endpoint returns `excludesPosSales` for the UI to state
next to the number. Also absent: cheques, bank reconciliation, Mercado
Pago, exchange rates, arqueo de caja, and any Gestión UI.

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
customer persisted across consecutive POS sales in a session.

**Walk-in customer (2026-09-14).** POS now opens with the active
company's "Consumidor Final" pre-selected instead of an empty field, so a
counter sale does not begin with a search. Matched on `Customer.code ===
'000001'` **and** `taxCondition === 'CONSUMIDOR_FINAL'`, both required,
never on `displayName`, never an inactive row, and never when two rows
match — `code` is unique per company, so no id is hardcoded and a company
without that customer simply opens with the field empty. It reuses the
existing company-scoped `GET /customers/lookup` (no new endpoint, no
schema change) and the selection is derived rather than stored, so
clearing with F2 stays cleared and a manual choice is never overwritten.
POS-only: `/ventas/nueva` still starts empty. See
[pos.md](pos.md). Manually
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

**Superseded on 2026-09-13 by the sales chart.** The six-counter column
("Ventas confirmadas hoy", "Total operado hoy", "Borradores abiertos",
"Clientes activos", "Productos activos", "Bajo stock mínimo") was removed
and `StatCard` deleted with it; Ventas recientes now spans the full
width. In its place: three headline figures — facturado, ventas
confirmadas and ticket promedio — each with its variation against the
previous period and a sparkline, plus an area chart and a 7 días / 30
días / 12 meses control. All four read the same window, so the control
sits above the whole block rather than over the chart alone. New endpoint
`GET /dashboard/sales-series?period=`, in its own service rather than
`DashboardService`, because that one answers "how much is there now" with
one number per question while this answers "how did it move" and needs a
window, buckets and a comparison. The series covers the single currency
with the most confirmed sales in the window and names the others in
`otherCurrencyCodes` — there is no exchange rate to combine them with.
Verified in a browser on `main`: the three periods recompute the figures
and re-label the axis, and the variation is correctly hidden when the
previous period had no sales (a percentage against zero is not a fact).
`useDashboardSummary` is kept — the recent-sales list still comes from
it.

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
  **not** wired yet: product category/product-line master
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
- **Not yet implemented**: TLS/certificate provisioning, LAN
  auto-discovery, offline writes, branded installer/icon, printer/fiscal
  hardware integration — see the architecture doc's "Explicitly not part
  of this phase". (An ERP Server installer/service was listed here as
  missing; it landed afterwards — see below.)

### Backups and restore
**Status: DONE — see [backups.md](backups.md) for the full design.**
Scheduled `pg_dump` backups of the whole PostgreSQL instance, run by the
`apps/server-agent` maintenance agent, with retention, SHA-256 checksums
recorded in a manifest and re-checked at restore time, and verification
via `pg_restore --list` against the archive just written (a `pg_dump`
that exits 0 can still produce an archive `pg_restore` cannot read;
finding that out during a real restore is the failure this prevents).
Optional offsite copy. Read-only status is exposed to Gestión at
`GET /system/backups/status` (`/administracion/backups`), gated by
`system.backups.read`.

**Restore is CLI-only and deliberately not in the API.** `erp-backup
restore <archive>` defaults to restoring *beside* the running system into
`<database>_restore_<timestamp>`; overwriting in place requires an
explicit `--overwrite`, and the restore itself runs
`--single-transaction`. A dump covers every company in the instance, so
exposing take/download/restore over a company-scoped API would hand one
company's administrator another company's data — that is why the
permission grants status only. Covered by `system-backups.e2e-spec.ts`
(8 tests: authorization, unconfigured state, agent-published schedule,
archive counting, corrupt-manifest tolerance, no path/secret leakage, and
that no write operation is exposed) and by the server-agent suite (38
tests).

**Estado del sistema panel (2026-09-14).** `/administracion/backups` — now
titled **Servidor y backups**, same route and same `system.backups.read`
gate — opens with a read-only server-health panel above the backup state:
overall verdict, API reachable, PostgreSQL, Redis, when the last real
check completed, and an "Actualizar ahora" button. It is the **first
visible diagnostic surface in the product, not local diagnostics in any
complete sense**: it reports only what `GET /health` already returns, and
deliberately shows no uptime, version, disk, memory or latency, because
the endpoint does not measure them.

No new endpoint, no new permission, no backend change. It reads the
existing `useServerHealth` query — the same one behind the top bar's
connection dot — so there is no second health check and no second polling
interval; the refresh button refetches that same query and TanStack
de-duplicates it against anything already in flight. The one code change
underneath is client-side: `fetchHealth` now returns a frontend-internal
`HealthProbe` (`{ reachable, response }`) instead of a bare
`HealthResponse`, so an unreachable API reads as "no se pudo comprobar"
for PostgreSQL and Redis rather than the previous synthetic response that
marked both `error` and made a transport failure indistinguishable from
the server reporting both services down. The shared `HealthResponse`
contract is untouched. Covered by 24 tests in `apps/gestion` (11 pure
mapping tests, 8 panel tests, 5 screen tests) — the first automated tests
this app has had; the vitest setup mirrors Facturación's.

### ERP Server installer (Windows)
**Status: PARTIAL — the payload is built and proven, and the `.exe` now
compiles in CI with PostgreSQL inside it; installing it anywhere is
not.** See
[server-installer.md](server-installer.md) for the full matrix of what
was and was not exercised.

Verified by actually running it: the payload builds (**503 MB Node-only**,
25,451 files after pruning dev dependencies; **679 MB today**, with
PostgreSQL bundled — see "Sizes" in server-installer.md, which separates
the payload from the compiled `.exe` and from the compressed artifact);
the packaged API boots in production
mode against a real PostgreSQL 16 and serves, reporting `degraded` rather
than hanging when Redis is absent; provisioning produces a real empty
installation (1 company, 1 administrator, 8 system roles, 88 permissions
— the catalogue's size on the day of that run; it seeds whatever
`PERMISSION_CATALOG` holds, 91 today — 2 currencies, 0 customers/products/
sales) and is idempotent across runs;
the provisioned administrator can log in and holds every permission; the
packaged agent takes a verified backup and the packaged API reports it;
packaged Gestión serves the real UI and resolves the API from the page's
own host with no rebuild; and all five WinSW service definitions are
accepted by the real WinSW 2.12.0 binary, a check CI now runs on every
change. Four real bugs were found by running it rather than reading it
and are fixed — including one where every installation would have aborted
because a template's own comment contained the literal
`{{PLACEHOLDER}}` that the unreplaced-placeholder guard matched.

(The permission figure is not a constant maintained by hand:
`provision.ts` iterates `PERMISSION_CATALOG` from `packages/shared` and
prints its `.length`, so provisioning creates exactly the catalogue —
88 entries as of this verification, counted from the built catalogue and
matching a seeded database. Earlier notes recording 78 predate the
permissions added by Purchases and Current accounts;
`docs/server-installer.md` was reconciled to 88 alongside this.)

**The installer compiles in CI, and now compiles with PostgreSQL inside
it — verified.** PR #25 fixed the last thing blocking the compile (Inno
Setup resolves a relative `Source:` against the `.iss` file's own
directory, not the working directory, so the payload path had to be
passed absolute) and the workflow then produced **`ERPServerSetup-0.1.0.exe`,
89.3 MB** — the first time the installer existed as a file, and Node-only.

**PR #34 (`c8a9b86`) closed the PostgreSQL gap.** A `Stage PostgreSQL`
step resolves a bin directory before the build and passes it as
`-PostgresDir`. As #34 wrote it, that step preferred any PostgreSQL of
the right *major* already on the runner and only downloaded as a
fallback; **that is no longer how it works** — the step now always
downloads the exact build named by `POSTGRES_VERSION`, verifies it
against `POSTGRES_SHA256` (a release compile refuses to run with no pin
at all), and records version, digest and source URL in
`pgsql/POSTGRES-SOURCE.txt` inside the payload, because "whatever the
runner has this week" meant two builds of the same commit could ship
different binaries and nothing checked or recorded which. Staging runs on
**every** payload build, and the build then verifies `initdb`, `pg_ctl`,
`postgres`, `pg_dump`, `pg_restore` and `psql` are present, that `initdb
--version` reports the expected major, and — the part a version banner
never showed — that the engine can actually `initdb` a cluster, start,
serve a query and take a `pg_dump`. The payload's own copy of
PostgreSQL is pruned of what a headless cluster never uses (`doc`,
`include`, `symbols`, `pgAdmin 4`, `StackBuilder`) — the bundled
PostgreSQL directory goes from **822 MB to 120 MB**, leaving a **679 MB**
payload against the **503 MB** it measured when it carried no database at
all. Three different things, and the one number that is NOT in that list
is the size of the installer: see "Sizes" in
[server-installer.md](server-installer.md). `install.ps1` now refuses to start when `initdb.exe` is
missing rather than dying mid-install.

**The first `.exe` with a database inside it exists.** Run **#14** of
`ERP Server installer`, dispatched on `main` at `728f2ee` with
`compile_installer=true` (2026-09-14 08:22–08:30 UTC), succeeded and
uploaded the **`erp-server-installer`** artifact, **116 MB compressed**,
downloadable from the repository's Actions tab until 2026-12-13. Note the
compile step is still `workflow_dispatch` input `compile_installer`,
**default `false`** — it is opt-in and does not run on every payload
build. The 116 MB figure is a **compressed artifact**, the 89.3 MB figure
above is an **`.exe`**, and the 679 MB figure is a **payload directory**.
No two of them are comparable, and no difference between any of them
should be claimed — in particular the 116 MB artifact is not "smaller"
than the 89.3 MB `.exe` in any meaningful sense.

**Still not verified, and needing a clean Windows PC** — this is the gate
before any customer install. Compiling the `.exe` says nothing about
whether it installs:

- **Installation on a clean Windows machine.** The `.exe` has never been
  run anywhere.
- **The bundled PostgreSQL under a Windows service account.** That the
  engine *runs* is no longer assumed: a `Smoke-test the bundled
  PostgreSQL` step uses the payload's own binaries to `initdb` a cluster,
  start it, connect and query, take a `pg_dump` and stop it, on every
  payload build — so the pruning from 822 MB to 120 MB is proven not to
  have trimmed anything the engine needs. What that does **not** cover is
  the Windows-specific half: a service account rather than the runner's
  user, the Service Control Manager, and ACLs on the data directory. That
  still needs a real machine.
- **Code signing.** The artifact is unsigned, so Windows SmartScreen
  will flag it.
- **Service registration.** WinSW service definitions parse and the
  executables run — CI checks that on every change — but `install`/
  `start` against the real Service Control Manager, the start order and
  the failure/restart behaviour are untested. Note the PostgreSQL service
  runs `postgres.exe` directly rather than `pg_ctl runservice`, which
  would register itself with the SCM and collide with WinSW.
- **`initdb` under a Windows service account** (locale and directory
  permissions — the most likely place to find the next problem).
- **ACL hardening** against a real non-administrator user.
- **Upgrade over an existing installation, and the uninstall path.**

Redis is deliberately not bundled.

## Foundation-only (deliberately incomplete)

### Gestión (as a product)
**Status: DONE for what exists, growing.** Every implemented backoffice
module above has a real Gestión UI. As of this verification that includes
Ventas, Compras (proveedores/órdenes/recepciones), Cuentas corrientes
(clientes/proveedores/cobros/pagos), Stock, Listas de precios, Clientes,
Productos and Administración (usuarios/roles/auditoría/backups) — 35
routes, all of which were opened in a browser against seeded data with no
console, network or render errors. No treasury/accounting/reporting UI
exists, because those backend modules do not exist either.

(This paragraph previously claimed no sales or purchases UI existed. That
was true when it was written and had been false since Prompts #10 and the
Purchases milestone; it is the specific staleness that prompted this
revision.)

## Not implemented

### Fiscal invoicing, sales orders/quotes, credit/debit notes, delivery notes
**Status: NOT IMPLEMENTED.** The demo `SalesDocument`/`SALE` core exists
(see Sales above) and both Gestión and Facturación can build/confirm one,
but no `SalesOrder`/`SalesQuote`/fiscal `Invoice`/`CreditNote`/`DebitNote`/
`DeliveryNote` model, service, or route exists anywhere. See
[roadmap.md](roadmap.md) for what comes next (end-to-end hardening)
before any of these.

### Tax / Fiscal (ARCA)
**Status: NOT IMPLEMENTED.** `PriceList.includesTax` is stored metadata
only — no VAT/tax calculation engine exists. No ARCA/AFIP integration of
any kind.

### Accounting
**Status: NOT IMPLEMENTED.** No chart of accounts, journal entries, or
ledger posting.

### Reporting
**Status: NOT IMPLEMENTED.** No dedicated reporting/BI module. Gestión's
home dashboard (see "Demo Dashboard / UX polish" above and
[dashboard.md](dashboard.md)) now shows a sales trend over 7 days / 30
days / 12 months, but it remains one fixed operational summary, not a
reporting surface: no configurable widgets, no report builder, no
exports, no aging or stock valuation reports, and a single currency per
series. The only export anywhere in the product is the price-list
spreadsheet described under Pricing.

### Returns and credit/debit notes
**Status: NOT IMPLEMENTED.** `MovementType.SALE_RETURN` /
`PURCHASE_RETURN` and `CustomerAccountMovementType.CREDIT_NOTE` /
`DEBIT_NOTE` exist as reserved enum values so a later module can add the
behaviour without a schema migration. Only the purchase-receipt reversal
path (`CONFIRMED -> CANCELLED`, see Purchases) actually reverses
anything; there is no returns document, no credit note, no debit note,
and no way to reverse a confirmed sale.

### Migration from Tango
**Status: NOT IMPLEMENTED — and not to be confused with the price
importer.** The Tango *price-list* import described under Pricing is a
single-purpose importer for one spreadsheet. There is no migration of
customers, suppliers, products, stock balances, historical sales,
purchases or account balances out of Tango, and no mapping,
reconciliation or cut-over tooling. This is planned work, not existing
work.

### Physical printing
**Status: NOT VALIDATED.** `print-receipt.tsx` renders a non-fiscal
internal receipt (`Comprobante interno de venta`, footer "Documento
interno. No constituye comprobante fiscal.") hidden on screen and wired
into both the Facturación and POS confirmation screens, and it correctly
never implies fiscal validity — no CAE, no ARCA, no invoice number. What
has **not** been done is validation against real hardware: no thermal or
fiscal printer has been tested, there is no paper-width or driver
handling, and no fiscal-printer integration of any kind exists.

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
- ~~**The current-accounts backfill is not automated.**~~ Closed: the API
  runs it on startup, refuses the module until the ledger is loaded, and
  the "Estado del sistema" panel shows the state (see "Current accounts"
  above and current-accounts.md). What remains deliberately undone is any
  way to *operate* it from the UI — the panel reports, it does not trigger
  a run, retry a failure or turn the flag off; that is still the API log,
  the `AuditLog` row and the CLI.
- **`apps/api/src/modules/*` is still 15 README-only folders**
  (`accounting`, `accounts-payable`, `accounts-receivable`, `audit`,
  `auth`, `core`, `customers`, `integrations`, `inventory`,
  `organizations`, `pricing`, `products`, `reporting`, `sales`, `tax`)
  — verified: they contain nothing but `README.md`. `treasury` was
  deleted when the real `src/treasury` landed, the same way
  `purchases`/`suppliers` were. Several
  of those domains are now implemented for real at a *different* path
  (`apps/api/src/<module>`), and `accounts-payable`/`accounts-receivable`
  in particular are misleading now that `src/accounts` exists. They
  should be deleted for the domains that have a real implementation.
- **Reserved enum values with no code path.** `MovementType`
  (`TRANSFER_IN`, `TRANSFER_OUT`, `SALE_RETURN`, `DELIVERY`,
  `PRODUCTION_IN`, `PRODUCTION_OUT`) and `CustomerAccountMovementType`
  (`CREDIT_NOTE`, `DEBIT_NOTE`, `OPENING_BALANCE`, `ADJUSTMENT`,
  `WRITE_OFF`) are deliberate forward compatibility, documented as such
  in the schema. They are listed here so nobody reads an enum value as
  evidence that the feature exists.
- **The e2e suites share one database and one permission catalogue.**
  They isolate their own data by creating a tenant/company per run with a
  `Date.now()` suffix, which holds; the contention is resource-level, not
  logical. Two consequences were fixed on 2026-09-14 (see the PR for
  `chore/stabilize-bootstrap-and-e2e`): the suite had no `testTimeout`,
  so Jest's 5 s default applied to `beforeAll` hooks that boot the whole
  `AppModule`, and under 17-way parallelism a different suite lost that
  race on each run; and `system-backups.e2e-spec.ts` read
  `system.backups.read` with `findUniqueOrThrow`, silently depending on
  `db:seed` having run. Both are resolved, and the whole suite was then
  proven independent of the seed: 267/267 against a database that had
  been migrated and never seeded (0 rows in `permissions`).
  `system-backups` was the only suite carrying that dependency. CI still
  seeds before `test:e2e`, which is worth keeping — it verifies the seed
  script itself runs cleanly against a fresh database — but the e2e run
  no longer *needs* it.

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
dashboard/UX polish — see above). See [roadmap.md](roadmap.md) for the
full milestone breakdown.

Since that was written, Purchases, Current accounts, Backups, the Windows
installer payload, realtime, the Electron client and the Gestión sales
chart have all landed. The binding constraint is no longer feature
coverage — it is that **nothing has been installed on a clean Windows
VM**. The recommended order from here:

1. **Install the ERP Server on a clean Windows VM.** Everything under
   "ERP Server installer (Windows)" that is marked unverified is the gate
   before any customer install, and `initdb` under a service account is
   the most likely place to find the next problem.
2. ~~**Close the backfill-on-upgrade gap.**~~ Done — the API runs the
   backfill on startup (see "Current accounts" above).
3. **Plan the Tango data migration** — customers, suppliers, products,
   stock and balances. The price importer is not this.
4. **Then** the fiscal work (ARCA, IVA), which is what turns an internal
   management system into one that can invoice.

Accounting, treasury and reporting remain behind all four.
