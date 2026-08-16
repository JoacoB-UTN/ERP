# Task 013 — End-to-end Sale + Inventory + Pricing Integration

Status: PLANNED
Depends on: 010, 011, 012
Agent: UNASSIGNED
Base branch: main
Branch:
PR:

## Objective

Hardening, not new surface area: confirm that a sale confirmed from
either Facturación (011) or POS mode (012) reliably resolves price
through `PricingService`, moves inventory through `InventoryService`
(with the same concurrency/negative-stock guarantees as manual stock
adjustments — see `docs/inventory.md`), and is visible back in Gestión
(Stock movements, and wherever the sale itself is surfaced). Likely
mostly integration tests and edge-case fixes rather than new features.

Before making changes:

- Read `AGENTS.md`.
- Read `docs/implementation-status.md`.
- Read `docs/inventory.md` and `docs/pricing.md` again with this
  integration specifically in mind (concurrency, missing price, company
  isolation).
- Inspect 010/011/012's implementation once merged — treat repository
  state as source of truth, not this file.

## Acceptance criteria

Not yet specified in detail.

## Out of scope

New UI surface — this task is about correctness of the existing flow,
not new screens.
