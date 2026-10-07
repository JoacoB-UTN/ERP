# 038 — Read-only fiscal attempt history

Status: IMPLEMENTED — verified; awaiting CI and merge.
Base: merged PR #75, main 205aa92.
Dependency: PR #75 is merged; developed from its reviewed head before merge.
Branch: agent/codex-fiscal-attempt-history.

Owners: coordinator owns packages/shared, packages/auth-client, Gestión hook
exports/tests and docs. Protocol worker owns fiscal authorization controllers,
services and API integration tests. UI worker owns facturas-fiscales components
and their tests. Reviewer is read-only. Shared worktree, disjoint files; no agent
switches branches or commits another owner's files.

Forbidden: Prisma/schema/migrations, auth/company-context/authorization/audit
infrastructure, root configuration, lockfile, ledger and tax-rule changes.

Acceptance: invoice and NC read endpoints return paginated persisted attempts,
latestAuthorizationId and existing sanitized FiscalAuthorizationDto fields.
Validate parent and scope every query to tenant/company; read permission only.
Strict bounded page/pageSize; stable createdAt/id descending order and consistent
rows/count/latest snapshot. No secrets/request body in response; no ARCA or writes.
Reconciliation updates the same attempt; this is not a status-event timeline.

Gestión lazily expands history with date, revision, number, state and message,
labels latest versus previous attempts, pages and refreshes. No mutation or print
actions. Hide stale results on errors/unavailable context; separate caches by
company, document kind, ID and page. Preserve existing draft/reason state.

Verification: scoped/permission integration tests, empty/history/reconciliation,
pagination and strict-query validation; UI empty/error/loading/pagination and
company-context tests; lint, workspace types, relevant suites and builds.
Independent fiscal review and exact-HEAD green CI before authorized auto-merge.

Verified: 374 API unit, 40 authorization integration and 316 Gestión tests;
workspace lint/typechecks, all production builds, disposable migrations/drift
and repeat seed passed. Independent review found no blockers.
