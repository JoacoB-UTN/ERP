# Backups and restore

**Status: IMPLEMENTED** (maintenance agent, CLI and read-only status endpoint).
Verified against `apps/server-agent`, `apps/api/src/system` and the tests listed
at the end of this document.

This is the first half of "ERP Local Operativo" Phase 1's remaining work; the
ERP Server installer (which registers the agent described here as a Windows
service) is the second half — see
[desktop-lan-architecture.md](desktop-lan-architecture.md).

## Why backups are not an API feature

This is the central design decision, and everything else follows from it.

A PostgreSQL dump covers the **whole database instance** — every tenant, every
company, all of it. There is no such thing as a company-scoped backup. The
product's authorization model, on the other hand, is entirely per-company:
permissions are granted through roles that belong to one company, and
`AGENTS.md`'s first architecture invariant is that a caller may never reach
another company's data.

Those two facts are irreconcilable if backups are exposed as normal API
operations. A `POST /backups` gated by any company-scoped permission would let
the Administrador of company A produce — and, with a download endpoint, walk
away with — company B's data. That is the top item on the code review "reject on
sight" list, dressed up as a feature.

So the split is:

| Capability | Where it lives | Who can do it |
| --- | --- | --- |
| Take a backup | `apps/server-agent` service | The server itself, on a schedule |
| Take one right now | `erp-backup now` | Someone with a shell on the server |
| Restore | `erp-backup restore` | Someone with a shell on the server, ERP stopped |
| **See backup health** | `GET /system/backups/status` | A user with `system.backups.read` |

Only the last row is an API operation, it is read-only, and it returns server
health facts (dates, sizes, success/failure) — never business data, never a
file, never a path. `system-backups.e2e-spec.ts` asserts that the write and
download routes do not exist, so adding one later fails a test rather than
quietly shipping.

## Why the manifest is a file, not a table

Backup history lives in `manifest.json`, next to the archives, and never in
PostgreSQL.

The moment backup history matters most is the moment the database is gone,
corrupt, or refusing to start. History stored inside the thing being backed up
is unreadable in exactly that scenario — the operator would be staring at a
dead server with no way to answer "which of these files is good, and when was
it taken?" A JSON file next to the dumps stays readable from Explorer, from a
recovery USB stick, from anywhere.

A pleasant side effect: no Prisma schema change, so backups add no migration.

The manifest contract is defined once in `packages/shared/src/backups.ts` and
consumed by all three sides (agent writes, API reads, Gestión renders). It
carries no secrets — not the cloud credentials, not the database password, not
the connection string.

## The agent

`apps/server-agent` is a small Node service, separate from `apps/api` on
purpose: backups must keep running while the API is stopped for maintenance,
and a crash in one must not take down the other.

### One run, end to end

```
dump → verify → checksum → record → offsite copy → prune
```

**Dump.** `pg_dump --format=custom`, which is compressed and is the only format
`pg_restore` can read selectively (one table, one schema) during a partial
recovery.

**Verify.** `pg_restore --list` is run against the archive that was just
written. This step is what makes the output a backup rather than a file: a
`pg_dump` that exits 0 can still leave an archive `pg_restore` cannot read — a
truncated write, a disk that filled, an antivirus holding the handle. Finding
that out during a real restore is the failure this prevents. A run that cannot
be listed back is marked failed **and its archive is deleted**, so a corrupt
file can never sit in the folder looking healthy.

**Checksum.** SHA-256, recorded in the manifest and re-checked at restore time.

**Offsite copy.** Optional and best-effort — see below.

**Prune.** Retention runs last, and only after a verified success: an agent that
is failing must never delete backups it cannot replace.

### Retention has a floor

Two rules, and the second overrides the first:

1. Delete archives older than `ERP_BACKUP_RETENTION_DAYS` (default 30).
2. Never drop below `ERP_BACKUP_KEEP_MINIMUM` archives (default 7).

Rule 2 exists because rule 1 alone has a catastrophic failure mode: if the agent
or the server was offline for longer than the retention window, *every*
surviving archive is expired, and a naive sweep would delete the business's only
copies of its data — precisely when something had already gone wrong. Retention
is an economy measure; it must never be the thing that destroys the last backup.
`retention.test.ts` covers this case explicitly.

### Scheduling

Times of day (`ERP_BACKUP_TIMES`, default `03:00`), not cron. A PyME policy is
"every night at 03:00", occasionally "03:00 and 15:00". HH:MM stays readable to
whoever supports the install, and keeps the next-run maths pure and testable.

The maths lives in `packages/shared/src/backups.ts` rather than in the agent
because two processes need it — the agent to know when to wake up, the API to
tell Gestión when the next backup is due. One implementation, so the two can
never show the operator a time the agent will not honour.

### Offsite copy

Off by default. The product is local-first: a local install must be fully
operable with no account and no internet connection.

When enabled it targets any S3-compatible store (AWS S3, Backblaze B2,
Cloudflare R2, MinIO). Two deliberate behaviours:

- **It fails fast at startup** if switched on but misconfigured. An operator who
  believes they have an offsite copy that has never uploaded anything is worse
  off than one who knows they have none.
- **A failed upload does not fail the run.** The local archive — the copy that
  restores fastest and works during an outage — already succeeded. The failure
  is recorded on the run so it surfaces in Gestión, rather than only in a log
  nobody reads.

Credentials come from the environment only. They are never written to the
manifest, never stored in the database, never logged.

### Configuration

All read from the environment and validated at startup (`src/config.ts`); the
installer writes them into the Windows service definition.

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | — (required) | Same connection string the API uses |
| `ERP_BACKUP_DIR` | `./backups` | Where archives and the manifest are written |
| `ERP_BACKUP_TIMES` | `03:00` | Comma-separated local times of day |
| `ERP_BACKUP_RETENTION_DAYS` | `30` | Age at which an archive expires |
| `ERP_BACKUP_KEEP_MINIMUM` | `7` | Hard floor on surviving archives |
| `ERP_PG_BIN_DIR` | PATH | PostgreSQL `bin` directory |
| `ERP_BACKUP_TIMEOUT_MS` | `1800000` | A longer dump is treated as failed |
| `ERP_BACKUP_CLOUD_ENABLED` | `false` | Enable the offsite copy |
| `ERP_BACKUP_CLOUD_ENDPOINT` | — | Omit for AWS; set for B2/R2/MinIO |
| `ERP_BACKUP_CLOUD_REGION` | `us-east-1` | |
| `ERP_BACKUP_CLOUD_BUCKET` | — | Required when the offsite copy is on |
| `ERP_BACKUP_CLOUD_PREFIX` | `erp-backups` | Key prefix within the bucket |
| `ERP_BACKUP_CLOUD_ACCESS_KEY_ID` | — | Required when the offsite copy is on |
| `ERP_BACKUP_CLOUD_SECRET_ACCESS_KEY` | — | Required when the offsite copy is on |

`apps/api` additionally reads `ERP_BACKUP_DIR` (same value) so it can find the
manifest. It only ever reads it.

## Restore

Restore is CLI-only, and its default target is a **new** database:

```
erp-backup restore erp-erp_platform-20260901-030000.dump
```

That restores beside the running system into `<database>_restore_<timestamp>`,
so an operator can confirm the archive contains what they expect before
anything irreversible happens. Clobbering the live database requires saying so:

```
erp-backup restore <archive> --overwrite
```

The ERP services must be stopped first — restoring under a live application is
how you end up with a half-old, half-new database.

Before touching any database the command:

1. Re-computes the archive's SHA-256 and compares it against the manifest. A
   mismatch is a **hard stop**, not a warning: it means the file changed after
   it was taken (bit rot, a partial copy off a USB drive, tampering), and
   restoring it would silently install corrupt data.
2. Confirms `pg_restore --list` can read the archive.

The restore itself runs `--single-transaction`, so a failure part-way through
leaves the target database untouched rather than half-populated.

## What Gestión shows

`/administracion/backups`, gated by `system.backups.read` (held by
Administrador via `ALL`, and granted to Gerente in the seed — a business owner
should be able to see whether their data is protected).

The page is built around one question: *if this PC dies tonight, what do I
lose?* So the headline number is the age of the last **successful** backup, not
of the last run — an operator whose most recent backup failed still needs to
know how old their newest usable copy is. Three states get distinct treatment,
because they call for different actions:

- **Not configured** — the agent has never written a manifest here. A fresh
  install must look unprotected rather than healthy-by-default.
- **Last run failed, or the newest good copy is over 48h old** — a warning
  naming the real age of the newest usable copy.
- **Healthy** — schedule, next run, count and total size, offsite status, and
  the recent run history including per-run verification.

There is no button to take or download a backup, for the reason at the top of
this document. The page says so, and points at `erp-backup restore`.

## Tests

| File | Covers |
| --- | --- |
| `apps/server-agent/test/retention.test.ts` | The retention floor, including the "everything is expired" case |
| `apps/server-agent/test/schedule.test.ts` | Next-run maths, including the exact-time and month-boundary cases |
| `apps/server-agent/test/config.test.ts` | Fail-fast on a misconfigured offsite copy; local-first defaults |
| `apps/server-agent/test/manifest.test.ts` | Atomic writes, corrupt-manifest tolerance, no secrets on disk |
| `apps/server-agent/test/pg.test.ts` | URL parsing; the password never reaching argv |
| `apps/server-agent/test/naming.test.ts` | Archive naming round-trip |
| `apps/api/test/system-backups.e2e-spec.ts` | Permission gate, the three status states, and the absence of write routes |

## Not covered here

- **Registering the agent as a Windows service** — the ERP Server installer,
  the other half of Phase 1.
- **Restoring a single company** out of an instance-wide dump. Possible in
  principle with `pg_restore`'s selective flags, but it is a real piece of
  design work (foreign keys across shared tables) and is not attempted.
- **Backup of anything other than PostgreSQL.** There are no user-uploaded
  files in the product yet; when there are, they need their own copy path.
