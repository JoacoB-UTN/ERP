# 032 — Explicit company representation by a personal ARCA certificate

Status: DONE — PR #70 merged after passing CI and independent review.
Owner: credential worker owns credential loader and its tests; coordinator owns
WSAA integration test and docs. Independent security review before merge.
Base: main 6a79bc4, merged PR #69 (same tree as 94600ca). Branch: agent/codex-fiscal-representation.

## Scope

Support WSASS personal certificate representing a different company CUIT only
with strict server-provisioned company-folder representation.json containing
issuerCuit and certificateCuit. Match both exact canonical/checksummed CUITs;
reject malformed, missing-required, extra-key, symlink or oversized files.
Without a file, retain same-CUIT policy. Present-invalid is never ignored.
Validate before each WSAA cache lookup. WSFE keeps company's issuer CUIT.
No schema, shared contract, UI, auth/RBAC, audit or client configuration changes.

## Acceptance

Test direct and delegated identities, mismatch/cross-company file reuse,
file revocation/changes, malformed input and bounded/no-symlink loading.
An integration test uses real ephemeral certificate/files and cached WSAA
response, then removes/changes binding and expects denial without another call.
Use only simulated upstream calls. Run API lint/typecheck/unit/build and CI.

## Limits

Local binding is not ARCA delegation: WSASS association still required. No real
certificate available; live authentication and production remain unverified.
Use dedicated certificate/alias per company; caches stay company-scoped and
sharing one certificate can cause existing-ticket errors. Revocation applies to
next request and cannot recall work already in flight. No main merge with red CI.
User has explicitly authorized automatic merge after checks/review; preserve PR17.

Local verification: 315 API unit tests, API lint/typecheck/production build pass.
Independent review found writable-directory bypass and confirmed its correction
with four regressions. No live credentials or authenticated ARCA call used.
