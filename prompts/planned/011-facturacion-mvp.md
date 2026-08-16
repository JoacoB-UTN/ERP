# Task 011 — Facturación MVP

Status: IN PROGRESS — implementation and manual verification complete, not yet merged
Depends on: 010 (Demo Sales Core)
Agent: Claude
Base branch: main
Branch: agent/claude-facturacion-mvp
PR: (not yet opened — see final report for exact push/PR status)

## Objective

The first real Facturación screen: select a customer, search/scan a
product, see its price (via `PricingService`) and availability (via
Inventory), build a sale, and confirm it against the backend built in
010. This is what turns Facturación's previous context-only foundation
(company/branch/warehouse/price-list selectors, no sale flow) into a
usable demo.

Before making changes:

- Read `AGENTS.md`.
- Read `docs/implementation-status.md` and `docs/roadmap.md`.
- Read `docs/product-ui-principles.md` (Facturación's UX direction —
  keyboard-first, minimal navigation) before writing any UI.
- Inspect the current Facturación foundation
  (`apps/facturacion/src/components/layout/*-selector.tsx`,
  `packages/auth-client/src/*-context-hooks.ts`) — treat repository state
  as source of truth, not this file.

## Acceptance criteria (as actually implemented — see docs/facturacion.md)

- `/ventas/nueva` (new sale), `/ventas/:id` (draft edit, or read-only
  detail for a confirmed/cancelled sale), `/ventas` (recent sales +
  drafts, status filter), plus a "Nueva venta"/"Ventas recientes" home
  page — all inside `apps/facturacion`.
- **Zero new backend endpoints, zero new Sales tables.** Every read/write
  goes through the exact same `SalesService`/`GET|POST /sales`,
  `GET|PATCH /sales/:id`, `POST /sales/:id/confirm` from Prompt #10, plus
  the already-existing `GET /customers/lookup`, `GET /inventory/lookup`,
  and `POST /pricing/lookup/batch`.
- Operational context (company/branch/warehouse/price list) reuses the
  existing top-bar selectors and `useActiveWarehouse`/`useActivePriceList`
  hooks directly — no second context implementation.
- Customer search via `CustomerPicker` (ACTIVE customers only, compact
  summary once selected). Product search/barcode-scan via
  `ProductSearch` (name/SKU/barcode, live price + availability, exact-match
  Enter-to-add, ambiguous-match disambiguation, "Producto no encontrado"
  for no match). Adding an already-in-cart variant increments its
  quantity instead of duplicating the line.
- Cart with editable quantity/discount, decimal-safe display, backend-
  authoritative pricing (client never submits `unitPrice`) and totals
  (client-side totals are an explicitly non-authoritative preview).
- Keyboard shortcuts: Ctrl/Cmd+K (focus product search), Enter (barcode
  add), Escape (clear search), Ctrl/Cmd+Enter (open confirm dialog).
- Guardar borrador / Confirmar venta (short confirmation dialog, always
  persists the cart first) / Nueva venta, with an optional non-fiscal
  "Imprimir comprobante interno" print layout.
- Permission-aware UI (`sales.documents.read/create/update/confirm`) —
  hides/disables actions the current user can't perform; the backend
  independently re-enforces every one.
- Company-switch isolation: in-progress customer/cart reset immediately
  on company change, and navigates off a now-inaccessible `/ventas/:id`
  back to `/ventas/nueva`.
- `apps/facturacion/src/components/ventas/{cart,ventas-errors}.test.ts`
  (Vitest, newly wired into `apps/facturacion` — first frontend test
  infra in the repository) — 10 tests covering decimal-safe cart totals
  (including a discount and a fractional/weighed quantity), the
  "unpriced line excluded from subtotal" rule, `toSaleLineInputs`'
  request-shape mapping, and Spanish business-error passthrough vs. the
  generic fallback for a non-`ApiError`.
- `docs/facturacion.md` written; `docs/sales.md`,
  `docs/implementation-status.md`, `docs/roadmap.md`, `docs/README.md`,
  and root `README.md` updated. No new `AGENTS.md` invariant was needed —
  the "one sales domain, Facturación/POS call it, never duplicate it"
  rule already existed from Prompt #10 and this task simply fulfills it.
- Manually verified in the browser (see final report for the exact
  actions taken): the full golden-path demo (context → customer →
  product search → real price/stock → quantity/discount → save draft →
  stock unchanged → confirm → stock decremented → visible in Gestión →
  Ventas with a matching `StockMovement`), an exact-barcode add, a mixed
  PRODUCT+SERVICE sale confirmed with a `StockMovement` for only the
  PRODUCT line (verified directly against the database), and a
  company-switch isolation check (Demo Company cart/customer cleared on
  switching to Second Demo Company, which correctly shows "Sin depósito
  disponible"/"Sin lista de precios" and no leaked data).

## Out of scope

POS mode (that's 012), any Sales module beyond what 010 provides,
payments, tax/fiscal calculation, printing/PDF generation beyond the
optional plain internal receipt layout — see docs/facturacion.md's
"Current limitations" for the complete deferred list.
