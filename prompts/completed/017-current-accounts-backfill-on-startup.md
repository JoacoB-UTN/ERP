# Task 017 — Run the Current Accounts backfill on startup

Status: DONE
Depends on: —
Agent: Claude
Base branch: main
Branch: feature/current-accounts-backfill-on-startup
PR: #41 (merged as `078aa71`)

**On the PR number.** The work was reviewed as **#38**, which was opened
against `claude/admiring-gates-wbjpaq` (PR #37's branch) rather than
`main` and whose base was never retargeted. Merging it therefore landed
the content in that branch and not in `main`; `main` had the tables and
none of the module. **#41** re-opened the same branch against `main` —
same revision, no code changes — and is the merge that counts. #38 is
marked merged by GitHub and carries a comment saying so.

**Corrections made during review, after the acceptance criteria below
were written.** All three are in `main`:

- Turning the load off left the module answering 503 forever.
  `disabled` was terminal — nothing re-evaluated it — so an operator who
  ran the CLI by hand and restarted still got a refusal, which is the
  opposite of what criterion 8's escape hatch is for. The flag now turns
  off the *write*, not the question: the probe still runs, and a ledger
  with nothing outstanding reports `complete`.
- This branch had forked from an earlier commit of #37's and silently
  reverted its installer figure corrections. Fixed by merging #37's real
  head in.
- The e2e suite asserted that *its own* boot did the backfill, which the
  one global advisory lock plus 19 parallel suites made a race — it
  failed intermittently with "expected 2 charges, received 0". `bootApp`
  now retries the pass; validated with four consecutive green runs.

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

10. **The e2e harness survives a boot-time writer.** Nineteen e2e suites
    share one database and each boots `AppModule`, so every one of them now
    runs a backfill that scans *every* company, not just its own. The
    suites' teardown deleted the ledger rows *before* the sales they derive
    from, which leaves a window where a concurrently booting suite re-posts
    them and the later `customer.deleteMany()` fails on
    `customer_account_movements_customerId_fkey`. Teardown has to delete the
    source documents first, so there is nothing left to back-fill from.
    (This is a test-harness problem only: AGENTS.md forbids physically
    deleting confirmed financial documents, so nothing in production
    deletes a confirmed sale out from under the backfill.)

11. **Current accounts must not answer while the ledger is incomplete.** A
    balance is derived from the ledger, so a missing history reads as a
    confident **zero** — indistinguishable from "nobody owes anything". A
    readiness gate refuses with 503 unless the state is `complete`, and
    `disabled` is refused too: turning the load off hands the job to an
    operator, it does not do the job. A `pending` state must be re-checked
    rather than trusted, or the instance that lost the advisory lock refuses
    forever over a ledger that is loaded.

12. **The operator can see it.** Estado del sistema shows Al día /
    Ejecutando… / Falló / Desactivado / Pendiente, as a state word with no
    counts, company names or amounts — `GET /health` is unauthenticated.

13. **The e2e drives the real boot path.** Fixtures inserted through a
    separate client BEFORE any Nest app exists, then `app.init()` as the only
    thing that makes the backfill run. Nothing may call
    `backfillCurrentAccounts` or `AuditService.record` to produce the result
    it then asserts. Plus two instances booting at once, and an injected
    transaction failure — deterministic, no sleeps.

14. **Docs in the same PR.** `docs/current-accounts.md` — the "Open
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
