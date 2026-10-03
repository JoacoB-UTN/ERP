# Browser acceptance — Treasury and demo, 2026-10-03

Tested application: `1c2e7e8` (main after PRs #61 and #62). Existing
production builds match this application code. The follow-up changes one
Treasury error message and documentation; it does not change ledger rules.

## Environment and scope

Fresh PostgreSQL 16 and Redis, dedicated data directories and loopback
ports; existing migrations only, synthetic seed, both frontends and API.
No existing installation or user database was reset or modified. Company
ANRAS uses `America/Argentina/Buenos_Aires`; Treasury date inputs display
the browser's local timezone. All operations below occurred on October 3.
All temporary application, Redis and PostgreSQL services were stopped after
the rehearsal; temporary credential files were removed.
This was an acceptance walkthrough with inspection pauses, not a timed
13-minute sales presentation.

## Double seed

Compared rows after two consecutive seed runs, including identities and
business fields, excluding `updatedAt`. The administrator password is
rehashed by design and was not included in this comparison. Other models
not listed below were not asserted byte-for-byte unchanged.

| Tables | Stable count |
| --- | --- |
| Companies, customers | 4, 16 |
| Products, variants | 17, 21 |
| Price lists, price items, price history | 3, 21, 21 |
| Sales, sale lines, tenders | 12, 22, 10 |
| Stock movements, inventory balances | 49, 23 |

All compared rows matched. This verifies the fresh fixture's repeatability,
not unrestricted safety of reseeding an existing installation.

## Treasury browser observations

- ANRAS initially showed no Treasury accounts.
- Created `QA-CAJA`, ARS cash account linked to Casa Central; created
  `QA-BANCO`, ARS bank account with bank name/alias.
- Opened cash with ARS 1,000.50. One opening movement appeared. A second
  opening of ARS 25 was rejected; balance and movement count stayed intact.
- Created `TRF-000001` for ARS 250.25 from cash to bank. Draft offered
  edit/confirm, without cancellation. Confirmation required explicit review.
- Confirmed: cash ARS 750.25; bank ARS 250.25.
- Cancelled through the compensating-operation review: cash ARS 1,000.50;
  bank ARS 0. Cancelled document offered no repeat cancellation.
- Cash statement retained opening, original outflow and compensating inflow,
  with running balances 1,000.50 → 750.25 → 1,000.50. The database contained
  five Treasury movements: one opening and two original/reversal pairs.
- After the sale and POS flows below, Treasury balances remained unchanged,
  consistent with the displayed POS exclusion.
- Switching to CABACO showed an empty account list, without ANRAS accounts.

The repeated-opening error recommended an adjustment flow that has no
implemented screen/API. The follow-up message states the actual rule:
opening is only allowed before the first movement. The conflict code and
HTTP response status remain unchanged.

## Demo browser and database observations

Context: ANRAS, Casa Central, Depósito Central, Minorista.

| Checkpoint | Observed result |
| --- | --- |
| Initial dashboard, default 30 days | 11 confirmed, ARS 657,400.00; average ARS 59,763.64 |
| Initial Café search | ARS 22,000.00; availability 159 |
| Standard sale to Ferretería El Puente | VTA-000013, confirmed, one Café, ARS 22,000.00 |
| Gestión stock after standard sale | Café Central 158 |
| POS default customer | Consumidor Final |
| Cash POS | VTA-000014, ARS 22,000.00; received 25,000.00; change 3,000.00 |
| Gestión stock after POS | Café Central 157; Norte 16 and Salón 14 unchanged |
| Final dashboard, default 30 days | 13 confirmed, ARS 701,400.00; average ARS 53,953.85 |

Database comparison found exactly two new stock rows, each a `SALE` of -1
linked to its respective confirmed VTA-000013/VTA-000014. Final counts:
14 sales, 51 stock movements. This confirms each browser sale's ledger
association; no repeated read produced an extra movement.

The guide's prior daily dashboard cards are absent from the current UI.
The home screen shows a sales series with 7-day, 30-day and 12-month
periods. The guide now uses the explicit 30-day selection; the API's daily
summary must not be described as a visible daily card.

## Limits and remaining acceptance

This pass did not exhaustively exercise all permission combinations,
account editing/activation, statement date filters/pagination, transfer
editing or refresh races. Selected cases have automated coverage in PR #62;
the full matrix remains unverified, and automated tests are distinct evidence. No desktop installer, offline-central scenario or
production deployment was tested here.

The demo's optional card sale, printed/internal receipt presentation,
full customer/product/pricing tour and timed rehearsal remain pending;
task 015 stays PARTIAL. Treasury UI task 025 is integrated and its core
browser flow is verified; the broader Treasury task 019 stays PARTIAL for
its explicitly deferred features.

## Verification of the follow-up change

API typecheck, lint with automatic fixing disabled, 114 unit tests and API
production build passed after the message correction. No frontend source,
shared contract, dependency, schema or migration changed. Prior merged PR #62
has successful lint/typecheck, tests and full build in GitHub CI; that is
separate from this follow-up's checks. Documentation links and whitespace
were checked before commit.
