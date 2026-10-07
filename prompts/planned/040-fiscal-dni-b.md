# 040 — DNI recipients for invoice B and total NC B in homologation

Status: IN PROGRESS.
Base: PR #77, agent/codex-fiscal-rejection-diagnostics fac9fcc.
Dependency: merge PR #77 and rebase before this task merges.
Branch: agent/codex-fiscal-dni-b.

Ownership: coordinator owns packages/shared, API integration specs and docs.
Protocol worker owns fiscal API services/builders/WSFE and their unit specs.
UI worker owns facturas-fiscales components and component tests. Reviewer is
read-only. Shared worktree, disjoint paths; no branch switches or bulk git add.
Forbidden: Prisma/schema/migrations, customer-domain behavior, auth/context/
authorization/audit infrastructure, lockfile and root configuration.

Scope: extend the existing homologation subset to a customer explicitly marked
DNI and CONSUMIDOR_FINAL, invoice B and its total NC B only. No inference of VAT,
issuer setup, production, anonymous recipients, thresholds, A/C DNI, partial NC,
money/ledger changes, or automated fiscal corrections.

Freeze recipient.documentType (existing CustomerDocumentType or null) alongside
taxId in new source snapshots and explicit identity refresh. The existing
customer taxId column holds the document number even for DNI; no schema needed.
Legacy snapshots without documentType must never infer DNI from their number or
the current customer. Existing valid CUIT behavior and old attempts remain usable.
Unsent legacy DNI requires explicit identity refresh before sending. All prior
attempts still freeze identity and amounts, even rejected ones.

New request JSON uses explicit recipientDocumentType (80/96) and
recipientDocumentNumber. A shared backend reader must support historical
recipientCuit-only requests as type80, reject contradictory/partial representations
and validate before any send or consult. Do not invent a Cuit field for DNI.
Canonical DNI number is a positive decimal integer fitting WSFE DocNro Long(11),
with leading zeroes normalized consistently; no arbitrary 7/8-digit minimum.
New DNI requires B/type6 (or associated total NC8), declared CF/id5, and live
FEParamGetTiposDoc catalog support. Keep all existing IVA/PV checks.

Match type AND number when accepting authorization/consultation; an otherwise
matching response for another document type remains uncertain. NC must preserve
the original authorized identity and amounts and work for old CUIT requests as
well as new DNI. Existing recovery remains consult-only and never resends.

UI displays the saved document type and number in preparation, identity and
test printing. It must not infer DNI from length or current customer data, nor
claim a successful test means production eligibility. Preserve availability,
confirmation, unsaved edits, mutually exclusive print selection and history.

Source: official WSFEv1 manual, checked 2026-10-07, PDF pp.27,40–41:
https://www.arca.gob.ar/ws/documentacion/manuales/manual-desarrollador-ARCA-COMPG.pdf
DocTipo96 is DNI and must be present in authenticated document catalog.

Acceptance/tests: B/NC8 DNI valid; A/C or other VAT rejected; malformed/zero/too
long numbers; leading zero normalization; stale type with same number; legacy
snapshot/request behavior; explicit refresh without prior attempts only; wrong
type/number in responses/consultation; missing/invalid catalog; exact frozen NC
identity; company/permissions; no ledger effects. Lint/types, unit/integration/
Gestión suites, production builds, independent review and exact-head green CI.
