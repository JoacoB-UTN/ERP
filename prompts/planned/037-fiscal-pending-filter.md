# 037 — Find fiscal submissions that need consultation

Status: IMPLEMENTED — verified; awaiting green CI and merge.
PR: #75.
Base: merged PR #74 / main 2c52912.
Branch: agent/codex-fiscal-pending-consultations; isolated API/UI work integrated.

Coordinator owns shared query/client contract. API worker owns list service and
fiscal-authorization.e2e-spec.ts. UI follows after identity-refresh handoff.
No schema, auth/context/authorization/audit infrastructure, root configuration,
ledger mutations or external ARCA calls.

GET /fiscal/drafts supports filter=ALL (default), PENDING, INVOICE_PENDING or
CREDIT_NOTE_PENDING. Pending means SENDING/UNKNOWN, not an unsent preparation.
Apply relation filters with company scope before pagination, and use the same
where for count. Historical rejected attempts must not include a resolved draft.
Keep pagination DTO limited to page/pageSize/total/totalPages.

UI labels filters as consultation work, resets page on filter change and includes
filter in query cache/URL. Read-only users retain access. Tests cover pending rows
beyond first page, invoice versus NC versus combined results, resolved/rejected
history, prepared NC excluded, tenant isolation and invalid filter. No sending or
consultation happens automatically. Independent review and green CI before merge.

Verification: 295 Gestión tests, 34 fiscal authorization integration tests,
workspace typechecks/lint and production builds passed. Fresh migrations/schema
drift and repeat seed passed. Independent review approved. Integration fixture
uses one explicit listener to avoid Supertest close deadlocks in nested requests.
