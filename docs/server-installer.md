# ERP Server installer (Windows)

**Status: IMPLEMENTED, NOT YET VALIDATED ON A CLEAN MACHINE.** The payload
build and the provisioning path are verified (see "What is actually verified"
at the end); compiling the `.exe` and running a real install need Inno Setup
and a clean Windows box, neither of which the implementing session had. Treat
the first install on a test VM as part of the work, not as a formality.

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

`npm run db:seed` creates "Distribuidora Horizonte", eight demo customers,
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

- **The payload builds.** 503 MB, 25,451 files after pruning dev dependencies
  (from 74,000+ before). All expected entry points, both Next standalone trees
  with their static assets, and no rendered service definitions (so no secrets)
  inside it.
- **The packaged API boots in production mode**, connects to PostgreSQL, and
  serves — including the new `GET /system/backups/status` route. With no Redis
  running it reports `{"status":"degraded","services":{"database":"ok","redis":"error"}}`
  instead of hanging, which is the whole point of the Redis fix above.
- **Provisioning produces a real, empty installation**: 1 company
  ("Ferretería El Tornillo"), 1 administrator, 8 system roles, 78 permissions,
  2 currencies, and 0 customers / 0 products / 0 sales. Idempotent across
  repeated runs.
- **The provisioned administrator can log in** to the packaged API and holds
  all 78 permissions including `system.backups.read`.
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

**Not verified, and needing a clean Windows VM:**

- Compiling `erp-server.iss` (no Inno Setup on the implementing machine).
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
