# Task 012 — POS MVP

Status: COMPLETED — merged to main
Depends on: 011 (Facturación MVP)
Agent: Claude
Base branch: main
Branch: agent/claude-pos-mvp
PR: #4, merged as commit b60dc63 (includes three post-review decimal-safety
and keyboard-stale-closure hardening rounds pushed to the same branch
before merge — see Prompt #13's record for the follow-up hardening pass)

## Objective

The first POS mode inside Facturación (not a separate app — see
`AGENTS.md`'s project-identity section): fast product entry, a cart,
payment-method selection, confirm. Reuses everything 011 built (customer/
product/price/inventory lookups) with a faster, more keyboard/scanner-
driven interaction shape.

Before making changes:

- Read `AGENTS.md`.
- Read `docs/implementation-status.md` and `docs/roadmap.md`.
- Read `docs/product-ui-principles.md`.
- Inspect 011's implementation once merged — treat repository state as
  source of truth, not this file.

## Acceptance criteria (as actually implemented — see docs/pos.md)

- `/pos` inside `apps/facturacion` (`components/pos/pos-workspace.tsx`),
  reachable from the top bar's "POS" link and the Facturación home
  page's secondary "POS" button. No `apps/pos` — POS lives inside
  Facturación's existing shell, reusing its top bar and permission gate.
- **Zero new backend endpoints** beyond one optional `tender` field on
  the existing `POST /sales/:id/confirm`; **one new table**,
  `SalesTender` (migration `20260816174827_add_sales_tender`), a 1:1
  operational payment snapshot (method, amountApplied, amountReceived,
  computed `change`) — explicitly not a Treasury/AR ledger, documented
  as such in `AGENTS.md`, `CLAUDE.md`, and pos.md.
- Product search, customer picker, pricing, and cart-totals math are the
  *same* components/hooks `/ventas/nueva` uses — imported directly, not
  reimplemented. POS-specific: `components/pos/pos-cart.tsx` (an
  "active line" concept for keyboard shortcuts) and
  `components/pos/payment-panel.tsx` (checkout dialog).
- Keyboard-first: auto-focus on load/after-add/after-reset, `F2`
  (customer), `+`/`-` (active-line quantity), `Delete` (remove active
  line), `F10` (open checkout), `1`-`4` (payment method), `Enter`
  (submit checkout).
- Cart never persists to the backend while scanning — only at checkout
  (F10), which creates-or-updates one DRAFT then confirms it with the
  chosen tender, both through the existing `SalesService`.
- Cash validation client-side (immediate "Importe insuficiente") and
  server-side (`SALE_TENDER_CASH_INSUFFICIENT`, before the transaction
  opens); omitted `amountReceived` for CASH defaults to exact payment.
- Tender created in the same `$transaction` as the DRAFT→CONFIRMED
  status change and inventory movements — never orphaned on a rolled-
  back confirm (dedicated e2e test).
- Customer persists across consecutive POS sales in a session (only
  reset on a company switch) — no hardcoded customer ID.
- Success screen: sale number, total, method, and (CASH) received/
  change; **Nueva venta** (clears cart, keeps context and customer,
  refocuses search), **Ver venta** (links to the shared `/ventas/:id`
  detail — no separate POS detail view), optional **Imprimir
  comprobante interno** reusing Facturación's existing non-fiscal
  receipt component.
- Permission-gated on `sales.documents.create` (page-level) and
  `sales.documents.confirm` (hides/disables "Cobrar" without it) — same
  codes as Facturación, no new permission introduced.
- Company-switch isolation: cart and customer cleared immediately.
- `apps/facturacion/src/components/pos/pos-tender.test.ts` (Vitest) — 7
  tests covering cash/change math and tender-payload building.
  `apps/api/test/sales.e2e-spec.ts`'s new "payment / tender" describe
  block — 9 tests (no-tender confirm, CASH with/without explicit
  amount, insufficient-cash rejection with no orphan tender, non-CASH
  methods never carrying amountReceived, amountReceived rejected for a
  non-CASH method, exactly-one-tender-per-sale, atomicity under an
  insufficient-stock rollback, company isolation).
- `docs/pos.md` written; `docs/facturacion.md`, `docs/sales.md`,
  `docs/implementation-status.md`, `docs/roadmap.md`, `docs/README.md`,
  root `README.md`, `AGENTS.md`, and `CLAUDE.md` updated. Gestión's sale
  detail page gained a small "Método de pago" line when a tender exists.
- Manually verified in the browser (see final report for the exact
  actions taken): barcode add + quantity-increment on repeat scan,
  keyboard shortcuts (`+`/`-`/`F2`/`F10`, verified via direct
  `KeyboardEvent` dispatch — the browser automation tool has a known
  timing quirk with programmatic key dispatch, documented in
  facturacion.md, unrelated to real keyboard/scanner input), a full CASH
  checkout with correct change and stock decrement, a full CARD checkout
  with no cash fields, client-side insufficient-cash rejection, "Nueva
  venta" preserving the customer while clearing the cart, company-switch
  isolation, and cross-app visibility in Gestión → Ventas (including the
  new "Método de pago" line) for both confirmed sales.

## Out of scope

Real payment processing/integration (a payment *method* is recorded, not
actually charged — no gateway, no card tokenization), fiscal receipt
printing, multi-terminal/offline mode, cash register opening/closing and
a cash drawer ledger, bank reconciliation, split/partial payments,
refunds/returns, suspended/parked carts, promotions, sales commissions,
accounting entries — see docs/pos.md's "Current limitations" for the
complete list.
