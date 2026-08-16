# Task 010 — Demo Sales Core

Status: COMPLETED — merged to main
Depends on: 009 (Pricing)
Agent: Claude
Base branch: main
Branch: agent/claude-demo-sales-core
PR: #2, merged as commit 8754dac

## Objective

Minimal backend sales model — enough to represent "customer X bought
product Y at price Z, inventory moved" — without building the full
Sales module (quotes, credit/debit notes, multi-line fiscal documents).
This is the foundation the Facturación MVP (011) and POS MVP (012) build
on top of.

Before making changes:

- Read `AGENTS.md`.
- Read `docs/implementation-status.md` and `docs/roadmap.md`.
- Read `docs/customers.md`, `docs/products.md`, `docs/inventory.md`,
  `docs/pricing.md` — this task composes all four.
- Inspect the current implementation of each — treat repository state as
  source of truth, not this file.

## Acceptance criteria (as actually implemented — see docs/sales.md)

- `SalesDocument`/`SalesDocumentLine`/`SalesDocumentSequence` Prisma
  models, one document type (`SALE`), DRAFT/CONFIRMED/CANCELLED state
  machine.
- Every line's price/description resolved once through `PricingService`
  and snapshotted — never re-resolved after the fact, including after
  confirmation.
- `InventoryService.applySaleLine` — inventory-tracked lines generate a
  real `StockMovement` (`movementType: 'SALE'`) on confirm; SERVICE/
  non-tracked lines never do; DRAFT has zero inventory effect.
- `confirm()` is one atomic transaction (status change + inventory
  movements + audit) and idempotent under both sequential retry and a
  genuine concurrent race (conditional `UPDATE ... WHERE status =
  'DRAFT'` done first).
- `sales.documents.read/create/update/confirm/cancel` permissions, wired
  into the existing system roles.
- `GET/POST /sales`, `GET/PATCH /sales/:id`,
  `POST /sales/:id/confirm`, `POST /sales/:id/cancel`.
- Gestión: `/ventas` list/nueva/detail/editar, with live price +
  availability lookup while building a draft.
- `apps/api/test/sales.e2e-spec.ts` — 25 tests covering pricing snapshot,
  inventory effect, confirmation atomicity, idempotent confirm, status
  transitions, decimal precision, company isolation, and all 5
  permission codes. Full existing suite (159 e2e + 55 unit) still green.
- `docs/sales.md` written; `docs/implementation-status.md`,
  `docs/roadmap.md`, `AGENTS.md`, `CLAUDE.md`, `docs/README.md`, and root
  `README.md` updated.

## Out of scope

Full Sales module (quotes, delivery notes, credit/debit notes),
Accounts Receivable, any Facturación/POS UI (that's 011/012), tax/fiscal
calculation, confirmed-sale reversal/credit notes. See docs/sales.md's
"Deferred" section for the complete list.
