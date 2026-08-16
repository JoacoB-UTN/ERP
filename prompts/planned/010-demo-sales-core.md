# Task 010 — Demo Sales Core

Status: PLANNED
Depends on: 009 (Pricing)
Agent: UNASSIGNED
Base branch: main
Branch:
PR:

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

## Acceptance criteria

Not yet specified in detail — this file is a placeholder for the
suggested next milestone (see `docs/roadmap.md`), not a ready-to-execute
task. Before starting, expand this file with a concrete data model,
API surface, and test plan, following the pattern already established by
`docs/pricing.md`/`docs/inventory.md` (permanent invariants, Decimal
safety, company isolation, audit).

## Out of scope

Full Sales module (quotes, delivery notes, credit/debit notes),
Accounts Receivable, any UI (that's 011/012), tax/fiscal calculation.
