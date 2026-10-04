# 034 — Authorize and reconcile total homologation credit notes

Status: IMPLEMENTED — local verification passed; additional global-series regression and CI pending.
Base: merged PR71 / main26e3f43. Branch agent/codex-credit-note-authorization.
Coordinator owns Prisma/migration/services/sharedclient/docs. Isolated protocol
worktree owns WSFE request/parser/builder files; UI worker owns note panels;
integration worker owns fiscal-authorization.e2e-spec.ts. Independent review
required before automatic merge, as explicitly authorized by user.

## Acceptance

NC3/8/13 with exact associated invoice1/6/11 (type/PV/number/issuerCUIT/date),
positive frozen totals and original groupedVAT, matching source invoice request.
Reuse existing transport/credentials and homologation-only endpoints. Require
manual expectedRevision and both confirmations. NC's own point of sale is the
original point in this slice, with dedicated NC numbering series.

Persist request+audit before external send. Global pending/number uniqueness per
legal issuer/PV/NCtype, one active attempt per note. Freeze note editing after
pending/authorized attempts. Unknown results consult the same number without
resending/releasing; reconcile verifies original association and all money/identity.
Definite rejection allows manual correction/retry. No commercial reversal of
invoice, stock, accounts, tender, collection or Treasury, even after testCAE.

## Verification

Protocol tests allABC association/response mismatch; durable integration before
send, duplicate race, unknown recovery, audit rollback before/after send, context
isolation, permissions, stalePV/revision, ledger snapshots and original unchanged.
UI dirtyreason/stalecontext/permissions/confirmations/uncertainresult tests.
Full applicable lint/types/tests/builds; migrations/schema-drift/double seed.
No real ARCA credentials provisioned; do not claim live acceptance or production.

Local verification: 374 API unit tests, 215 Gestión tests and 44 fiscal integration
tests passed; all workspace typechecks, applicable lint and production builds
passed. Fresh migrations match Prisma, double seed leaves business rows unchanged.
Two independent reviews found no blockers. Additional cross-company legal-series
regression added after initial harness run; final run pending.
