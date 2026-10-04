# 027 — Borradores fiscales desde ventas confirmadas

Status: DONE — merged in PR #65; no ARCA authorization or real issuance
Owner: coordinator (Prisma/migration/shared/client/docs); backend worker
owns fiscal module/tests; UI worker owns only new Gestión routes,
minimal navigation and UI tests. Independent fiscal review required.
Base: main a16277b (includes merged PR #64), branch agent/codex-fiscal-drafts.

## Scope

User prioritized fiscal invoicing. Issuing company/VAT status are unknown and
no homologation certificate/point of sale exists. Implement a usable draft
workflow: select a confirmed ARS internal sale, explicitly declare its existing
payable line amounts to be VAT-inclusive final amounts, choose a proposed
A/B/C type and each line's tax treatment, calculate/preview and persist a
company-scoped draft with audited optimistic updates. No automatic tax rate,
no inferred issuer eligibility and no rewriting of sales, prices, stock,
current accounts or Treasury. Never assign fiscal numbers or fake CAE.

One draft per sale, DRAFT only, with revision, immutable source snapshot and
server-calculated line/aggregate breakdown. Saving an existing draft requires
its current revision. User chooses line treatment explicitly; C has no VAT
discrimination and requires its own explicit choice. Only exact-cent source
amounts accepted in this first cut; no silent rounding of payable sale totals.
PriceList.includesTax is NOT evidence that historic sales are tax-calculated.

UI clearly states draft/no fiscal validity and pending issuer/recipient
validation, homologation setup and ARCA authorization. Preview is not a WSFE
request and cannot certify eligibility. Separate fiscal document entity
references the existing sale without creating a second commercial domain.

## Boundaries

Root alone owns Prisma/migrations, packages/shared, packages/auth-client and
app module registration. No auth/context/authorization/audit infrastructure
changes: existing sales.invoices.read/create permissions and AuditService
are reused. No production credentials, emission, deployment or merges.
PR #17 stays open. Previously separate sync diagnostic PR #64 is now merged.

## Acceptance and checks

Decimal-only IVA breakdown, cent conservation, explicit zero/exempt/non-taxed
versus taxable treatments; tax chosen per source line, no omitted/duplicate/
foreign IDs. Confirmed ARS sale and exact source totals required. Stored
snapshots survive master changes; concurrent create/update yields one result
or conflict, no lost edit. Same-company reads and permission refusals tested.
Audit and persistence atomic. UI company switch clears draft state and binds
requests to their source company, including refresh retries.

Run relevant lint, typecheck, API/UI unit tests and production builds;
disposable Postgres/Redis integration for permissions/isolation/concurrency/
ledger non-effects. Migration deploy and double seed in disposable DB only.
Document actual evidence separately from pending live homologation.

## Later stages

Issuer/recipient fiscal profiles, real PV/certificate WSAA setup, catalog
validation, WSFEv1 request/authentication, durable numbering/authorization
state and timeout reconciliation, CAE/receipt/QR, credit/debit notes and
separate offline/CAEA design. Drafts alone do not complete fiscal invoicing.
