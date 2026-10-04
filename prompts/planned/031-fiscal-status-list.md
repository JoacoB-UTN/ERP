# 031 — Fiscal authorization status in the list

Status: IMPLEMENTED / VERIFIED — human review pending.
Owner: coordinator owns API, shared contract and integration tests; UI worker
owns only fiscal.tsx/fiscal.test.tsx. No overlapping sensitive ownership.
Base: main c7a9815 (PR #68 merged).
Branch: agent/codex-fiscal-status.

## Acceptance

List each draft's latest attempt status and test number. No attempt is explicitly
null; missing data is not interpreted as unsent. Pending/unknown links open the
existing detail for consultation; never send or reconcile automatically.
Company-scope both draft query and related authorization selection. Only return
status, voucher type, point of sale and number, no persisted request or credentials.
Preserve existing pagination and permissions; avoid one request per row.

## Verification

API integration: no attempt, sending, unknown, rejected followed by authorized,
read-only list permission, forbidden access, foreign company isolation, exact
summary fields. UI cases cover statuses, pending links and query errors.
Run API/Gestión lint, typecheck, tests, relevant fiscal integration, production
builds and shared packages. No schema migration or ledger change.

No live ARCA acceptance possible before issuer/certificate setup. Preserve PR #17
and leave all merges to the user.

Results: API 288 unit tests, Gestión 186 tests and 25 fiscal integration tests
pass. API/Gestión lint, typecheck and production builds pass; one pre-existing
Gestión navigation warning. Shared packages build. Disposable DB migration
verification reports no drift; double seed preserves 12 business tables.
No manual browser acceptance claimed for this slice.
