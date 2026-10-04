# 035 — Follow and print homologation credit notes

Status: DONE. PR #73 merged after local checks, independent review and all CI passed.
Base: merged PR #72 / main cff1877.
Branch: agent/codex-credit-note-followup.

## Ownership

Coordinator: shared list contract, documentation, integration and verification.
API worker: fiscal.service.ts and fiscal-authorization.e2e-spec.ts.
List worker: Gestión fiscal.tsx and fiscal.test.tsx.
Print worker (isolated worktree): invoice/note print components and tests,
credit-note panel integration and anchor. No Prisma, auth, company context,
authorization infrastructure, audit infrastructure, root config or ledger changes.

## Acceptance

The existing fiscal list shows the saved NC and its latest persisted state/number
without ARCA calls. Queries remain company-scoped, paginated and bounded; summaries
contain no credentials, CAE or full authorization request. Missing old-cache data
must not look like a definitively absent note. Read permission remains sufficient.

Print an authorized homologation NC using its immutable snapshot, positive saved
amounts, original-invoice association, reason and matching own authorization.
Wrong revision/type/state/environment/identity must not print. Show repeated
SIN VALIDEZ FISCAL / SOLO PRUEBAS warnings, no production QR. When invoice and NC
are mounted together, only the explicitly selected document prints. Recheck
active company and freshness at click; preserve invoice printing behavior.

## Verification

API integration: absent/prepared and latest NC states, isolation and minimal
response, unchanged list pagination. UI tests: statuses/links/missing data and
print selection, snapshot, escaping, mismatch, permissions/context freshness.
Run relevant lint, workspace types, tests and all production builds. Independently
review fiscal presentation before automatic merge authorized by user.

Results: 254 Gestión tests and 32 authorization integration tests pass. Full
workspace typecheck, applicable lint and API/Gestión/Facturación production builds
pass. Integration database migration/drift/double seed checks also pass.
Chromium exercised both real print components with a 65-line fixture: only the
chosen sheet printed, company change blocked printing and afterprint cleared
selection. Invoice and NC PDFs have five pages each, warnings on every page;
first and final NC pages visually inspected. This is component-browser evidence,
not live ARCA acceptance or a full authenticated operator rehearsal.
