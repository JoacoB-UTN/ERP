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
  [switch]$Build
)

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
#>
function Copy-Tree([string]$Source, [string]$Destination) {
  robocopy $Source $Destination /E /NFL /NDL /NJH /NJS /NP /R:2 /W:1 | Out-Null
  if ($LASTEXITCODE -ge 8) {
    throw "robocopy failed copying '$Source' to '$Destination' (exit $LASTEXITCODE)"
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
      # The Prisma client is generated into the source tree, and the built
      # output imports it from there.
      @{ From = 'apps/api/src/generated';      To = 'apps/api/src/generated' },
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

  foreach ($package in @('shared', 'config', 'auth-client')) {
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

  Set-Content -Path (Join-Path $payload 'VERSION') -Value $version -Encoding utf8

  Write-Step "Payload ready: $payload (version $version)"
  $size = (Get-ChildItem $payload -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1MB
  Write-Host ("    total size: {0:N0} MB" -f $size)
}
finally {
  Pop-Location
}
