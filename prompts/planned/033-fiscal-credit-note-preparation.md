# 033 — Prepare a total homologation credit note

Status: IMPLEMENTED / VERIFIED LOCALLY — CI pending.
Base: main fa76df8 (PR70 merged). Branch: agent/codex-credit-note-preparation.
Coordinator owns schema/migration/shared/API/client/docs. UI worker owns new panel
and wiring; integration worker owns fiscal-authorization.e2e-spec.ts. Independent
reviewer reads final diff. No overlapping sensitive ownership.

## Acceptance

One company-bound draft per original AUTHORIZED/HOMOLOGATION invoice1/6/11;
map toNC3/8/13. Copy exact authorized amounts/groupedIVA and invoice identity,
lines, date and association. Positive total and matching snapshot required.
Only reason editable, expectedrevision conflicts and audit atomic with persistence.
No ARCA call, ownCAE/number, commercial sale cancellation or ledger mutation.
UI read/write permissions, samecompany late-response guard, local edits retained,
errors/conflicts require reload. Unsupported/foreign original denied.

## Verification

API/Gestión tests, lint/types, builds, disposable migrations/schema-drift/double
seed, fiscal integration inclABC, concurrency, rollback, isolation and exact
before/after commercial ledgers. Independent review before automatic merge.

Next: credit-note authorization/reconciliation against original association;
commercial returns/refunds and partial notes require separate reviewed designs.
User authorized automatic merge after checks. Keep PR17 open and unmerged.

Results: API315, Gestión201 and fiscalintegration35 tests pass. Workspace lint
(two prior navigation warnings), typecheck and productionbuilds pass. Disposable
migrations deploy without schema drift; double seed preserves12 business tables.
Independent review completed without blocking findings.
