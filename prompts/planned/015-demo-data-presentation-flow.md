# Task 015 — Demo Data + Presentation Flow

Status: PARTIAL — double seed and core browser flow verified; full timed tour pending
Depends on: 014 (integrated)
Agent: Codex (acceptance documentation)
Base branch: main @ 1c2e7e8
Branch: agent/codex-treasury-acceptance
PR: Original dataset/guide: #11 (e48fd0e); reconciliation: #61 (merged); acceptance: not opened

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

[Demo guide](../../docs/demo-guide.md) describes corrected routes, stock,
numbering, the visible 30-day dashboard and disposable-environment preparation.
[Plan 023](023-demo-reconciliation-plan.md) records the earlier static work.
[Acceptance evidence](../../docs/acceptance-2026-10-03.md) records the real
2026-10-03 double-seed and browser rehearsal. The latter confirmed normal
sale VTA-000013 and cash POS sale VTA-000014, both ARS 22.000,00; Café in
Central decreased 159 → 158 → 157 while the other warehouses stayed unchanged.
The visible dashboard changed from 11 / ARS 657.400,00 to 13 / ARS 701.400,00
on its default 30-day period. Daily summary data is a separate API result,
not the cards currently presented by this screen.

## Acceptance criteria

- [x] Reconcile names, counts, routes, prices, stock arithmetic and sale
  numbering with the code at the stated base.
- [x] Distinguish initial quantities from movement-derived current stock,
  and seed creation dates from the date of a later re-seed.
- [x] Provide a 13-minute walkthrough, up to 15 with the optional card sale;
  label expected results and require actual observations before presenting.
- [x] Replace routine resets with preparation of a new disposable database;
  explain that idempotence is not a universal no-op.
- [x] Compare two seed runs in a disposable database: IDs and compared fields
  excluding `updatedAt` stayed equal for 4 companies, 16 customers,
  17 products, 21 variants, 3 lists, 21 price items, 21 history rows,
  12 sales, 22 lines, 10 tenders, 49 stock movements and 23 balances.
- [x] Exercise the normal sale and cash POS flow in the browser, including
  company context, shared sales, stock deltas and received amount/change.
- [x] Check fresh and final visible dashboard totals for the default 30-day
  period; correct the guide's obsolete daily-card instructions.
- [ ] Complete the timed tour and verify receipt-dialog/non-fiscal wording;
  physical printing is untested and needs separate verification if included.
- [x] Database comparison confirmed exactly one new SALE -1 movement per
  confirmed sale; final totals 14 sales and 51 stock movements.
- [ ] Rehearse the optional card sale if included in the final presentation;
  its projected 14 / ARS 703.900,00 aggregate is not observed evidence.

## Scope and verification

This documentation handoff changes only `docs/demo-guide.md` and this prompt.
The coordinator owns the linked acceptance report and other status documents.
Verified the current dashboard's `D30` default and series calculation by code
inspection; performed whitespace/diff checks. Database and browser observations
above were supplied by the coordinator's actual disposable rehearsal, not
inferred from static inspection. No application tests/build were run by this
documentation worker; consult the acceptance report for separately run checks.

No new backend/frontend capability, seed recreation, schema/migration,
pricing-history expansion or changes to shared packages, authorization or
other business modules. Accounts/Treasury/Cobros/Pagos are excluded from the
walkthrough and implementation scope. Roadmap and implementation-status
updates belong to the coordinator.

Do not mark DONE or move this prompt to completed until the outstanding
rehearsal evidence is recorded. Any runtime defect requiring code or seed
changes needs a separately assigned owner and scope.
