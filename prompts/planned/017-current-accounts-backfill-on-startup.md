# Task 017 — Run the Current Accounts backfill on startup

Status: IN PROGRESS
Depends on: —
Agent: Claude
Base branch: claude/admiring-gates-wbjpaq (PR #37, unmerged — docs overlap)
Branch: feature/current-accounts-backfill-on-startup
PR: #38

Before making changes:

- Read AGENTS.md.
- Read `docs/current-accounts.md` ("The historical backfill" → "Open
  question") and `docs/implementation-status.md`.
- Inspect the current implementation — treat repository state as source
  of truth, not this file or any prior conversation.

## Objective

Close the open decision recorded in `docs/current-accounts.md`: nothing
makes an upgrade run `db:backfill-current-accounts`, so an existing
installation that upgrades into the Current Accounts module gets the
tables, the code, and a **completely empty ledger against sales that
already exist** — every customer reads as owing nothing until an
administrator happens to know the script exists.

This is a production data-correctness problem, not a convenience.

**The decision taken: a startup check**, over the two alternatives named
in the doc.

- **Not a migration.** A Prisma migration is SQL, and the backfill's
  semantics are not mechanical — a confirmed sale posts `SALE_CHARGE`
  plus `TENDER_SETTLEMENT` only if it has a tender; a purchase receipt
  that is `CANCELLED` *but was confirmed first* (`confirmedAt` set) posts
  an accrual **and** its reversal, while one cancelled straight from
  draft posts nothing. Restating that in SQL creates a second copy of the
  rules that has to be kept in step with the TypeScript one, which is
  exactly the duplication AGENTS.md forbids. A migration also runs once:
  the Tango data migration on the roadmap would land historical rows it
  would never see.
- **Not an installer step.** It would fix the Windows `.exe` path and
  leave Docker, manual upgrades and dev broken. It also bolts an
  unexercised step onto an installer that has never been run on any
  machine, right before that first clean-VM install — one more variable
  in the experiment that most needs to be clean.

A startup check covers every upgrade path with one mechanism, and the
existing script is already **idempotent by construction** — every insert
is `createMany({ skipDuplicates: true })` against the same unique
constraint the live path uses. That property is what makes running it on
every boot safe; it does not have to be invented.

## Acceptance criteria

1. **One copy of the semantics.** The backfill logic moves to
   `apps/api/src/accounts/current-accounts-backfill.ts` and is the single
   implementation. `prisma/backfill-current-accounts.ts` (the CLI) and
   `prisma/seed.ts` import it from there. The
   `db:backfill-current-accounts` script keeps working unchanged.

2. **It runs on API startup** and posts what is missing, without an
   administrator knowing anything.

3. **A normal boot does no work.** A cheap `EXISTS` probe decides whether
   there is anything to post; when there is nothing, the check must not
   load sales or receipts. The probe must be precise — a count comparison
   is not good enough, because a sale confirmed and later cancelled keeps
   its `SALE_CHARGE`, so counts can match while rows are still missing.

4. **Concurrency-safe.** Several API instances can boot at once on a LAN.
   A Postgres advisory lock means one does the work and the others move
   on rather than piling onto the same scan. Losing the lock is normal,
   not an error. It must be a **transaction**-scoped lock
   (`pg_try_advisory_xact_lock`): Prisma hands each standalone query
   whichever pooled connection is free, so a session-scoped lock and its
   release can run on different connections, the release fails silently,
   and the lock is then held until that connection dies — after which the
   backfill never runs again on that process. This was measured against a
   real database, not assumed.

5. **Bounded memory.** The current script does `findMany` over *every*
   confirmed sale, and over every receipt *with its lines*. Acceptable
   for a hand-run script; not for something that runs on every boot
   against years of history. Batch it.

6. **It never blocks or crashes startup.** A failure is logged and the
   API continues to serve — a degraded ledger is bad, an API that will
   not boot is worse.

7. **It leaves a trace.** A structured log line with the per-type counts,
   and one `AuditLog` row **only when it actually posted something**.
   Platform-level event: no fake `companyId`/`tenantId`/`userId` forced
   onto it (see the comment above `model AuditLog`).

8. **It can be turned off.** `ERP_CURRENT_ACCOUNTS_BACKFILL_ON_BOOT`,
   defaulting to on, so an operator who wants to run it by hand can.

9. **Tests.** Unit coverage for the probe/lock/disabled paths, and an e2e
   proving the real thing against a real database: seeded historical
   rows with no ledger → boot → ledger correct; boot again → nothing
   inserted the second time.

10. **Docs in the same PR.** `docs/current-accounts.md` — the "Open
    question" section becomes the decision and its reasoning.
    `docs/implementation-status.md` — the "Historical backfill" text and
    the "current-accounts backfill is not automated" technical-debt
    entry both stop describing an open gap.

## Out of scope

- Any UI for the backfill, in Gestión or anywhere else.
- Surfacing backfill state in the "Estado del sistema" panel (PR #32).
  Worth doing; a separate task.
- Changing what the backfill *means* — the movement semantics are not
  touched, only where the code lives, how it is invoked, and how much it
  loads at once.
- The aging report, credit limits, and everything else listed under
  "Deferred" in `docs/current-accounts.md`.
- Anything in `infrastructure/windows/**`.
