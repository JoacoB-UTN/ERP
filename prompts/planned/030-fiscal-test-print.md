# 030 — Print authorized homologation vouchers

Status: IMPLEMENTED — pending review.
Owner: Codex coordinator, Gestión fiscal UI only.
Base: main 32d2eac, including merged PR #67 (same verified tree as af2141f).
Branch: agent/codex-fiscal-test-print.

## Scope and acceptance

Print the saved authorized homologation voucher with issuer/recipient snapshots,
saved line treatments and amounts, original test number, CAE and expiration.
Require matching draft ID/revision/type and complete authorization. Pending,
unknown and rejected attempts have no printable voucher. Visible repeated
SIN VALIDEZ FISCAL warnings; no production QR or legal invoice claims.
Use browser print/PDF support. No backend/schema/contracts/ledger changes.
Check active company again before printing. Print CSS isolates the document from
navigation and repeats the table warning across detail pages.

## Verification

Gestión lint (one existing navigation warning), typecheck, 178 tests and production build pass. Focused cases cover
eligibility, Decimal-string display, escaped user text, company changes and
portal cleanup. Chromium print-media/PDF check with 85 rows for pagination,
repeated disclaimers and hidden navigation. No live ARCA call or authenticated
browser acceptance is claimed. See docs/fiscal.md for remaining limitations.

PR #67 is merged; obtain human review before merging this PR to main. PR #17 stays
open and unmerged. Production fiscal printing remains separate work.
