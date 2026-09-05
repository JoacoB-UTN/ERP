# ERP Server installer (Windows)

**Read [docs/server-installer.md](../../docs/server-installer.md) first.** It
explains the deployment shape, the design decisions, and — importantly — what
has and has not been validated yet.

This folder holds the mechanics:

| Path | What it is |
| --- | --- |
| `build-payload.ps1` | Assembles everything the installer lays down, as a runnable directory tree |
| `erp-server.iss` | Inno Setup script; collects the operator's answers and calls `install.ps1` |
| `services/*.xml.template` | WinSW service definitions, rendered at install time |
| `scripts/install.ps1` | First-run setup: PostgreSQL cluster, services, migrations, provisioning |
| `scripts/uninstall.ps1` | Stops and removes the services (never the data) |

## The two-step build

```powershell
./build-payload.ps1 -Build -PostgresDir 'C:\pgsql\bin'
iscc erp-server.iss /DPayloadDir=../../dist/erp-server /DAppVersion=0.1.0
```

The split is deliberate. The payload runs anywhere and is checked by CI on
every change to this folder; compiling the `.exe` needs Inno Setup and only
matters at release time. A broken payload should be caught by a script, not by
a customer.

## WinSW

`build-payload.ps1` downloads WinSW (MIT) at BUILD time and stages it at
`winsw\WinSW.exe` with its licence, verifying a pinned SHA-256 — the binary
runs as SYSTEM on a customer's machine, so a build must never ship whatever
happened to be at that URL today. Nothing is fetched at INSTALL time: a
customer's PC may have no internet, and an installer that needs one is not a
local-first product. Pass `-WinSWPath` to build offline from a local copy.

The default is `WinSW-x64.exe`, the self-contained .NET build (18 MB, no
runtime dependency) — the same reasoning that bundles PostgreSQL and node.exe.
`WinSW.NET461.exe` is 656 KB but requires .NET Framework 4.6.1+; supply it via
`-WinSWPath` if you prefer that trade.

`install.ps1` gives each service its own `erp-<id>.exe` beside its
`erp-<id>.xml`, because WinSW v2 locates its configuration by its own
executable name. Those are hard links, not copies — five copies of an 18 MB
binary would cost 91 MB of the customer's disk for five identical files.

## Things that will bite you

- **`MAX_PATH`.** Copy trees with `robocopy`, never `Copy-Item`. Deep
  `node_modules` paths exceed Windows' 260-character limit and `Copy-Item`
  reports it as a missing file that plainly exists.
- **npm workspace junctions.** `node_modules/@erp/*` are junctions, and
  `@erp/gestion` / `@erp/facturacion` point at `apps/*`, which hold `.next/`
  with their own nested `node_modules`. Robocopy follows them unless you pass
  `/XJ`, which means copying the entire frontend build trees into
  `server/node_modules` — and on a CI runner that fails outright (exit 9). The
  packages the server runtime actually needs (`@erp/shared`, `@erp/config`) are
  materialised into `server/node_modules/@erp/` as real directories after the
  prune. A payload should contain no reparse points: they encode absolute paths
  from the machine that built it.
- **Next standalone output omits `.next/static` and `public/`.** The build
  script copies them in. Forget that and every page renders unstyled.
- **`Start-Service` returns before PostgreSQL accepts connections.**
  `install.ps1` polls `pg_isready` rather than assuming readiness.
- **Secrets end up in the rendered service XML.** `install.ps1` restricts the
  install directory's ACL before writing them, and CI asserts no rendered
  `.xml` ever ships inside the payload.
