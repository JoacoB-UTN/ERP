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

The service definitions expect `WinSW.exe` at `winsw\WinSW.exe` inside the
install directory; `install.ps1` copies it once per service, renamed to match
each service's XML (that renaming is how WinSW finds its own configuration).

WinSW is not vendored in this repository — download the release binary and
place it in the payload before compiling the installer. It is deliberately not
fetched at install time: a customer's PC may have no internet, and an installer
that needs one is not a local-first product.

## Things that will bite you

- **`MAX_PATH`.** Copy trees with `robocopy`, never `Copy-Item`. Deep
  `node_modules` paths exceed Windows' 260-character limit and `Copy-Item`
  reports it as a missing file that plainly exists.
- **Next standalone output omits `.next/static` and `public/`.** The build
  script copies them in. Forget that and every page renders unstyled.
- **`Start-Service` returns before PostgreSQL accepts connections.**
  `install.ps1` polls `pg_isready` rather than assuming readiness.
- **Secrets end up in the rendered service XML.** `install.ps1` restricts the
  install directory's ACL before writing them, and CI asserts no rendered
  `.xml` ever ships inside the payload.
