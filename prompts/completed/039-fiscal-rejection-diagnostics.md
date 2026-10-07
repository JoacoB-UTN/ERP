# 039 — Safe ARCA rejection diagnostics

Status: DONE — merged PR #77, main d41b802.
Verified: 434 unit / 42 integration tests, workspace lint/types, all production
builds, independent review and exact-head CI passed.
Base: merged PR #76, main 2dc96d2.
Dependency: PR #76 is merged; developed from its reviewed head before merge.
Branch: agent/codex-fiscal-rejection-diagnostics.

Owners: protocol worker owns arca-wsfe.service.ts and its unit spec. Coordinator
owns integration tests and docs. Independent reviewer is read-only.
No schema/migrations/shared/auth/context/authorization/audit/root configuration.

Problem: correlated rejected submissions discard all observation codes, so the
operator only sees a generic rejection. Keep validated numeric codes and short
local descriptions in the existing safe message. Never persist/return upstream
Msg text, XML, tokens, signatures or arbitrary strings.

Only enrich a response already accepted as correlated REJECTED with no CAE.
Malformed/missing diagnostics within otherwise valid XML use a safe fallback;
existing global namespace validation stays unchanged, so wrong namespaces still
produce uncertainty. Never change classification,
series ownership, retry/reconcile logic, or accepted/uncertain responses.
Codes: decimal integers 1–99999, at most ten distinct codes; bounded scanning.
Read only direct expected-namespace Observaciones/Obs/Code fields, no descendants
or wrong namespace. Unknown valid codes get a safe numeric fallback.

Verified source: ARCA WSFEv1 manual, consulted 2026-10-07:
https://www.arca.gob.ar/ws/documentacion/manuales/manual-desarrollador-ARCA-COMPG.pdf
Printed PDF p.38: Obs.Code Int(5), Msg separate. Local brief descriptions for
10048 (total/components, pp.47–48), 10242 (recipient VAT catalog), 10243
(recipient VAT incompatible with voucher class), 10246 (recipient VAT required),
p.70. Descriptions are diagnostic hints, not automatic correction or tax advice.

Acceptance/tests: several/duplicate/unknown codes, strict bounds/malformed/nested
or wrong namespace values, secret Msg ignored, code-count/message bounds,
invoice+NC rejection, unchanged UNKNOWN/A paths, persisted code survives manual
retry and remains in history. Lint/types, API/Gestión tests, relevant integration,
production builds, independent fiscal review and exact-head CI before merge.
