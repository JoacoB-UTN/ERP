# Facturación (fast operational sales UI)

This document covers the Facturación MVP: `/ventas/nueva`, `/ventas/:id`,
`/ventas`, and the Facturación home page. Read this before touching
`apps/facturacion/src/components/ventas` or `src/app/(app)/ventas`.

See also [sales.md](sales.md) (the one Sales domain this UI is a client
of — read this first), [product-ui-principles.md](product-ui-principles.md)
(why Facturación looks and behaves differently from Gestión),
[customers.md](customers.md), [products.md](products.md),
[inventory.md](inventory.md), [pricing.md](pricing.md), and
[authorization.md](authorization.md).

## What this is — and isn't

Facturación is a **fast operational interface over the same shared
domains** (Customers, Products, Pricing, Inventory, Sales) that Gestión
administers. It is not a second ERP and not a second Sales
implementation:

> **There is one Sales domain.** Every read and write Facturación makes
> goes through the exact same `SalesService`/`GET|POST /sales`,
> `GET|PATCH /sales/:id`, `POST /sales/:id/confirm` that Gestión's
> `/ventas` uses (see sales.md). This task added **zero** new Sales
> tables, **zero** new Sales endpoints, and **zero** new pricing or
> inventory-deduction logic. A sale confirmed from Facturación is, from
> the backend's point of view, indistinguishable from one confirmed from
> Gestión.

It is also explicitly **not** a fiscal invoice. The user-facing language
is "Venta" and the internal document number is `VTA-000123` — never
"Factura A/B/C", never a CAE, never anything implying ARCA/AFIP
submission. See sales.md's "What this module is — and isn't" for why.

POS mode (Prompt #12) is now real — a specialized, ultra-fast checkout
screen inside Facturación (same top bar, same Sales domain, same
customer/product/pricing/inventory infrastructure this document
describes), not a separate product. See [pos.md](pos.md) for everything
POS-specific: the payment/tender concept, its own keyboard shortcuts,
and its own manual verification. Facturación today is:

```
Facturación
├── normal sales workflow  (/ventas/nueva, /ventas/:id, /ventas — this document)
└── POS                    (/pos — see pos.md)
```

## Relationship with Gestión

Gestión is the backoffice: progressive disclosure, full administration,
history, dense detail screens. Facturación is the counter: one workspace,
minimal navigation, keyboard-first, built to add a line and confirm a
sale as fast as possible. Facturación deliberately does not copy Gestión's
screen density — see product-ui-principles.md.

Because both call the same `SalesService`, a sale created and confirmed
in Facturación **appears immediately in Gestión → Ventas** with the same
number, status, customer, totals, and `StockMovement` rows — no sync
process, no polling, no eventual consistency. They are two UIs over one
table.

## Operational context (company / branch / warehouse / price list)

Facturación does not implement its own context selection — the sale
workspace directly consumes the same top-bar selectors and hooks the
Facturación shell already had before this task:
`useActiveWarehouse()`/`useActivePriceList()` from `@erp/auth-client`
(see `apps/facturacion/src/components/layout/warehouse-selector.tsx` and
`price-list-selector.tsx`). There is no second warehouse/price-list
picker inside the sale workspace — changing the top-bar selector while a
sale is in progress *is* changing the sale's warehouse/price list.

- **Warehouse**: only active warehouses of the current company with
  `allowsSales = true` are selectable (same rule the backend itself
  enforces on confirm — `SALE_WAREHOUSE_INVALID` otherwise).
- **Price list**: only active price lists of the current company.
  Changing it while the cart has lines re-resolves every line's price
  against the new list (for free, since `usePriceMap` is keyed on
  `priceListId`) and shows a transient notice — "Se actualizaron los
  precios según {list name}." — never silently keeps stale prices.
- If no eligible warehouse or price list exists for the current company,
  the workspace shows a plain message instead of a broken cart: "Elegí
  un depósito y una lista de precios activos en la barra superior para
  empezar una venta."

## Customer selection

`CustomerPicker` (`components/ventas/customer-picker.tsx`) is
search-as-you-type over the existing `GET /customers/lookup` (`useCustomerLookup`
from `@erp/auth-client`) — the same lookup endpoint Prompt #6 built,
now finally consumed. Only `ACTIVE` customers are returned (server-side
filter, not a client-side one). A selected customer collapses to a
compact one-line summary — code, display name, formatted tax ID, tax
condition label — never the full Gestión customer form. No customer ID
is ever hardcoded; the search box is the only way in, and it autofocuses
when the workspace loads with no customer selected yet.

## Product lookup, price, and availability

`ProductSearch` (`components/ventas/product-search.tsx`) searches by
name, SKU, or barcode against `GET /inventory/lookup` — chosen over
`GET /products/lookup` specifically because it already returns
warehouse-scoped `available` stock alongside product identity, avoiding
a second round trip per keystroke. No new backend endpoint was added for
this: the task's own acceptance criteria only permitted one "if it
materially improves the experience", and two existing calls (inventory
lookup + a pricing batch call, below) were judged not materially worse
than introducing new backend surface.

Prices for every visible search result (and every cart line) are
resolved in one batched call, `POST /pricing/lookup/batch`
(`usePriceMap` in `components/ventas/use-price-map.ts`, shared between
the search dropdown and the cart) — never a request per row. A price
that doesn't resolve for the active list shows **"Sin precio en la lista
seleccionada"**, never a fabricated `$0`; a line is never added without a
resolved price.

Availability follows the same "never fabricate" rule: a `PRODUCT` line
shows `Disp: {available}` from the same inventory lookup response; a
`SERVICE` line (`productType === 'SERVICE'`) shows **"Servicio"** instead
— it participates in the sale's total like any other line but never
implies stock tracking, and confirming a sale with a SERVICE line
produces no `StockMovement` for that line (proven at the backend level by
`sales.e2e-spec.ts`'s existing SERVICE-line test, and re-verified for
Facturación's own confirm path — see "Manual verification" in the final
report for this task).

Adding a product that's already in the cart (same `productVariantId`)
increments that line's existing quantity by 1 instead of creating a
duplicate row.

## Barcode / scanner behavior

A barcode scanner is treated as fast typing followed by Enter — no
separate "scan mode." On Enter:

- The current search text is looked up **immediately** (not the
  debounced live-typing query) against `GET /inventory/lookup`.
- Exactly one match → added to the cart right away, search box clears.
- Zero matches → **"Producto no encontrado."**
- More than one match → the dropdown opens with the first result
  highlighted; Arrow Up/Down changes the highlight, a second Enter (or a
  click) adds the highlighted item — no re-query on the second Enter.

## Keyboard shortcuts

- **Ctrl/Cmd+K** — focus the product search box from anywhere in the
  workspace.
- **Enter** (in the product search box) — barcode/exact-match add, as
  above.
- **Escape** (in the product search box) — clear the search and close
  the dropdown.
- **Ctrl/Cmd+Enter** — open the confirm dialog, when a customer and at
  least one line are present, the user can confirm, and the dialog isn't
  already open.

No browser-native shortcut (Ctrl+W, Cmd+R, etc.) is intercepted.

## Sale lines and totals

The cart (`components/ventas/cart.tsx`) shows Producto / Cantidad /
Precio unitario / Descuento % / Subtotal per line, with quantity and a
0–100 discount percentage directly editable and a remove button — no
promotions, coupons, customer-specific pricing rules, or approval
workflow exist yet (deferred, same as sales.md).

Quantity is free-form (no client-side unit-of-measure precision lookup
exists for the search-result shape); the backend independently rejects
an invalid precision on save with a clear message
(`INVALID_QUANTITY_PRECISION`).

**The displayed price is never editable and never submitted as
authoritative** — the UI only ever sends `productVariantId`, `quantity`,
`discountPercentage` to the Sales API (see `toSaleLineInputs`); `unitPrice`
is always resolved server-side by `PricingService`, exactly as sales.md
documents. The price shown in the cart is a live preview of what the
backend already resolved for the active list — if it disagrees with what
comes back from a save, the save response is what's canonical.

Cart totals shown while editing (`computeCartTotals`) are a **client-side
JS-number preview only**, explicitly not authoritative — the same
"commercial fact snapshot, not a live pointer" boundary sales.md draws
for `unitPrice`. The confirmed/saved sale's totals always come from the
backend response. Subtotal/Descuentos/Impuestos/Total follow the same
convention as Gestión and the backend: `Subtotal` is already **net** of
line discounts (matching `sales.md`'s "Totals convention"), so Subtotal
and Total show the same figure whenever `Impuestos` is 0 (always, today —
no tax engine exists).

## Draft / confirm lifecycle

- **Guardar borrador** — `POST /sales` (new) or `PATCH /sales/:id`
  (existing draft), no inventory effect, shows the assigned sale number
  and moves the URL to `/ventas/:id` so refreshing reloads the same
  draft from the backend.
- **Confirmar venta** — opens a short confirmation dialog (Cliente /
  Total / "La operación descontará stock del depósito seleccionado." /
  Cancelar / Confirmar venta), then always persists the current cart
  first (so confirm never operates on stale state) and calls
  `POST /sales/:id/confirm`. On success: "Venta confirmada", the sale
  number, customer, and total, with **Nueva venta**, **Ver operación**,
  and an optional **Imprimir comprobante interno** (a plain
  `window.print()` layout headed "Comprobante interno de venta" and
  footed "Documento interno. No constituye comprobante fiscal." — see
  `components/ventas/print-receipt.tsx`).
- **Nueva venta** resets the customer and cart and returns to
  `/ventas/nueva`, preserving the current warehouse/price-list context
  (those live in the top bar, untouched by this reset).
- A confirmed or cancelled sale opened from `/ventas/:id` renders
  read-only (`components/ventas/sale-readonly.tsx`) — no edit controls,
  matching the backend's terminal-state rule from sales.md.
- **Insufficient-stock / concurrent-confirmation races**: the backend
  result is always canonical. If a confirm fails (e.g. another session
  consumed the needed stock first), the workspace surfaces the backend's
  Spanish error message and reconciles by refetching the sale (or, if the
  attempt started from a blank `/ventas/nueva`, by navigating to the
  sale's own `/ventas/:id` so the freshly created draft's real state is
  visible for a retry) — it never re-confirms or fabricates a second
  stock movement.

## Recent sales and drafts

`/ventas` (and a compact "Ventas recientes" section on the Facturación
home page) list sales through the existing `GET /sales` with its
`status`/pagination filters — Número, Fecha, Cliente, Total, Estado, with
a status filter (Todos / Borradores / Confirmadas / Canceladas) covering
"find and continue a draft" without a dedicated queue UI.

## Error handling

Every Sales business exception already carries a friendly Spanish message
from the backend (see sales.exceptions.ts and sales.md) —
`saleErrorMessage` (`components/ventas/ventas-errors.ts`) surfaces that
message as-is for a business `ApiError` and falls back to a generic
"Ocurrió un error inesperado." for anything else. A raw internal
exception is never shown.

## Permissions

Facturación reuses the exact permission codes sales.md defines — no new
codes, no role-name-based authorization:

```
sales.documents.read     — see /ventas, /ventas/:id, recent sales
sales.documents.create   — Nueva venta / Guardar borrador (new sale)
sales.documents.update   — Guardar borrador (existing draft)
sales.documents.confirm  — Confirmar venta
```

The frontend hides or disables what a user can't do (`usePermissions()`/
`can()`), but this is UX only — the backend independently re-checks every
one of these on every request, same as every other module. A user with
only `read` sees recent sales and no "Nueva venta" action; a user with
`create`/`update` but not `confirm` can build and save a draft but the
"Confirmar venta" button never renders.

## Multi-company isolation

Changing the active company resets the in-progress customer and cart
immediately — a draft-in-progress in Company A never silently survives
into Company B. If the workspace was open on an existing sale's own
`/ventas/:id` route when the company changed, it navigates back to
`/ventas/nueva` rather than leaving a stale, now-inaccessible sale ID in
the URL. This was verified manually by building a cart in Demo Company,
switching to Second Demo Company (which has no seeded warehouse/price
list), and confirming both the customer and cart lines were gone and no
Demo Company data was visible.

## Responsive behavior

Built for a desktop/notebook/counter-terminal/tablet-landscape target
first — the two-column context/customer + product-search layout is not
optimized primarily for phone-width screens, though it remains usable
narrower.

## Currency and formatting

All money uses the active price list's `currencyCode` via the shared
`formatMoney` helper — never a hardcoded `ARS`/`$`. A price list in a
different currency renders correctly without any Facturación-specific
change.

## Current limitations (intentionally out of scope)

Same "one Sales domain, demo core only" boundary sales.md draws. POS mode
is now implemented (see [pos.md](pos.md)) with a minimal operational
payment/tender concept — but cash register opening/closing, a cash
drawer ledger, bank reconciliation, split/partial payments, a real
payment gateway or card-terminal integration, accounts receivable /
customer balances / collections, treasury, fiscal invoices (ARCA/CAE/
fiscal QR/Factura A-B-C), credit/debit notes, delivery notes, sales
orders/quotes, sales returns, reversing a confirmed sale, tax/VAT
calculation, promotions or customer-specific pricing rules, sales
commissions, accounting entries, and offline sync all remain out of
scope — see pos.md's own "Current limitations" for the complete list.
