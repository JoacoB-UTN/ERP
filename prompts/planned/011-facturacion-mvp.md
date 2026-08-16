# Task 011 — Facturación MVP

Status: PLANNED
Depends on: 010 (Demo Sales Core)
Agent: UNASSIGNED
Base branch: main
Branch:
PR:

## Objective

The first real Facturación screen: select a customer, search/scan a
product, see its price (via `PricingService`) and availability (via
Inventory), build a sale, and confirm it against the backend built in
010. This is what turns Facturación's current context-only foundation
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

## Acceptance criteria

Not yet specified in detail. Before starting, expand this file with the
exact screens/flows and a manual verification script, following
`docs/roadmap.md`'s demo flow as the target shape.

## Out of scope

POS mode (that's 012), any Sales module beyond what 010 provides,
payments, tax/fiscal calculation, printing/PDF generation.
