<#
.SYNOPSIS
  Assembles the ERP Server payload: everything the installer will lay down on
  the customer's PC, as a plain directory tree that can be run and tested
  before it is ever wrapped in an .exe.

.DESCRIPTION
  Deliberately split from the Inno Setup compile step. The payload is the part
  that can be verified on any machine — build it, start the services from it,
  hit /health — while compiling the installer needs Inno Setup and testing the
  install itself needs a clean Windows box. Keeping them separate means a
  broken payload is caught by a script anyone can run, not by a customer.

  Layout produced under -OutputDir (default: dist/erp-server):

    node/                     Node runtime (copied from the build machine)
    server/                   API + maintenance agent + their production deps
    gestion/                  Next.js standalone server
    facturacion/              Next.js standalone server
    pgsql/                    PostgreSQL binaries (staged by -PostgresDir)
    services/                 WinSW service definitions
    scripts/                  First-run and maintenance scripts
    VERSION                   Version stamp the installer and upgrades read

  Gestión and Facturación ship as Next.js standalone trees, which carry their
  own traced node_modules and are therefore fully self-contained. The API and
  the agent share one production-pruned dependency tree under server/.

.NOTES
  Run from the repository root, after `npm ci`. This script does NOT run the
  build itself unless -Build is passed, so a CI job can build once and package
  several times.
#>

[CmdletBinding()]
param(
  [string]$OutputDir = "dist/erp-server",
  [string]$NodeExe = (Get-Command node).Source,
  # Directory holding pg_ctl.exe/initdb.exe/pg_dump.exe, e.g. a PostgreSQL
  # binary zip extracted to a staging folder. Optional: omit it to build a
  # payload for testing the Node side without the ~200 MB database.
  [string]$PostgresDir,
  # Path to an already-downloaded WinSW executable. Omit it and the script
  # fetches the pinned release below. Use it on a build machine with no
  # internet, or to substitute the much smaller WinSW.NET461.exe (see the
  # note on the constants below).
  [string]$WinSWPath,
  [switch]$Build
)

# WinSW (MIT) supervises the five Windows services — see docs/server-installer.md.
#
# WinSW-x64.exe is the SELF-CONTAINED .NET build: 18 MB, and it depends on no
# runtime being installed on the customer's PC. That is the same principle
# behind bundling PostgreSQL and node.exe, and it is worth the size — a machine
# with a broken or absent .NET Framework is exactly what makes an on-site
# install fail at 6pm on a Friday. WinSW.NET461.exe is 656 KB but needs .NET
# Framework 4.6.1+; pass it via -WinSWPath if you want that trade instead.
#
# The hash is pinned because this binary runs as SYSTEM on a customer's
# machine. A build must never ship whatever happened to be at that URL today.
$WINSW_VERSION = 'v2.12.0'
$WINSW_URL     = "https://github.com/winsw/winsw/releases/download/$WINSW_VERSION/WinSW-x64.exe"
$WINSW_SHA256  = '05b82d46ad331cc16bdc00de5c6332c1ef818df8ceefcd49c726553209b3a0da'
$WINSW_LICENSE_URL = "https://raw.githubusercontent.com/winsw/winsw/$WINSW_VERSION/LICENSE.txt"

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Step($message) {
  Write-Host "==> $message" -ForegroundColor Cyan
}

<#
  Copies a directory tree with robocopy rather than Copy-Item.

  Copy-Item fails on the deep paths inside node_modules: Windows' classic
  260-character MAX_PATH limit is hit well before the end of a nested
  dependency chain, and the failure surfaces as a confusing
  "cannot find part of the path" on a file that plainly exists. Robocopy
  handles long paths natively.

  Robocopy's exit codes are a bitmask where anything under 8 means success
  (1 = files copied, 2 = extra files, 4 = mismatched); only >= 8 is a real
  failure.

  /XJ excludes junction points, and it is not optional here. npm creates a
  junction in node_modules for every workspace package, and two of them
  (@erp/gestion, @erp/facturacion) point at apps/*, which contain .next/ with
  their own nested node_modules. Without /XJ robocopy follows those junctions
  and tries to copy the whole frontend build trees into server/node_modules —
  enormous, and on a CI runner an outright copy failure (exit 9). Shipping
  reparse points is wrong anyway: they encode absolute paths belonging to the
  machine that built the payload.
#>
function Copy-Tree([string]$Source, [string]$Destination) {
  # Captured rather than discarded: a bare exit code is not enough to diagnose
  # a copy failure that only reproduces on a build machine you cannot inspect.
  $output = robocopy $Source $Destination /E /XJ /NFL /NDL /NJH /NJS /NP /R:2 /W:1 2>&1
  if ($LASTEXITCODE -ge 8) {
    $tail = ($output | Select-Object -Last 25) -join [Environment]::NewLine
    throw "robocopy failed copying '$Source' to '$Destination' (exit $LASTEXITCODE):$([Environment]::NewLine)$tail"
  }
  # Robocopy sets a non-zero exit code on success; clear it so a later
  # `if ($LASTEXITCODE -ne 0)` check does not misread it.
  $global:LASTEXITCODE = 0
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Push-Location $repoRoot
try {
  $version = (Get-Content (Join-Path $repoRoot 'package.json') | ConvertFrom-Json).version

  if ($Build) {
    Write-Step "Building workspaces"
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
    npm run build --workspace=apps/server-agent
    if ($LASTEXITCODE -ne 0) { throw "server-agent build failed" }
    npm run db:generate --workspace=apps/api
    if ($LASTEXITCODE -ne 0) { throw "prisma generate failed" }
  }

  # Fail early and clearly rather than producing a payload with a missing piece
  # that only shows up as a service that will not start on a customer's PC.
  $required = @(
    'apps/api/dist/main.js',
    'apps/api/src/generated/prisma',
    'apps/gestion/.next/standalone/apps/gestion/server.js',
    'apps/facturacion/.next/standalone/apps/facturacion/server.js',
    'apps/server-agent/dist/main.js'
  )
  foreach ($item in $required) {
    if (-not (Test-Path (Join-Path $repoRoot $item))) {
      throw "Missing build output: $item. Run with -Build, or run the builds first."
    }
  }

  # Accept either a repo-relative path (the default) or an absolute one, so a
  # CI job or a local smoke test can stage the payload outside the repository.
  $payload = if ([System.IO.Path]::IsPathRooted($OutputDir)) {
    $OutputDir
  } else {
    Join-Path $repoRoot $OutputDir
  }
  if (Test-Path $payload) {
    Write-Step "Clearing $OutputDir"
    Remove-Item $payload -Recurse -Force
  }
  New-Item -ItemType Directory -Path $payload -Force | Out-Null

  # ---- Node runtime -------------------------------------------------------
  # A single node.exe, not an installed Node: the customer's PC must never need
  # Node installed, and an ERP upgrade must never be able to break — or be
  # broken by — some other application's Node version.
  Write-Step "Staging Node runtime"
  $nodeDir = Join-Path $payload 'node'
  New-Item -ItemType Directory -Path $nodeDir -Force | Out-Null
  Copy-Item $NodeExe (Join-Path $nodeDir 'node.exe')

  # ---- WinSW --------------------------------------------------------------
  # Fetched at BUILD time, never at install time: the customer's PC may have no
  # internet, and an installer that needs one is not a local-first product.
  #
  # Staged early, before the expensive node_modules copy, so a failed download
  # or a checksum mismatch costs seconds instead of a quarter of an hour.
  Write-Step "Staging WinSW ($WINSW_VERSION)"
  $winswDir = Join-Path $payload 'winsw'
  New-Item -ItemType Directory -Path $winswDir -Force | Out-Null
  $winswExe = Join-Path $winswDir 'WinSW.exe'

  if ($WinSWPath) {
    if (-not (Test-Path $WinSWPath)) { throw "-WinSWPath not found: $WinSWPath" }
    Copy-Item $WinSWPath $winswExe -Force
    Write-Warning "Using -WinSWPath; the pinned hash is NOT enforced for a locally supplied binary."
  } else {
    Invoke-WebRequest -Uri $WINSW_URL -OutFile $winswExe -UseBasicParsing
    $actual = (Get-FileHash $winswExe -Algorithm SHA256).Hash.ToLower()
    if ($actual -ne $WINSW_SHA256) {
      Remove-Item $winswExe -Force
      throw "WinSW checksum mismatch. Expected $WINSW_SHA256, got $actual. Refusing to ship an unverified binary."
    }
    # MIT requires the licence and copyright notice travel with the binary.
    Invoke-WebRequest -Uri $WINSW_LICENSE_URL `
      -OutFile (Join-Path $winswDir 'LICENSE.txt') -UseBasicParsing
  }

  # ---- API + agent --------------------------------------------------------
  Write-Step "Staging API and maintenance agent"
  $serverDir = Join-Path $payload 'server'
  New-Item -ItemType Directory -Path $serverDir -Force | Out-Null

  Copy-Item (Join-Path $repoRoot 'package.json') $serverDir
  Copy-Item (Join-Path $repoRoot 'package-lock.json') $serverDir

  foreach ($pair in @(
      @{ From = 'apps/api/dist';               To = 'apps/api/dist' },
      @{ From = 'apps/api/prisma';             To = 'apps/api/prisma' },
      @{ From = 'apps/api/package.json';       To = 'apps/api/package.json' },
      @{ From = 'apps/server-agent/dist';      To = 'apps/server-agent/dist' },
      @{ From = 'apps/server-agent/package.json'; To = 'apps/server-agent/package.json' }
    )) {
    $source = Join-Path $repoRoot $pair.From
    $target = Join-Path $serverDir $pair.To
    New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
    if (Test-Path $source -PathType Container) {
      Copy-Tree $source $target
    } else {
      Copy-Item $source $target -Force
    }
  }

  # Only the two workspace packages the built server actually imports —
  # verified against the `@erp/*` specifiers in apps/api/dist and
  # apps/server-agent/dist. auth-client is frontend-only and already travels
  # inside each Next standalone tree.
  #
  # Staged under packages/ so the root package.json's `workspaces` globs still
  # resolve when `npm prune` runs below. The copies Node actually resolves at
  # runtime are placed into node_modules/@erp/ afterwards.
  foreach ($package in @('shared', 'config')) {
    $source = Join-Path $repoRoot "packages/$package"
    $target = Join-Path $serverDir "packages/$package"
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    Copy-Tree (Join-Path $source 'dist') (Join-Path $target 'dist')
    Copy-Item (Join-Path $source 'package.json') $target -Force
  }

  # ---- Provisioning script ------------------------------------------------
  # `nest build` excludes prisma/ (apps/api/tsconfig.build.json), so
  # provision.ts has no compiled counterpart in apps/api/dist and cannot simply
  # be copied. Bundle it here instead, emitted NEXT TO schema.prisma so its
  # `require("../src/generated/prisma/client")` resolves against the payload's
  # own copy of the generated client. The Prisma client, its adapter and argon2
  # stay external: the first two carry runtime/wasm assets a bundler would
  # break, and argon2 is a native module.
  Write-Step "Bundling the provisioning script"
  npx esbuild (Join-Path $repoRoot 'apps/api/prisma/provision.ts') `
    --bundle --platform=node --format=cjs --target=node22 `
    --outfile="$(Join-Path $serverDir 'apps/api/prisma/provision.js')" `
    --external:argon2 --external:@prisma/adapter-pg --external:@prisma/client `
    --external:../src/generated/prisma/client
  if ($LASTEXITCODE -ne 0) { throw 'Bundling provision.ts failed' }

  # Bridge for that external import.
  #
  # provision.ts imports the Prisma client as '../src/generated/prisma/client'.
  # In the repository that path holds TypeScript, which tsx compiles on the fly.
  # The payload ships only compiled output, so the specifier — which esbuild
  # leaves verbatim in provision.js — would resolve to nothing. This one-line
  # module points it at the client `nest build` already compiled into dist/,
  # which is also the copy the API itself loads. Shipping the generated
  # TypeScript instead would be several megabytes that no runtime ever reads.
  $shimDir = Join-Path $serverDir 'apps/api/src/generated/prisma'
  New-Item -ItemType Directory -Path $shimDir -Force | Out-Null
  @(
    '// Generated by infrastructure/windows/build-payload.ps1 — do not edit.',
    '//',
    "// Resolves the bundled provisioning script's external Prisma client import",
    '// against the compiled client under dist/. See the build script for why.',
    "module.exports = require('../../../dist/generated/prisma/client');"
  ) | Set-Content -Path (Join-Path $shimDir 'client.js') -Encoding utf8

  # Copy the installed tree and prune, rather than reinstalling: `npm prune`
  # removes devDependencies without rebuilding anything, so native modules
  # (argon2) keep the prebuilt binaries that already work on this machine.
  Write-Step "Copying and pruning node_modules (this takes a while)"
  Copy-Tree (Join-Path $repoRoot 'node_modules') (Join-Path $serverDir 'node_modules')
  Push-Location $serverDir
  try {
    # NO `2>&1` here. In Windows PowerShell 5.1 redirecting a native command's
    # stderr wraps every line in an ErrorRecord, so npm's routine warnings
    # become a terminating NativeCommandError under $ErrorActionPreference =
    # 'Stop' — which is exactly how this step failed the first time it ran.
    # Let stderr through and judge the result by the exit code.
    npm prune --omit=dev
    if ($LASTEXITCODE -ne 0) { throw "npm prune failed (exit $LASTEXITCODE)" }
  } finally {
    Pop-Location
  }

  # ---- Workspace packages -------------------------------------------------
  # Node resolves `@erp/shared` and `@erp/config` through node_modules, and the
  # copy above deliberately skipped the junctions npm had put there (see
  # Copy-Tree). So materialise them as real directories — after the prune, so
  # npm cannot decide they are dangling workspace links and remove them.
  #
  # The result is a payload with no reparse points at all, which is what makes
  # it safe to compress, copy between machines and lay down with an installer.
  # `npm prune` re-creates a junction under node_modules/@erp for EVERY
  # workspace it finds declared in the staged root package.json — including
  # @erp/api and @erp/server-agent, which nothing imports by that name. Sweep
  # them all, then put back the two the server actually resolves at runtime.
  #
  # Remove each LINK with rmdir, never `Remove-Item -Recurse`: on a junction the
  # latter deletes the TARGET's contents, which here would empty the staged
  # application it points at.
  Write-Step "Materialising @erp workspace packages"
  $erpModules = Join-Path $serverDir 'node_modules/@erp'
  if (Test-Path $erpModules) {
    foreach ($entry in Get-ChildItem $erpModules -Force) {
      if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        cmd /c rmdir "$($entry.FullName)" | Out-Null
      } else {
        Remove-Item $entry.FullName -Recurse -Force
      }
    }
  }

  foreach ($package in @('shared', 'config')) {
    $target = Join-Path $serverDir "node_modules/@erp/$package"
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    # Sourced from the repository, not from the staged copy: if a junction ever
    # survives the removal above, copying staged-onto-staged would be a file
    # copied onto itself.
    Copy-Tree (Join-Path $repoRoot "packages/$package/dist") (Join-Path $target 'dist')
    Copy-Item (Join-Path $repoRoot "packages/$package/package.json") $target -Force
  }

  # ---- Frontends ----------------------------------------------------------
  # Next's standalone output deliberately omits .next/static and public/ — they
  # are meant to be served by a CDN in a cloud deployment. Here the Node server
  # serves them itself, so they must be copied in or every page loads without
  # CSS or JS.
  foreach ($app in @('gestion', 'facturacion')) {
    Write-Step "Staging $app"
    $standalone = Join-Path $repoRoot "apps/$app/.next/standalone"
    $target = Join-Path $payload $app
    Copy-Tree $standalone $target

    Copy-Tree (Join-Path $repoRoot "apps/$app/.next/static") `
      (Join-Path $target "apps/$app/.next/static")

    $public = Join-Path $repoRoot "apps/$app/public"
    if (Test-Path $public) {
      Copy-Tree $public (Join-Path $target "apps/$app/public")
    }
  }

  # ---- PostgreSQL ---------------------------------------------------------
  if ($PostgresDir) {
    Write-Step "Staging PostgreSQL from $PostgresDir"
    if (-not (Test-Path (Join-Path $PostgresDir 'initdb.exe'))) {
      throw "-PostgresDir must point at a PostgreSQL bin directory containing initdb.exe"
    }
    Copy-Tree (Split-Path $PostgresDir -Parent) (Join-Path $payload 'pgsql')
  } else {
    Write-Warning "No -PostgresDir given: the payload will not contain PostgreSQL. Node services can still be tested."
  }

  # ---- Service definitions and scripts ------------------------------------
  Write-Step "Staging service definitions and scripts"
  Copy-Tree (Join-Path $PSScriptRoot 'services') (Join-Path $payload 'services')
  Copy-Tree (Join-Path $PSScriptRoot 'scripts') (Join-Path $payload 'scripts')

  # A payload with reparse points cannot be trusted: they encode absolute paths
  # belonging to the build machine, and an installer laying them down would
  # either follow them somewhere meaningless or fail outright. Cheap to check,
  # so check it over the finished tree.
  $reparse = Get-ChildItem $payload -Recurse -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue
  if ($reparse) {
    throw "Payload contains $($reparse.Count) reparse point(s), starting with '$($reparse[0].FullName)'."
  }

  Set-Content -Path (Join-Path $payload 'VERSION') -Value $version -Encoding utf8

  Write-Step "Payload ready: $payload (version $version)"
  $size = (Get-ChildItem $payload -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1MB
  Write-Host ("    total size: {0:N0} MB" -f $size)
}
finally {
  Pop-Location
}
