# Task 015 — Demo Data + Presentation Flow

Status: PARTIAL — documentation reconciled; runtime verification pending
Depends on: 014 (integrated)
Agent: Codex, Worker D (documentation reconciliation)
Base branch: main @ 6dac59ffc89174f4ce6a9af5df08577e682e2da2
Branch: agent/codex-demo-reconciliation-plan
PR: Original dataset/guide: #11 (e48fd0e); reconciliation: not opened

## Objective and existing implementation

Demonstrate the customer/product/price/stock/sale circuit through Gestión
and Facturación, including POS, using the existing seed and a reproducible
10–15 minute presentation. The original dataset and guide were implemented
in `e48fd0e`; do not rebuild a minimal seed or duplicate that work.

Static reconciliation on 2026-10-03 confirms 16 customers (including
Consumidor Final), 17 products / 21 variants, three price lists and
11 confirmed sales plus one draft in ANRAS. The administrator can select
ANRAS, CABACO and BLANCO BAHIA. Price history contains INITIAL entries;
multiple historical price changes are not part of the current fixture.

[Demo guide](../../docs/demo-guide.md) now describes the corrected routes,
stock balances, numbering, conditional daily totals and disposable-environment
preparation. [Plan 023](023-demo-reconciliation-plan.md) records the static
evidence and ownership. These corrections do not establish a successful
runtime rehearsal or verify the previous guide's browser claims again.

## Acceptance criteria

- [x] Reconcile names, counts, routes, prices, stock arithmetic and sale
  numbering with the code at the stated base.
- [x] Distinguish initial quantities from movement-derived current stock,
  and seed creation dates from the date of a later re-seed.
- [x] Provide a 13-minute walkthrough, up to 15 with the optional card sale;
  label expected results and require actual observations before presenting.
- [x] Replace routine resets with preparation of a new disposable database;
  explain that idempotence is not a universal no-op.
- [ ] In an authorized disposable environment, compare two seed runs for
  stable identities, counts, history, sale numbers/dates/totals and stock;
  record any mutations separately from duplication checks.
- [ ] Rehearse in the browser, verify shared sales between apps, each SALE
  movement and stock delta, company context, POS tender/change and internal
  receipt wording. Record actual timing, SHA and date/timezone.
- [ ] Record dashboard expectations against the same local day, separately
  for the required sales and optional card sale; resolve discrepancies
  before closing this task.

## Scope and verification

This residual changes documentation only: `docs/demo-guide.md`, this prompt
and `prompts/planned/023-demo-reconciliation-plan.md`. Static reference,
script, calculation, whitespace and diff checks are appropriate for these
edits. Application tests/build were not run for this documentation change;
commands for future runtime verification are in plan 023, not reported as
executed here.

No new backend/frontend capability, seed recreation, schema/migration,
pricing-history expansion or changes to shared packages, authorization or
other business modules. Accounts/Treasury/Cobros/Pagos are excluded from the
walkthrough and implementation scope. Roadmap and implementation-status
updates belong to the coordinator.

Do not mark DONE or move this prompt to completed until the outstanding
rehearsal evidence is recorded. Any runtime defect requiring code or seed
changes needs a separately assigned owner and scope.
