# 029 — Authenticated fiscal homologation and durable authorization

Status: IMPLEMENTED / VERIFIED LOCALLY — PR pending human review
Base: main 897349a, including merged PR #66.
Branch: agent/codex-fiscal-authorization.
Owner: coordinator owns Prisma/migration/shared contracts/client/dependencies and
integration; bounded workers own credential/WSAA code, UI and independent review.
No concurrent ownership of sensitive infrastructure. No merges to main; preserve
PR #17 AI Agent Relay open and unmerged.

## Scope

Continue fiscal preparation with server-provisioned credentials, WSAA login,
authenticated WSFE catalogs, test authorization and durable reconciliation.
No real issuer/certificate has been supplied. No production switch or live
successful authenticated run may be claimed. Concept 1 products, ARS/PES,
CUIT recipients and supported explicit A/B/C classes only. Require explicit
homologation and exclusive-point-of-sale confirmation for each new attempt.

## Credential boundary

ERP_ARCA_CREDENTIALS_DIR is an absolute canonical server path without symlinks.
Each company UUID owns certificate.pem and private-key.pem. Validate bounded
regular files, owner-only POSIX key modes, certificate dates, matching RSA key
at least 2048 bits and matching issuer CUIT subject. Windows ACL provisioning
is an administrator responsibility. Never accept credentials, paths or endpoint
URLs from client bodies. No secrets in Git, logs, audit or authorization JSON.
CMS signing uses RSA/SHA256; live compatibility remains pending. WSAA tickets
are bounded process-memory only; restart may require waiting for an existing
ARCA ticket to expire before obtaining another.

## State and isolation

Persist exact business request, number, revision and audit in one transaction
before the external send. Serialize each legal issuer/PV/type, including across
ERP companies sharing the same CUIT, and freeze submitted drafts. Use SENDING,
UNKNOWN, AUTHORIZED and REJECTED. Uncertain delivery or a process crash after
persistence but before transmission conservatively blocks the series. Consult
the original number and verify identity/amounts; do not resend automatically,
allocate a new number, or unlock based on “not found.” Unresolved cases require
manual review; no force-unlock endpoint in this slice. Do not alter commercial
sales, inventory, customer accounts, Treasury or prices.

## Required verification

Credential/CMS/WSAA unit tests, bounded transport and strict response parsing,
request arithmetic and eligibility tests, company/permission UI/client cases,
and real PostgreSQL/Redis integration for isolation, concurrency, persisted
request-before-send, unknown-result recovery, audit rollback and unchanged
business ledgers. Additive migration deployment, drift comparison, repeated
seed, lint/typecheck and production builds. Report actual results only after
completion. Use ephemeral test keys and mocked authenticated ARCA responses;
real authenticated acceptance remains blocked on operator provisioning.

## Deferred

Production, complete fiscal eligibility/registry validation, broader currencies,
services, recipient identification modes and catalogs; CAE QR/printing;
credit/debit notes; operational force-unlock/recovery tooling. See docs/fiscal.md
for exact provisioning and conservative recovery limitations.

## Verification results

API 288 unit tests; Gestión 167 and Facturación 71 tests; fiscal integration
24 tests pass. Repository lint/typecheck and API/Gestión/Facturación production
builds pass (two pre-existing navigation lint warnings). All migrations deployed
to disposable PostgreSQL 16, schema diff empty, repeated seed identical across
12 business tables. Extra agent reviews completed; real authenticated ARCA and
manual browser acceptance remain unperformed.
