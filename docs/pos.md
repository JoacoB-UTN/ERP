# POS (fast checkout mode inside Facturación)

This document covers POS: `/pos` inside `apps/facturacion`, and the
payment/tender concept it introduces. Read [facturacion.md](facturacion.md)
first — POS is a mode of Facturación, not a separate product, and reuses
almost everything documented there (customer/product lookup, pricing,
inventory, keyboard-first UX, permissions, company isolation).

See also [sales.md](sales.md) (the one Sales domain POS is a client of),
[product-ui-principles.md](product-ui-principles.md), and `AGENTS.md`.

## What this is — and isn't

> **POS is a specialized, ultra-fast checkout screen inside Facturación —
> not a third product, not a second Sales domain.** Every read/write POS
> makes goes through the exact same `SalesService`/`GET|POST /sales`,
> `PATCH /sales/:id`, `POST /sales/:id/confirm` that Gestión's `/ventas`
> and Facturación's `/ventas/nueva` use. This task added exactly one new
> piece of backend surface — an optional `tender` on confirm, covered
> below — and zero new Sales tables, zero new pricing logic, zero new
> inventory-deduction logic.

The one genuinely new domain concept POS introduces is the **payment/
tender** — see "Payment / tender" below. Everything else (customer
search, product search/barcode, cart, pricing, inventory, confirmation,
company isolation) is the identical mechanism `/ventas/nueva` already
uses, just wrapped in a denser, keyboard-driven layout built for a
counter sale.

## Where POS lives

`apps/facturacion/src/app/(app)/pos/page.tsx` → `PosWorkspace`
(`components/pos/pos-workspace.tsx`). The Facturación top bar's "POS"
link (next to "Ventas") is the entry point; the Facturación home page
also has a secondary "POS" button next to "Nueva venta". There is no
`apps/pos` — POS was never a separate app, matching the architecture
`AGENTS.md` already describes.

POS reuses Facturación's existing shell (top bar + `<main>`) rather than
a dedicated full-screen route — the top bar's Ventas/POS links and the
Facturación wordmark are the "obvious way back" the spec calls for; no
browser Fullscreen API is used.

## Operational flow

```
Open POS (context already selected in the top bar)
  → product search auto-focused
  → scan/search product → added immediately, quantity/price/availability shown
  → (F2) select customer
  → adjust quantity with +/− on the selected line if needed
  → see the total, prominent, always visible
  → Cobrar (F10) → pick a payment method → (CASH) enter amount received
  → Confirmar y cobrar
  → success screen: sale number, total, method, received/change
  → Nueva venta → cart clears, context and customer persist, search refocused
```

## Reused, not duplicated

POS's product search, customer picker, pricing batch lookup, and cart
totals math are the *same* components/hooks `/ventas/nueva` uses
(`ProductSearch`, `CustomerPicker`, `usePriceMap`, `computeCartTotals`,
`toSaleLineInputs`, `saleErrorMessage`) — imported directly from
`components/ventas/*`, not reimplemented. The only new components are
POS-specific presentation: `components/pos/pos-cart.tsx` (a denser cart
table with an "active line" concept for keyboard shortcuts) and
`components/pos/payment-panel.tsx` (the checkout dialog). Both are pure
UI over the same underlying data/mutations as the rest of Facturación.

## Context, customer, product, pricing, inventory

Identical rules to facturacion.md: the top bar's warehouse/price-list
selectors are POS's context too (no second selector), only ACTIVE
customers, missing price never becomes `$0`, availability is always the
real `GET /inventory/lookup` figure, SERVICE lines show "Servicio"
instead of stock and never imply inventory tracking.

**Customer persistence is POS-specific**: unlike `/ventas/nueva` (which
clears its customer on "Nueva venta"), POS deliberately keeps the
selected customer across consecutive sales in the same session — the
same buyer commonly makes several purchases at a counter in a row — and
only clears it on a company switch (see "Company isolation" below). No
customer ID is ever hardcoded; the search is always the way in.

**Adding an already-in-cart variant increments its quantity** — scanning
the same barcode twice yields one line at quantity 2, not two lines —
identical to Facturación's own rule.

## Barcode / keyboard UX

Same barcode behavior as facturacion.md (imperative exact-match lookup
on Enter, ambiguous-match disambiguation, "Producto no encontrado").
POS-specific shortcuts, all implemented and manually verified:

| Shortcut | Effect |
| --- | --- |
| (auto) | Product search is focused the moment POS finishes loading, after every add, and after "Nueva venta" |
| `F2` | Focus/open the customer picker (clears the current customer first if one is selected, then focuses the search box) |
| `+` / `-` | Increase/decrease the quantity of the currently active cart line (never goes below 1; never fires while typing in a text field) |
| `Delete` | Remove the active cart line |
| `F10` | Open the checkout/payment panel (only when a customer and at least one line are present and the user can confirm) |
| `1`–`4` (in the payment panel) | Select Efectivo / Tarjeta / Transferencia / Otro |
| `Enter` (in the "Recibido" field) | Submit the checkout |
| `Escape` | Close the payment panel (Base UI's dialog primitive) |

Clicking a cart row also makes it the active line — keyboard shortcuts
aren't the only way to select one.

## Checkout and payment/tender

**Sale creation strategy**: the cart is kept entirely local while
scanning — no backend DRAFT is created per line. At checkout (F10 /
"Cobrar"), POS persists a DRAFT (create or update the one already
persisted by a prior failed attempt) and *then* confirms it with the
chosen tender, both through the existing `SalesService`. A failed
checkout (insufficient stock, a price/customer race, insufficient cash)
never loses the cart — the draft is already saved, the payment panel
stays open with the backend's error message, and the operator can adjust
and retry without a duplicate sale or a duplicate tender.

### SalesTender — an operational snapshot, not Treasury

A new `SalesTender` model (migration `20260816174827_add_sales_tender`,
one row, 1:1 with `SalesDocument` via a unique `salesDocumentId`) records
**how the customer said they paid**:

```
method          CASH | CARD | TRANSFER | OTHER
amountApplied   always equals the sale's own total — never a client-
                supplied amount, never partial (no split payments in this MVP)
amountReceived  CASH only; null for every other method
reference       optional, harmless free-text note; never a card number/CVV
```

`change` (`amountReceived - amountApplied`) is **computed at read time**,
never stored — it can never drift from its own inputs.

> **This is deliberately NOT `TreasuryMovement`/`CashMovement`/
> `BankMovement`/`CustomerAccountMovement`/`AccountingEntry`.** Confirming
> a POS sale never updates a cash balance, a bank balance, or a customer
> account — none of those ledgers exist yet (see "Deferred"). `SalesTender`
> only records what the operator told POS, for later display — it carries
> no financial authority beyond the sale it belongs to.

**Atomicity**: the tender is created inside the *same* `prisma.$transaction`
as the DRAFT→CONFIRMED status change and the inventory-tracked lines'
`StockMovement` rows (`SalesService.confirm`). A confirmed sale can never
end up without its tender; a rolled-back confirm (insufficient stock, a
concurrent race) never leaves an orphan tender — verified directly with
a dedicated e2e test (`sales.e2e-spec.ts`, "a tender is never orphaned").

**Cash validation**: `amountReceived >= amountApplied` is checked
client-side (immediate feedback, "Importe insuficiente", the confirm
button disabled) *and* server-side (`SALE_TENDER_CASH_INSUFFICIENT`,
before the transaction ever opens — no partial payment exists in this
MVP). Omitting `amountReceived` for CASH defaults it to the sale's total
(exact payment, `$0` change) — the operator isn't forced to type an
amount for the common case.

**API shape** — the existing confirm endpoint, extended with an optional
body:

```
POST /sales/:id/confirm
{ "tender": { "method": "CASH", "amountReceived": "20000" } }
```

`tender` is entirely optional — a plain Facturación/Gestión confirm
(no POS checkout involved) omits it and the confirmed sale simply has no
tender (`tender: null` in the response). No new endpoint was added; this
is the smallest extension that kept POS on the same confirm operation
every other confirm path already uses.

## Success screen and receipt

"Venta confirmada", the sale number, customer, total, and — when a
tender exists — the payment method plus (CASH only) received/change.
Actions: **Nueva venta** (primary), **Ver venta** (links to the same
`/ventas/:id` read-only detail Facturación's own sale-workspace uses —
no separate POS detail view), and an optional **Imprimir comprobante
interno** reusing the existing `PrintReceipt` component (`window.print()`,
non-fiscal, footed "Documento interno. No constituye comprobante
fiscal."). No POS-specific receipt layout was built — the same one
facturacion.md documents is reused as-is.

## Permissions

Same codes as facturacion.md, no new permission was introduced for
tender — `sales.documents.confirm` already authorizes it:

```
sales.documents.create   — required to open POS at all (page-level gate)
sales.documents.confirm  — required to see/use "Cobrar"; without it the
                           button is replaced with a muted note and
                           checkout is impossible from the UI
```

The backend independently re-checks both on every request — the frontend
gate is UX only, same rule as everywhere else in this codebase.

## Multi-company isolation

Verified manually: building a cart + selecting a customer in Demo
Company, then switching to Second Demo Company (which has no seeded
warehouse/price list) immediately cleared both the cart and the
customer, and the workspace correctly showed "Elegí un depósito y una
lista de precios activos..." with zero leaked Demo Company data.

## Gestión integration

A sale confirmed through POS is the same `SalesDocument` Gestión's
`/ventas` already lists and can open — verified end to end: number,
customer, total, and status all matched exactly, and the confirmed
sale's `StockMovement` was visible via Gestión's own "Ver movimientos de
stock" link. Gestión's sale detail page now also shows a compact
**Método de pago** line (method, and for CASH, received/change) when a
tender exists — a small, optional addition per this task's own
allowance, not a Treasury UI.

## Current limitations (intentionally out of scope)

POS mode is now real, but everything else facturacion.md and sales.md
already defer stays deferred, plus the POS-specific items this task
explicitly did not build: cash register opening/closing and a cash
drawer ledger, bank reconciliation, split/partial payments, a payment
gateway or card-terminal integration of any kind (no Mercado Pago,
PosNet, Fiserv, Stripe — CARD is purely a descriptive label), card
tokenization or storage of any real card data, refunds/returns, credit
or debit notes, reversing a confirmed sale, suspended/parked carts,
promotions or customer-specific pricing, salesperson commissions,
accounting entries, offline mode, and multi-terminal synchronization
beyond the normal shared backend. Accounts Receivable, customer current
accounts, Treasury, and fiscal invoicing (ARCA/CAE/Factura A-B-C) remain
entirely unimplemented — `SalesTender` is explicitly not a step toward
any of those, see "SalesTender — an operational snapshot" above.
