# ERP Server installer (Windows)

**Status: IT HAS NOW BEEN RUN ON A CLEAN MACHINE, AND IT FAILED THREE TIMES
BEFORE IT WORKED.** The payload build, the provisioning path and — since PR
#25 — compiling the `.exe` in CI were already verified. On 2026-09-14 the
installer was finally executed on a clean Windows 10 Home VM and hit three
consecutive blocking defects, none of which CI could see: no Visual C++
runtime, English-only identity names in the ACL step, and an ACL hardening
that locked PostgreSQL out of its own binaries. All three are fixed — see
"The first real installation, and the three things it found" below.

What is still **not** verified is everything after a successful first
install: service registration against the real Service Control Manager,
survival across a reboot, the ACLs against a non-administrator, an upgrade
over an existing installation, and the uninstall path. The pending list near
the end of this document is the authority on that; do not read "it installs
now" as "it is ready for a customer".

This is the second half of Phase 1's remaining work. The first half — scheduled
backups — is [backups.md](backups.md), and this installer is what registers
that agent as a service.

## What gets installed

One machine per business runs everything; every other PC runs the thin Electron
client and talks to it over the LAN. That deployment shape, and the reasons for
it, are in [desktop-lan-architecture.md](desktop-lan-architecture.md); this
document is how it actually gets onto a customer's PC.

Five Windows services, all supervised by [WinSW](https://github.com/winsw/winsw):

| Service | Runs | Depends on |
| --- | --- | --- |
| `erp-postgres` | Bundled PostgreSQL, loopback only | — |
| `erp-api` | `apps/api` | `erp-postgres` |
| `erp-gestion` | Gestión (Next.js standalone) | `erp-api` |
| `erp-facturacion` | Facturación (Next.js standalone) | `erp-api` |
| `erp-agent` | Backup agent | `erp-postgres` |

The maintenance agent depends on PostgreSQL but deliberately **not** on the
API: backups must keep running while the API is stopped for maintenance or an
upgrade.

## Why PostgreSQL is bundled

The ERP ships and supervises its own PostgreSQL rather than adopting one the
customer may already have. Three reasons:

- **Version drift.** `pg_dump` refuses to dump a server newer than itself. A
  customer upgrading "their" PostgreSQL would silently break ERP backups — the
  failure nobody notices until a restore is needed.
- **Ownership.** An ERP that adopts an existing instance also adopts whatever
  else lives in it, and can no longer safely remove anything on uninstall.
- **Collisions.** A private instance on its own port and data directory cannot
  be disturbed by another application's.

It listens on `127.0.0.1` only. LAN clients reach the API; never PostgreSQL —
the invariant from `AGENTS.md`.

## Why Redis is not bundled

It used to be impossible not to. `RedisService.onModuleInit` awaited
`client.connect()` unconditionally, and because ioredis retries forever that
call never settled with Redis absent: **the API hung on boot**. Redis was
therefore a hard dependency in practice while being documented as optional —
`HealthService` reports a Redis outage as `degraded`, not `error`, and
`AuthorizationService` already recomputes permissions from PostgreSQL on any
cache error ("correctness over cache convenience").

That is now fixed (the connection is started without being awaited, and the
offline queue is disabled so cache commands fail fast rather than making a
user's request wait). Redis is genuinely optional, and a single-PC install for
a small business does not ship one to satisfy a cache that degrades cleanly.

If a deployment later wants the cache, point `REDIS_URL` at a Redis and the
API picks it up on restart.

## Why provisioning is not the seed

`npm run db:seed` creates "ANRAS", eight demo customers,
seventeen products and ten fabricated sales. That exists to make the product
demonstrable and it must never reach a paying customer — their first login
would show somebody else's invented business, and every row would then have to
be deleted by hand from a live system.

The installer runs `apps/api/prisma/provision.ts` instead, which creates only:

- the permission catalog and the 8 system roles (shared with the seed via
  `prisma/system-roles.ts`, so a real installation cannot drift from the
  demo one);
- the currencies pricing needs to function at all;
- one tenant and one company, named by the operator;
- one administrator account.

No customers, no products, no stock, no prices, no sales. It is idempotent, so
re-running it on an upgrade grants newly added permission codes to the roles
that should have them — and rotates the administrator's password, which is the
documented recovery path when it is lost.

## Building

Two steps, deliberately separate: the payload can be built and run on any
machine, while compiling the installer needs Inno Setup. A broken payload is
therefore caught by a script anyone can run rather than by a customer.

```powershell
# 1. Assemble the payload (add -Build to build the workspaces first)
./infrastructure/windows/build-payload.ps1 -Build -PostgresDir 'C:\pg\bin'

# 2. Compile the installer
iscc infrastructure/windows/erp-server.iss /DPayloadDir=dist/erp-server /DAppVersion=0.1.0
```

`-PostgresDir` is optional: omit it to build a Node-only payload for testing,
which is how the smoke test in CI runs.

CI can perform step 2 as well: `server-installer.yml` takes a
`compile_installer` boolean, **default `false`**, and when it is set the job
installs Inno Setup, compiles, and uploads the `.exe` as an artifact. It is
opt-in rather than automatic because the compile is slow and the payload is
what most changes need checking against.

The payload **does** carry PostgreSQL. The `Stage PostgreSQL` step downloads
the **exact** build named by `POSTGRES_VERSION` and passes its bin directory
as `-PostgresDir`. The step fails with the URL it tried rather than quietly
producing a payload with no database.

It deliberately does **not** use whatever PostgreSQL the runner happens to
carry, even when the major matches. That build is unpinned and
unverifiable, it changes when GitHub changes its image, and it would make
two builds of the same commit ship different database binaries.

**The download is checksummed.** `Stage PostgreSQL` computes the SHA-256 of
the archive and compares it against `POSTGRES_SHA256`:

- Digests match → the build continues.
- Digests differ → the build fails. Either the pin is stale or the download
  is not what it should be; neither is something to bundle.
- `POSTGRES_SHA256` is empty → the step prints the digest it computed and
  warns that nothing was verified. A **release** build
  (`compile_installer=true`) refuses to run at all in this state, so an
  unverified engine cannot reach an `.exe`.

**What the pin is and is not worth.** The pinned digest was taken from what
CI computed while downloading over HTTPS from the URL above. That is
**trust-on-first-use**: it detects the archive *changing* from here on — a
swapped build, a corrupted transfer, a tampered mirror — which is the half
of the problem that actually bites. It is **not** verification against a
checksum EnterpriseDB published, because none is published next to that
artifact. If the very first download had already been wrong, this pin would
faithfully preserve the wrong thing.

Still open, and worth doing before shipping to customers: cross-checking
against a vendor-signed digest, or building PostgreSQL from source.

What was staged is recorded in `pgsql/POSTGRES-SOURCE.txt` inside the
payload — version, digest, whether it was verified, and the source URL —
and repeated in the workflow's job summary. `install.ps1` prints it while
validating, so an installed machine and a support call start from the same
facts instead of a guess.

Staging runs on **every** payload build, not only when compiling a release.
The payload job exists to run on a clean runner and catch what a developer
machine hides — a download that 404s or a wrong major would otherwise be
discovered on release day. The build then verifies `initdb`, `pg_ctl`,
`postgres`, `pg_dump`, `pg_restore` and `psql` are present, and that `initdb
--version` reports the expected major: bundling a different one would ship an
engine no CI run exercised and put the backup agent's `pg_dump` on a different
major than the cluster it dumps.

**And then it actually runs the thing.** A `Smoke-test the bundled
PostgreSQL` step uses the payload's own binaries to `initdb` a cluster, start
it with `pg_ctl`, connect with `psql` and run a query, take a `pg_dump`, and
stop it again. Until that step existed the only evidence the bundled engine
worked was `initdb --version`, which proves the binary loads its DLLs and
nothing more — it says nothing about whether a cluster can be *created*,
which is exactly what the payload pruning puts at risk (`share/` holds the
templates `initdb` reads, `lib/` the libraries the server loads).

It is not a substitute for installing on a clean Windows VM: no service
account, no Service Control Manager, no ACLs, no upgrade or uninstall. It
moves one specific question — can this engine run at all — from untested to
tested on every payload build.

**`install.ps1` validates the payload before it writes anything.** The first
thing it does — before creating directories, generating secrets or touching
ACLs — is check that `initdb`, `pg_ctl`, `postgres`, `pg_dump` and
`pg_restore` are all present, run `initdb --version` and confirm the major,
and print the recorded provenance. An installer that cannot work says so
while the machine is still untouched.

That ordering is the fix for a real defect: the check used to run *after*
secrets had been generated and the install directory had been locked down,
so a payload built without `-PostgresDir` left a half-installed machine —
directories, a secrets file and restrictive ACLs for a database that was
never going to start.

WinSW (MIT) is downloaded at build time against a pinned SHA-256 and staged
with its licence; nothing is fetched at install time. `-WinSWPath` builds from
a local copy when the build machine is offline. See
[infrastructure/windows/README.md](../infrastructure/windows/README.md) for
which WinSW build is used and why.

Two things worth knowing about the payload build:

- **Gestión and Facturación ship as Next.js standalone output.** This is the
  `output: 'standalone'` mode, *not* the static export that
  `desktop-lan-architecture.md` rules out — that document's objection is that
  the apps have dynamic routes with no `generateStaticParams`, which is still
  true and which standalone does not care about. Standalone keeps the Node
  server and every dynamic route. Next omits `.next/static` and `public/` from
  standalone output (it assumes a CDN), so the build script copies them in; a
  payload without them serves pages with no CSS or JS.
- **Trees are copied with `robocopy`, not `Copy-Item`.** Deep `node_modules`
  paths exceed Windows' 260-character `MAX_PATH`, and `Copy-Item` fails on them
  with a "cannot find part of the path" error naming a file that plainly
  exists.
- **The bundled PostgreSQL is pruned.** The official Windows distribution
  carries headers, docs, debug symbols and GUI tooling; a supervised
  server-only cluster needs none of it. `doc`, `include`, `symbols`,
  `pgAdmin 4` and `StackBuilder` are removed **from the payload's own copy**
  — never from the source, which on a developer machine may be a real
  PostgreSQL install. `bin`, `lib` and `share` stay: `initdb` reads its
  templates from `share` and the executables load their DLLs from `lib`. The
  build logs the size before and after.
- **Junctions are excluded (`/XJ`) and the workspace packages materialised.**
  npm puts a junction in `node_modules` for every workspace package; two of
  them point at `apps/*`, whose `.next/` trees carry their own nested
  `node_modules`. Following them copies the entire frontend builds into
  `server/node_modules` and fails on a CI runner. `@erp/shared` and
  `@erp/config` — the only two the built server imports — are copied into
  `server/node_modules/@erp/` as real directories after the prune, so the
  payload ships no reparse points.

### Sizes: three different things, routinely confused

They are not variants of one number, and none of them is "the size of the
installer" on its own:

| What | Size | Where it comes from |
|---|---|---|
| Payload, Node-only (historic) | **503 MB**, 25,451 files | The payload build that was measured, before PostgreSQL was bundled at all |
| Bundled PostgreSQL, before pruning | **822 MB** | Its own directory inside the payload, as staged |
| Bundled PostgreSQL, after pruning | **120 MB** | The same directory once `doc`/`include`/`symbols`/pgAdmin/StackBuilder are gone |
| Payload, current (with PostgreSQL) | **679 MB** | What the payload build produces today |
| Compiled `.exe`, Node-only (historic) | **89.3 MB** | `ERPServerSetup-0.1.0.exe`, the first installer that ever existed as a file |
| Uploaded artifact of run #14 | **116 MB compressed** | The GitHub Actions artifact `erp-server-installer` |

Two traps worth naming, because both have already been walked into:

- **679 MB is a payload, 116 MB is a compressed artifact, 89.3 MB is an
  `.exe`.** Comparing any two of them says nothing. In particular the
  116 MB artifact is *not* smaller than the 89.3 MB `.exe` in any
  meaningful sense — one is zipped, the other is not — and no difference
  between them should be claimed.
- **The 120 MB figure is the pruned PostgreSQL directory, not the payload
  and not the installer.**

Earlier revisions of this document also carried a "513 MB" payload and a
"1,381 MB" untrimmed total. Both are gone: 513 contradicts the 503 MB that
was actually measured alongside a file count, and 1,381 is consistent with
neither (503 + 822 = 1,325). Nobody re-measured either, so neither is
stated.

## Configuration and secrets

`scripts/install.ps1` generates the database password and the JWT signing
secret on first run, stores them in `config\erp-secrets.json`, and **reuses
them on re-run** — regenerating the JWT secret would silently invalidate every
active session, and regenerating the database password would lock the API out
of its own data.

Before writing any secret, the script restricts the install directory's ACL to
`SYSTEM` and `Administrators` and stops inheritance. This matters more than
usual here: on a shop PC everyone tends to log in as the same local user, and
the rendered service definitions contain the database password and the signing
key.

`NEXT_PUBLIC_API_URL` is deliberately **not** set for the frontend services. It
is baked into the browser bundle at build time, so a fixed value would pin
every LAN client to one host. Unset, the frontend derives the API's URL from
whichever host the page was loaded from
(`packages/shared/src/runtime-url.ts`), so the same installed build works via
`localhost` on the server and via the LAN IP from every till.

The installer never puts the administrator password on a command line — it
writes the answers to a parameter file that `install.ps1` splats and then
deletes. Command lines are readable by any process on the machine.

## Re-running and repair

`install.ps1` is idempotent and does not prompt; the installer collects the
answers and passes them in. An interrupted install — a reboot, a cancelled UAC
prompt, an antivirus block — is fixed by running it again as Administrator, not
by uninstalling. Every step checks for its own prior result: an initialised
data directory, an existing database, an already-registered service.

## Uninstall

`scripts/uninstall.ps1` stops and removes the five services, in reverse
dependency order so Windows never refuses to stop one another still depends on.

It removes **services only**. The PostgreSQL data directory and the backups
survive an uninstall, and the script says so on the way out. Uninstalling an
application must never be the action that destroys a business's accounting
data; deleting those folders has to be a decision someone makes deliberately.

## What is actually verified

The payload was built and then actually run, end to end, against a real
PostgreSQL 16 and a real provisioned database:

- **The installer compiles.** PR #25 fixed the last thing in the way — Inno
  Setup resolves a relative `Source:` against the `.iss` file's own directory
  rather than the working directory, so a repo-root-relative payload path
  silently became `infrastructure/windows/dist/...` and the compile aborted
  with "No files found matching". The path is now passed absolute, and the
  workflow run produced **`ERPServerSetup-0.1.0.exe`, 89.3 MB**, uploaded as an
  artifact. That was the first time the installer existed as a file, and it
  carried no PostgreSQL — it predates the `Stage PostgreSQL` step.
- **A compiled `.exe` that contains PostgreSQL now exists.** Run **#14** of
  `ERP Server installer` (dispatched on `main` at `728f2ee` with
  `compile_installer=true`, 2026-09-14 08:22–08:30 UTC) succeeded and uploaded
  the **`erp-server-installer`** artifact, **116 MB compressed**, downloadable
  from the repository's Actions tab until 2026-12-13. That is the first
  installer built with a database inside it. It says nothing about whether it
  installs — see the pending list below; the `.exe` has still never been run.
- **The payload builds.** 503 MB Node-only, 25,451 files after pruning dev
  dependencies — 679 MB today, with PostgreSQL bundled (see "Sizes" above)
  (from 74,000+ before). All expected entry points, both Next standalone trees
  with their static assets, and no rendered service definitions (so no secrets)
  inside it.
- **The packaged API boots in production mode**, connects to PostgreSQL, and
  serves — including the new `GET /system/backups/status` route. With no Redis
  running it reports `{"status":"degraded","services":{"database":"ok","redis":"error"}}`
  instead of hanging, which is the whole point of the Redis fix above.
- **Provisioning produces a real, empty installation**: 1 company
  ("Ferretería El Tornillo"), 1 administrator, 8 system roles, 88 permissions,
  2 currencies, and 0 customers / 0 products / 0 sales. Idempotent across
  repeated runs. (88 was the catalogue's size on the day of that run —
  provisioning seeds whatever `PERMISSION_CATALOG` holds, which is 91 today.
  The installer has not been re-run since.)
- **The provisioned administrator can log in** to the packaged API and holds
  all 88 permissions of that run, including `system.backups.read`.
- **The packaged agent takes a verified backup** of that database, and the
  packaged API then reports it: schedule `03:00, 15:00`, retention 30 days,
  next run computed correctly, 2 archives on disk.
- **The packaged Gestión serves the real UI** — HTML plus its `.next/static`
  CSS and JS — and resolves the API from the page's own host at runtime, with
  no rebuild and no `NEXT_PUBLIC_API_URL`. Logging in and opening
  `/administracion/backups` shows the live backup state with no console errors.
- Full API e2e suite passes (250/251; the one failure is
  `Health › returns a healthy response`, which requires a live Redis).
- **All five service definitions are accepted by the real WinSW 2.12.0
  binary.** Each template is rendered with dummy values (including an `&` in
  the password, to exercise XML escaping) and parsed via `WinSW status`. CI now
  runs exactly this check on every change.
- **The per-service hard links work** and the linked binary is executable —
  WinSW confirms it looks for `erp-<id>.xml` by its own executable name, which
  is the assumption the whole `services/` layout rests on.

Four real bugs were found by running this rather than by reading it, and are
fixed:

1. `npm prune` inside the build script used `2>&1`. In Windows PowerShell 5.1
   that wraps a native command's stderr in ErrorRecords, so npm's routine
   warnings became a terminating `NativeCommandError` and failed the build.
2. `install.ps1` invoked `appspi\dist\prisma\provision.js`, which does not
   exist — `tsconfig.build.json` excludes `prisma/` from the API build.
   `provision.ts` is now bundled into the payload next to `schema.prisma`.
3. `Copy-Item` cannot copy `node_modules`: deep paths exceed Windows'
   260-character `MAX_PATH`. Replaced with `robocopy`.
4. `erp-api.xml.template`'s own comment contained the literal string
   `{{PLACEHOLDER}}`, which `install.ps1`'s unreplaced-placeholder guard
   matched — **every installation would have aborted** while rendering the
   service definitions. The comment no longer spells it out, and the CI check
   above would now catch a recurrence.

### Resolved: which PostgreSQL ends up in the payload, and whether it is intact

Both halves of this used to be open, and both are closed above; the entry is
kept because it names what to re-check if `Stage PostgreSQL` is ever
rewritten. The step used to prefer whatever PostgreSQL the runner carried and
fall back to a download nothing verified, so the exact build that shipped was
decided by GitHub's image that week, two runs of the same commit could bundle
different binaries, nothing checked a hash, and nothing recorded what went
in. It now downloads one pinned `POSTGRES_VERSION`, fails on a `POSTGRES_SHA256`
mismatch, refuses a release compile with no pin at all, and writes version,
digest and source URL into `pgsql/POSTGRES-SOURCE.txt`.

**What is still open** is narrower and stated above: the pin is
trust-on-first-use, not a vendor-published checksum, because EnterpriseDB
publishes none next to that artifact. Cross-checking against a vendor-signed
digest, or building PostgreSQL from source, is worth doing before shipping to
customers.

## The first real installation, and the three things it found

**2026-09-14.** The installer was run for the first time on a machine that was
not a developer's and not a CI runner: a clean Windows 10 Home 22H2 VM
(build 19045.3803, Spanish, stock PowerShell 5.1, no Node, no PostgreSQL, no
Visual C++ runtime). It failed, three times, for three unrelated reasons.

None of the three could have been caught by CI, and that is the point worth
keeping: every one of them is invisible on a GitHub runner because the runner
is not a customer's machine.

### 1. PostgreSQL could not start: no Visual C++ runtime

`initdb.exe` exited with **0xC0000135 (STATUS_DLL_NOT_FOUND)** printing
nothing at all. PostgreSQL's Windows binaries link against the MSVC runtime —
`vcruntime140.dll`, `vcruntime140_1.dll`, `msvcp140.dll` — and **Windows does
not ship it**. The payload did not carry it and the installer did not install
it, so the bundled database could not run on any clean machine.

CI missed it because GitHub's runners already have the redistributable: the
smoke test added in PR #39 initialises a cluster, serves a query and takes a
`pg_dump` there, with the same binaries that cannot load here.

Fixed by staging the official `vc_redist.x64.exe` into the payload and running
it (`/install /quiet /norestart`) before any PostgreSQL binary is executed.
`build-payload.ps1` now **refuses** to bundle PostgreSQL without it, because
the combination that shipped before is a payload that builds, passes every
check, and installs nowhere. The redistributable is run rather than copying
the DLLs next to the executables so the runtime keeps being serviced by
Windows Update.

The error message was also wrong in a way that mattered: it reported "the
bundled initdb could not run" and showed an empty string, because a process
that dies in the loader prints nothing. It now names the missing runtime and
says where the installer expected to find it.

### 2. The ACL step failed on a Spanish Windows

`AddAccessRule` threw **IdentityNotMappedException**. The identities were
written as names — the ENGLISH names of those accounts. On a Spanish Windows
the same accounts are `SISTEMA` and `Administradores`, and the lookup fails.

This is not an edge case for this product: every customer runs a localised
Windows, so the installer would have failed on all of them, while passing on
an English developer machine and an English CI runner.

Fixed by using well-known SIDs (`S-1-5-18`, `S-1-5-32-544`) through
`WellKnownSidType`, which are identical in every language.

### 3. The ACL hardening locked PostgreSQL out of its own binaries

With the tree restricted to SYSTEM and Administrators, `initdb` failed with
0xC0000135 again — after the runtime was installed and after `initdb
--version` worked.

The cause is a deliberate PostgreSQL behaviour: it **refuses to run with
administrative privileges**, and calls `CreateRestrictedToken` to drop the
Administrators SID from its own token before doing real work. The restricted
process then had no access to the directory holding its DLLs, and died inside
the loader — silently, before `main()`, which is why neither stdout nor
stderr carried a single byte.

Fixed by granting the built-in Users group read+execute on the install tree
and breaking inheritance on the directories that actually hold something worth
protecting — `config` (the secrets), `services` (the rendered definitions,
which contain the database password and the signing key) and `backups` (the
dumps). What must not be readable is the password, not `initdb.exe`.

`data` is deliberately left out of that list: the cluster is written by
PostgreSQL under the same restricted token, so restricting it reintroduces
the failure. Granting the account the service actually runs as is follow-up
work.

### What this says about the CI smoke test

The smoke test from PR #39 is still worth having — it proves the binaries are
complete and a cluster can be created. But it cannot prove the installer
works, and this section is the evidence: three consecutive blocking defects
on the first real machine, with CI green throughout. Treat "the payload
builds and the smoke test passes" as saying nothing about whether a customer
can install.

### Two more things the same run established, without executing anything

- **The ports are fixed and the wizard does not expose them.** It asks for
  company name, tax id, administrator credentials and the backup schedule,
  and nothing else; 5433/3001/3000/3002 are hard-coded. A machine that
  already has PostgreSQL on 5433 — likely, for a customer migrating off
  another system — cannot be resolved from the interface at all.
- **There is no unattended install.** The values come only from the wizard
  pages, so `/VERYSILENT` produces empty mandatory parameters. Every store is
  a manual installation.

Neither is fixed here; both are recorded so they are decided rather than
rediscovered.

**Not verified, and needing a clean Windows VM:**

- **Running the installer.** Compiling it is verified (above); no
  `ERPServerSetup-*.exe` has ever been executed on any machine, clean or
  otherwise.
- **The bundled PostgreSQL actually working.** The payload stages it and CI
  verifies `initdb`, `pg_ctl`, `postgres`, `pg_dump` and `pg_restore` are
  present and that `initdb --version` reports major `16`, and run #14 put all
  of that inside an `.exe`. What none of it shows is that `initdb` can create
  a cluster: a version banner proves the binary loads its DLLs and nothing
  more. The pruning above is what makes this worth stating — the first real
  installation is the test that something needed was not trimmed.
- **Code signing.** The artifact is unsigned, so Windows SmartScreen will
  flag it on a customer machine.
- `initdb` and the bundled PostgreSQL running under a Windows service account.
- WinSW service *registration* and start order. The configurations parse and
  the executables run; what is untested is `install`/`start` against the real
  Service Control Manager, and the failure/restart behaviour. Note the
  PostgreSQL service runs `postgres.exe` directly, not `pg_ctl runservice` —
  the latter registers itself with the Service Control Manager and collides
  with WinSW doing the same.
- The ACL hardening against a real non-administrator user.
- Upgrade over an existing installation, and the uninstall path.

Do these on a VM before the first customer install. The most likely place to
find the next problem is `initdb` under a service account (locale and
directory permissions).
