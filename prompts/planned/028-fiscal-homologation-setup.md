# 028 — Fiscal issuer setup and public homologation connectivity

Status: IMPLEMENTED — pending human review
Owner: coordinator owns final schema/migration/contracts/client/dependencies,
backend, transport and UI integration. No overlapping sensitive ownership.
Base: main 9982743, after the user merged PR #65.
Branch: agent/codex-fiscal-homologation-setup. PR targets main.

## Scope

Persist company-scoped declared VAT condition and test point of sale, both
nullable because the operator does not yet know them. Existing Company
legalName/taxId remains authoritative and read-only in this setup flow.
Local CUIT validation checks format/checksum only, never ARCA registration.
Homologation only; no production switch, user URLs, certificate/private-key
fields, credentials storage, WSAA login, invoice authorization or ledger edits.

GET/PUT /fiscal/settings require configuration.manage. Strict payloads,
optimistic revision (0 before initial save), advisory company transaction lock,
audit atomicity and safe context-bound client hooks follow existing patterns.
A saved profile is a local declaration, never authorization to issue.

POST /fiscal/settings/connectivity requires configuration.manage and an empty
strict body. Public FEDummy SOAP request goes only to the official fixed
homologation endpoint, with timeout, bounded body and strict XML parsing.
It sends no issuer/recipient identity, certificate or invoice. Return only
sanitized service availability and checkedAt; authorizationAvailable is always
false. Network failure is distinct from valid degraded service response.
No redirect-following or certificate-check bypasses. UI explains the limited
meaning of availability and displays missing preparation requirements.

## Verification

Unit parser/transport tests; shared-client/company changes; UI save/conflict,
unknown values, permissions and stale responses; real PostgreSQL/Redis e2e
settings scope, cross-tenant isolation, permissions, strict input, optimistic
concurrency and audited rollback. Migration deploy, no schema drift, double
seed idempotence in disposable database. Lint/typecheck/production builds.
Review tax/configuration/security separately before human merge.

## Deferred

Credential provisioning/secure storage, authenticated WSAA/WSFE access, live
registry/catalog validation, fiscal request construction, durable numbering
and uncertain-response reconciliation, CAE/QR/printing. No live authenticated
homologation can be claimed without the operator's issuer data/certificate.
PR #17 remains untouched/open. No merges to main.
