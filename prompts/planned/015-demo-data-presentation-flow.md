# Task 015 — Demo Data + Presentation Flow

Status: PLANNED
Depends on: 014
Agent: UNASSIGNED
Base branch: main
Branch:
PR:

## Objective

A richer, presentation-ready seed dataset (more customers/products/price
history/sales than the current minimal demo seed) and a written script
of the exact click-path a presenter would follow to demonstrate the
vertical slice from `docs/roadmap.md`. Documentation + seed data only.

Before making changes:

- Read `AGENTS.md`.
- Read `docs/roadmap.md`'s demo flow.
- Inspect `apps/api/prisma/seed.ts`'s current idempotent pattern — new
  seed data must follow it, never break idempotency.

## Acceptance criteria

Not yet specified in detail.

## Out of scope

Any new backend/frontend capability — this task only adds data and a
presentation script for capability that already exists after 011–014.
