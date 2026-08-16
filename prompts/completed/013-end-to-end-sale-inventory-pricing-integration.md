# Task 013 — End-to-end Sale + Inventory + Pricing Integration

Status: COMPLETED — implementation and verification complete
Depends on: 010, 011, 012
Agent: Claude
Base branch: main
Branch: agent/claude-end-to-end-hardening
PR: (not yet opened — see final report for exact push/PR status)

## Objective

Hardening, not new surface area: confirm that a sale confirmed from
Gestión, Facturación (011), or POS mode (012) reliably resolves price
through `PricingService`, moves inventory through `InventoryService`
(with the same concurrency/negative-stock guarantees as manual stock
adjustments — see `docs/inventory.md`), and is visible back in Gestión.
Mostly integration tests and edge-case verification rather than new
features — the core paths from #10 already worked correctly.

## Acceptance criteria (as actually implemented)

- New `apps/api/test/sale-integration.e2e-spec.ts` (13 tests, separate
  file per repo convention for a focused integration spec — see
  `docs/development-workflow.md`) covering scenarios `sales.e2e-spec.ts`
  didn't already exercise: draft repricing on a price-list change;
  cross-company reference rejection at write time for customer/
  productVariant/warehouse/priceList, on both create and update (a
  genuine cross-company id reads as 404 not-found, never distinguishing
  "doesn't exist" from "not yours"); a genuine concurrent same-draft
  double confirm (`Promise.all`, exactly one 200 + one 409, stock
  deducted exactly once); two sales racing for the same limited stock
  (exactly one succeeds under the negative-stock policy, balance never
  goes negative); concurrent draft creation producing unique, gapless
  sequential `VTA-` numbers; and inventory ledger/projection consistency
  after a confirmed sale, including `rebuildInventoryBalances` reproducing
  the same `onHand`.
- Every one of the above passed against the **existing, unmodified**
  `SalesService`/`InventoryService`/`PricingService` — no backend defect
  was found. The already-existing `sales.e2e-spec.ts` (175 tests) already
  covered pricing snapshot stability, missing-price rejection, SERVICE
  no-movement, multi-line stock rollback atomicity, sequential duplicate
  confirm, tender atomicity/exactly-once, CASH decimal correctness, and
  all 5 permission codes — not duplicated here.
- One real frontend defect found and fixed:
  `apps/facturacion/src/components/ventas/sale-workspace.tsx`'s
  insufficient-stock (or any) confirm-failure path, when triggered from a
  blank `/ventas/nueva`, computed the correct Spanish error message via
  `saleErrorMessage()` and called `setError()`, but then immediately
  `router.replace('/ventas/:id')` to reconcile against the newly-created
  draft's real state — since `/ventas/nueva` and `/ventas/:id` are
  separate page components, that navigate fully unmounts the component
  instance that just called `setError()` before React ever paints it, so
  the operator saw no error at all. Fixed by stashing the message in
  `sessionStorage` immediately before the navigate and consuming it once
  in a mount effect on the destination instance — written to survive
  React 18 Strict Mode's dev-mode double-invoke (read + remove happen
  inside the deferred `setTimeout` callback, not before scheduling it, so
  a cancelled first pass can never silently consume the stash without the
  error ever being set). Reproduced and re-verified via a real browser
  flow (Comercial del Sur, Café 1 kg × 999 against ~30 on hand): before
  the fix, the confirm dialog closed and nothing was shown; after the
  fix, "Stock insuficiente para esta operación en el depósito
  seleccionado." renders correctly, and the DB was inspected directly to
  confirm the sale stayed `DRAFT` with zero `StockMovement` and zero
  `SalesTender` rows for it.
- Manual end-to-end verification, all four flows actually run in-browser
  (not merely inspected in code): a Facturación sale (customer search →
  product search → confirm → `VTA-000008`), a POS CASH sale (repeat-scan
  quantity increment → F10 → received 3000 against a 2400 total → exact
  `ARS 600,00` change → `VTA-000009`), a POS CARD sale (no cash fields
  rendered, confirmed tender response has `amountReceived: null` and
  `change: null`, no card data stored anywhere — `VTA-000010`), and the
  insufficient-stock failure above. All three confirmed sales were
  independently DB-inspected (`SalesDocument`/`SalesDocumentLine`/
  `SalesTender`/`StockMovement` rows, ids cross-referenced) and verified
  visible in Gestión with matching number/customer/total/status/tender
  and the correct `StockMovement` ledger entries (`/stock/movimientos`
  showed all three `Venta` rows with the right quantities).
- Documentation reconciled to match already-implemented reality:
  `docs/architecture.md` (added the missing Sales module row/section —
  it had never been added when Prompt #10 shipped — and fixed a stale
  "POS mode (not implemented yet)" diagram label plus an equally stale
  Facturación paragraph describing "no sale, invoice, cart, or POS flow
  exists yet"), `docs/customers.md` (fixed a stale "no Facturación screen
  calls [customer lookup] yet" line — `CustomerPicker` has consumed it
  since Prompt #11), `docs/inventory.md` and `docs/pricing.md` (both had
  a "Facturación / future POS" section still describing the Prompt #8/#9
  foundation-only state; updated to describe what Facturación/POS
  actually consume today, per sales.md/facturacion.md/pos.md — none of
  those three docs' own content needed correction, they were already
  accurate). `docs/implementation-status.md` and `docs/roadmap.md`
  updated with this task's actual results.
- Prompt tracking reconciled: `prompts/planned/011-facturacion-mvp.md`
  and `012-pos-mvp.md` were still sitting in `planned/` despite being
  long merged (`Status: IN PROGRESS`/no PR number) — moved to
  `prompts/completed/` with their actual PR numbers and merge commits
  filled in (`#3`/`449bd70`, `#4`/`b60dc63`). This file itself moves from
  `planned/` to `completed/` in the same change.
- No schema change, no new migration, no new backend endpoint, no new UI
  surface — pure hardening, exactly as scoped.

## Out of scope

New UI surface — this task is about correctness of the existing flow,
not new screens. Fiscal invoices, sales orders/quotes, credit/debit
notes, delivery notes, Accounts Receivable, Treasury, cash register,
split/partial payments, payment gateway integration, refunds/returns,
Purchases, Accounting, Reporting, promotions, offline mode — see
docs/sales.md's, docs/facturacion.md's, and docs/pos.md's own "Deferred"/
"Current limitations" sections for the complete lists, all still
unchanged by this task.
