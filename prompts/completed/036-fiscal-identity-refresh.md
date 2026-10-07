# 036 — Refresh fiscal identity before the first submission

Status: DONE. PR #74 merged with all CI checks passing.
Base: merged PR #73 (source 83d1fbb).
Branch: agent/codex-fiscal-identity-refresh.

## Problem and acceptance

A saved draft currently keeps issuer/recipient identity forever, while sending
requires current master CUIT/VAT to match. Correcting master data after saving
therefore strands an otherwise unsent draft. Add an explicit, audited action to
refresh only issuer/recipient identity from validated company/customer masters.
Preserve source sale ID/number/currency, all lines, quantities, prices, tax
breakdown and totals byte-for-byte. No automatic repricing, tax choice or ARCA call.

POST /fiscal/drafts/:id/refresh-identity accepts only expectedRevision and
confirmIdentityRefresh:true. Require fiscal read/create plus sales.documents.read.
Only a confirmed eligible source sale and a draft with NO authorization attempt
(including rejected) are eligible. Use the existing sale/draft locks shared with
save/authorize; recheck revision and attempts under lock. Audit and incremented
revision commit atomically. Invalid/incomplete CUIT or unknown VAT requires fixing
master data first. No change to sale, stock, accounts or Treasury. No migration.

The detail panel displays frozen identity and offers explicit refresh when the
latest-attempt query is current and empty. Confirm before applying and require
fresh authorization confirmations after the revision changes; link to review
class/IVA. Show errors/conflicts, never overwrite a stale or other-company form.

## Ownership

Coordinator alone: shared schema/client hooks, docs and integration.
API worker: fiscal.service.ts and fiscal.controller.ts.
Integration worker: fiscal.e2e-spec.ts, including cleanup/test fixtures only.
UI worker in isolated worktree: new identity-refresh component/test, detail
integration and auth-client exports. No auth/company-context/permission/audit
infrastructure, schema, root config, other modules or commercial ledger changes.

## Verification

Strict payload/permissions/scope, before/after identity correction, frozen monetary
snapshot, stale revision, any-attempt rejection, audit rollback, concurrent
refreshes and refresh versus authorization, no ledger changes. UI current query,
explicit confirmation, permissions, revision reset, company switch and late
response tests. Types, lint, relevant unit/integration tests, production builds;
independent fiscal review before user-authorized automatic merge.

Backend verification: API typecheck/lint pass; 28 fiscal preparation/identity
integration tests pass against disposable PostgreSQL/Redis. Fresh migration,
no-drift and double-seed checks pass. Independent backend/shared review found no
blockers. UI review found refetch/unmount races; both are fixed and covered by regression
tests, and independent rereview passed. Aggregate verification: 374 API unit
tests, 285 Gestión tests, all workspace typechecks, applicable lint and production
builds for API/Gestión/Facturación passed.
