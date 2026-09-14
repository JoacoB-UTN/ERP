# Task 018 — Validate the ERP Server installer on a clean Windows VM

Status: PLANNED
Depends on: —
Agent: UNASSIGNED
Base branch: main
Branch:
PR:

Before making changes:

- Read `AGENTS.md`.
- Read `docs/server-installer.md` end to end — especially "Not verified,
  and needing a clean Windows VM", which this task exists to empty.
- Read `docs/backups.md` and `docs/desktop-lan-architecture.md`.
- Inspect `infrastructure/windows/scripts/install.ps1`,
  `uninstall.ps1`, `build-payload.ps1`, `erp-server.iss` and the five
  templates under `infrastructure/windows/services/` — treat repository
  state as source of truth, not this file.

## Objective

Run the compiled `ERPServerSetup-*.exe` on a **clean Windows machine**
and walk installation, start-up, upgrade and uninstall, recording what
actually happens.

This task is **not a feature**. Its deliverable is *evidence* plus the
fixes that evidence forces. It is the gate before any customer install:
the commercial circuit is complete and the `.exe` compiles with
PostgreSQL inside it, but **no installer has ever been executed on any
machine**, so nothing downstream can be scheduled honestly.

Expect to find defects. The installer's entire history is that running it
for real is what surfaces them — placeholders in templates, PowerShell
5.1 incompatibilities, XML escaping, replacing live services, single
quotes in parameters were all found by executing, never by review. A run
that finds nothing is more likely a run that did not look.

## Environment

- A **clean** Windows VM — no Node, no PostgreSQL, no Visual C++
  redistributables beyond what the OS ships, no prior ERP install. A
  snapshot taken before the first run, so the clean state is
  reproducible; several acceptance criteria below need a fresh VM.
- Windows 10 or 11, whichever the target customers run. Record which.
- **PowerShell 5.1** must be exercised, not just 7.x: it is what a stock
  Windows box has, and it has already broken this installer once.
- The artifact from the `ERP Server installer` workflow dispatched with
  `compile_installer=true`. Record the run number and the commit.

## Acceptance criteria

1. **The `.exe` runs at all.** Record what SmartScreen does with an
   unsigned binary and exactly what a non-technical operator must click
   to proceed. If SmartScreen blocks it outright rather than warning,
   say so — that changes code signing from "nice to have" to a blocker.

2. **Installation completes on the clean VM**, from the installer's own
   prompts (company name, tax id, admin email and password, install
   directory), with the default ports: PostgreSQL 5433, API 3001,
   Gestión 3000, Facturación 3002.

3. **`initdb` succeeds under the service account.** This is the single
   most likely place to find the next problem — locale and data-
   directory permissions. Record the account the cluster ends up running
   under and any locale/encoding surprises. The bundled engine is pruned
   (`doc`, `include`, `symbols`, pgAdmin, StackBuilder removed), so a
   missing-file failure here means the prune took something real.

4. **All five services register and start**, in order: `erp-postgres`,
   `erp-api`, `erp-gestion`, `erp-facturacion`, `erp-agent`. Verify
   against the **real** Service Control Manager — `Get-Service`, the
   Services console, and the Windows Event Log — not by reading the
   rendered XML. Confirm each is set to start automatically and actually
   comes back after a **full VM reboot**, which is the test that matters
   for a shop that switches the machine off at night.
   Note: the PostgreSQL service runs `postgres.exe` directly rather than
   `pg_ctl runservice`, because the latter registers itself with the SCM
   and collides with WinSW. If that assumption is wrong, this is where it
   shows.

5. **Failure and restart behaviour.** Kill each service's process and
   record whether WinSW restarts it, how fast, and what lands in the
   Event Log. A supervisor that does not actually supervise is worth
   knowing about before a customer finds out.

6. **The product works over the LAN, not just on the server.** From a
   *second* machine on the same network, open Gestión and Facturación by
   the server's LAN IP, log in as the provisioned administrator, and
   complete one real sale end to end: create a customer and a product,
   set a price, load initial stock, confirm a sale in Facturación, and
   see the stock move in Gestión. `NEXT_PUBLIC_API_URL` is deliberately
   unset so the frontend derives the API's host from the page — this
   criterion is what proves that works off-box.
   Do the same through the POS checkout path with a payment method.

7. **Current accounts answer.** After boot, confirm the module is not
   stuck refusing with 503 `CURRENT_ACCOUNTS_NOT_READY` — a fresh
   installation has no history, so the startup backfill should find
   nothing outstanding and report `complete`. Check Gestión's *Estado del
   sistema* panel shows the backfill row as *Al día*.
   (Depends on task 017 being merged; if it is not, note that and skip.)

8. **ACLs hold against a real non-administrator user.** Log in as a
   standard user on the same VM and confirm the install directory,
   `config\erp-secrets.json` and the rendered service definitions are not
   readable. Everyone logging in as the same local user is the normal
   case on a shop PC, so "it is protected from Administrators" is not the
   question — whether a non-admin can read the database password and the
   JWT signing key is.

9. **A real backup runs and restores.** Let the scheduled backup fire (or
   trigger one), then restore it into a new database and confirm the data
   comes back. Confirm the backup history and dumps live outside
   PostgreSQL and survive. Confirm a tampered file is rejected.

10. **Upgrade over an existing installation.** Re-run the installer on
    top of the install from criterion 2 and confirm: the secrets are
    **reused**, not regenerated — a new JWT secret silently invalidates
    every session and a new database password locks the API out of its
    own data; the database survives with its rows; services are replaced
    while running without needing a manual stop; migrations apply.

11. **Interrupted install recovers.** From a fresh snapshot, interrupt an
    install (cancel a UAC prompt, or kill it mid-step) and then re-run it
    as Administrator. It is documented as idempotent and as the supported
    repair path — confirm that is true rather than assumed.

12. **Uninstall.** Confirm it removes the services and the application
    but **preserves the database and the backups**, as documented. Then
    confirm a re-install on top of that state works.

13. **Evidence, written down.** `docs/server-installer.md`'s "Not
    verified" matrix is rewritten against what actually happened: every
    item either moves to verified with the detail that proves it, or
    stays pending with the reason. Screenshots or console transcripts for
    anything surprising. **Do not mark an item verified that was not
    exercised** — an untested claim in that document is worse than an
    admitted gap, because the next person will trust it.

14. **Defects found get fixed or filed.** Anything that blocks a customer
    install is fixed in this task. Anything that does not is written up
    as its own `prompts/planned/` file rather than left in a commit
    message. Say which is which, and why.

15. **`docs/implementation-status.md` and `docs/roadmap.md` stop calling
    this the blocking constraint** once it no longer is — and keep saying
    so, accurately, if it still is.

## Out of scope

- **Code signing.** Buying or configuring a certificate is its own task;
  this one only records what an unsigned artifact does to the operator
  experience.
- Any new product feature, endpoint, screen or migration. Fixes to the
  installer scripts and the docs are in scope; the ERP's own behaviour is
  not.
- The Tango data migration, Treasury, and the fiscal/ARCA work. All of
  them sit behind this task.
- Automating this validation in CI. A GitHub runner is not a clean
  customer machine, and pretending otherwise is how this gap survived
  this long.
