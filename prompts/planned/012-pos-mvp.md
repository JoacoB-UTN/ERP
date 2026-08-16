# Task 012 — POS MVP

Status: PLANNED
Depends on: 011 (Facturación MVP)
Agent: UNASSIGNED
Base branch: main
Branch:
PR:

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

## Acceptance criteria

Not yet specified in detail. Before starting, expand this file with the
exact POS-mode UI flow and a manual verification script.

## Out of scope

Real payment processing/integration (a payment *method* is recorded, not
actually charged), fiscal receipt printing, multi-terminal/offline mode.
