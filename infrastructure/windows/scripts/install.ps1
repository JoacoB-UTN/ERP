<#
.SYNOPSIS
  First-run setup for an installed ERP Server: initialises PostgreSQL, renders
  the service definitions, provisions the database and registers the Windows
  services.

.DESCRIPTION
  Run by the Inno Setup installer after the files are laid down, and re-runnable
  by hand for support. Every step is idempotent — an interrupted install
  (a reboot, a UAC cancel, an antivirus block) is fixed by running it again, not
  by uninstalling and starting over.

  The script does NOT prompt. The installer collects the operator's answers and
  passes them in as parameters, so the same script serves an attended install,
  an unattended one, and a support session.

.NOTES
  Must run elevated: registering services and setting ACLs require it.
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$InstallDir,
  [Parameter(Mandatory)][string]$CompanyName,
  [Parameter(Mandatory)][string]$CompanyTaxId,
  [Parameter(Mandatory)][string]$AdminEmail,
  [Parameter(Mandatory)][string]$AdminPassword,

  [int]$PgPort = 5433,
  [int]$ApiPort = 3001,
  [int]$GestionPort = 3000,
  [int]$FacturacionPort = 3002,

  [string]$BackupTimes = '03:00',
  [int]$BackupRetentionDays = 30,
  [int]$BackupKeepMinimum = 7,

  # Offsite copy — off unless the operator supplies a bucket. See docs/backups.md.
  [switch]$CloudBackup,
  [string]$CloudEndpoint,
  [string]$CloudRegion = 'us-east-1',
  [string]$CloudBucket,
  [string]$CloudAccessKeyId,
  [string]$CloudSecretAccessKey
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Step($message) { Write-Host "==> $message" -ForegroundColor Cyan }

if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'This script must be run as Administrator.'
}

$pgBin      = Join-Path $InstallDir 'pgsql\bin'
$pgData     = Join-Path $InstallDir 'data'
$servicesDir= Join-Path $InstallDir 'services'
$serverDir  = Join-Path $InstallDir 'server'
$backupDir  = Join-Path $InstallDir 'backups'
$logsDir    = Join-Path $InstallDir 'logs'
$secretsFile= Join-Path $InstallDir 'config\erp-secrets.json'

# ---------------------------------------------------------------------------
# Payload validation -- FIRST, before anything is created on this machine
# ---------------------------------------------------------------------------
# Every check that can say "this installer cannot work here" runs before the
# installer writes a single thing. The previous order validated the PostgreSQL
# binaries only once secrets had been generated and the install directory had
# been ACL'd, so a payload built without -PostgresDir left a half-installed
# machine behind: directories, a secrets file and locked-down permissions for
# a database that was never going to start. Failing here leaves nothing to
# clean up.
Write-Step 'Validating payload'

$requiredBinaries = @{
  'initdb.exe'      = 'create the database cluster'
  'pg_ctl.exe'      = 'start and stop the database service'
  'postgres.exe'    = 'run the database'
  'pg_dump.exe'     = 'take backups'
  'pg_restore.exe'  = 'verify and restore backups'
}

$missingBinaries = @()
foreach ($name in $requiredBinaries.Keys) {
  if (-not (Test-Path (Join-Path $pgBin $name))) {
    $missingBinaries += "$name (needed to $($requiredBinaries[$name]))"
  }
}
if ($missingBinaries) {
  throw @"
This installer was built without PostgreSQL and cannot install.

Missing from $pgBin :
  $($missingBinaries -join "`n  ")

Nothing has been written to this machine. See docs/server-installer.md.
"@
}

# ---------------------------------------------------------------------------
# Visual C++ runtime -- BEFORE any PostgreSQL binary is executed
# ---------------------------------------------------------------------------
# PostgreSQL's Windows binaries link against the MSVC runtime
# (vcruntime140.dll, vcruntime140_1.dll, msvcp140.dll). A clean Windows
# install does NOT ship it. Without this step every PostgreSQL executable
# exits with 0xC0000135 -- STATUS_DLL_NOT_FOUND -- before printing anything,
# so the version check below would report an empty string and the operator
# would see "the bundled initdb could not run" with no cause.
#
# This is not hypothetical: it is what the first real installation on a clean
# Windows 10 machine hit. CI never caught it because GitHub's runners already
# have the redistributable, so the same binaries that fail on a customer's PC
# initialise a cluster perfectly on a runner.
#
# The official redistributable is run rather than copying the DLLs next to the
# executables: app-local copies are never serviced, so a security fix for the
# runtime would silently never reach an installed machine.
$vcRedist = Join-Path $InstallDir (Join-Path 'vcredist' 'vc_redist.x64.exe')
if (Test-Path $vcRedist) {
  Write-Step 'Installing the Visual C++ runtime (required by PostgreSQL)'
  $vc = Start-Process -FilePath $vcRedist -ArgumentList '/install', '/quiet', '/norestart' -Wait -PassThru
  switch ($vc.ExitCode) {
    0     { Write-Host '    installed' }
    1638  { Write-Host '    a newer version is already present -- nothing to do' }
    3010  { Write-Host '    installed; Windows wants a restart, which the ERP does not need right now' }
    default {
      throw "The Visual C++ redistributable failed to install (exit $($vc.ExitCode)). PostgreSQL cannot run without it. Nothing has been written to this machine."
    }
  }
} else {
  # Not fatal on its own: a machine that already has the runtime installs
  # fine. The binary check below is what actually decides, and it now says
  # so in terms an operator can act on.
  Write-Warning "No vcredist/vc_redist.x64.exe in the payload. If this machine does not already have the Visual C++ runtime, PostgreSQL will not start."
}

# The bundled major must be the one the product is built and tested against:
# the backup agent's pg_dump has to match the cluster it dumps, and a cluster
# initialised by one major cannot be read by another.
$initdbExe = Join-Path $pgBin 'initdb.exe'
$bundledVersion = (& $initdbExe --version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) {
  # 0xC0000135 as a signed int. It means a DLL the executable needs is
  # missing, and for these binaries that is almost always the Visual C++
  # runtime -- which produces NO output at all, so the bare "it reported:"
  # below would show an empty string and name nothing.
  if ($LASTEXITCODE -eq -1073741515) {
    throw @"
The bundled PostgreSQL cannot start: a required DLL is missing.

$initdbExe exited with 0xC0000135 (STATUS_DLL_NOT_FOUND) without printing
anything. On a clean Windows machine this is the Visual C++ runtime --
vcruntime140.dll, vcruntime140_1.dll and msvcp140.dll are not part of
Windows and PostgreSQL's binaries need all three.

Expected at: $vcRedist
Present:     $(Test-Path $vcRedist)

If that file is missing, this installer was built without the redistributable
and cannot install here. Nothing has been written to this machine.
"@
  }
  throw "The bundled initdb could not run ($initdbExe), exit $LASTEXITCODE. It reported: $bundledVersion"
}
if ($bundledVersion -notmatch '\s16\.') {
  throw "This installer bundles '$bundledVersion', but the ERP is built for PostgreSQL 16.x. Nothing has been written to this machine."
}
Write-Host "    bundled $bundledVersion"

# What was actually staged at build time, recorded by build-payload.ps1.
$pgProvenance = Join-Path $InstallDir 'pgsql\POSTGRES-SOURCE.txt'
if (Test-Path $pgProvenance) {
  Write-Host "    provenance: $(((Get-Content $pgProvenance) -join '; '))"
} else {
  Write-Warning 'No pgsql\POSTGRES-SOURCE.txt in the payload: this build did not record which PostgreSQL it staged or its checksum.'
}

foreach ($dir in @($backupDir, $logsDir, (Split-Path $secretsFile -Parent))) {
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
}

# ---------------------------------------------------------------------------
# Secrets
#
# Generated once and reused on re-run. Regenerating AUTH_ACCESS_TOKEN_SECRET on
# every run would silently invalidate every active session, and regenerating the
# database password would lock the API out of its own data.
# ---------------------------------------------------------------------------
function New-Secret([int]$bytes = 32) {
  $buffer = [byte[]]::new($bytes)
  # Create().GetBytes(), NOT RandomNumberGenerator::Fill(). Fill() only exists
  # from .NET Core 2.1 onwards, and this script runs under Windows PowerShell
  # 5.1 (.NET Framework), where it throws "does not contain a method named
  # 'Fill'" — which would have failed the install on its very first step.
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
  # Base64url: safe inside an XML attribute and a connection string alike.
  [Convert]::ToBase64String($buffer).Replace('+', '-').Replace('/', '_').TrimEnd('=')
}

if (Test-Path $secretsFile) {
  Write-Step 'Reusing existing secrets'
  $secrets = Get-Content $secretsFile -Raw | ConvertFrom-Json
} else {
  Write-Step 'Generating secrets'
  $secrets = [pscustomobject]@{
    dbPassword  = New-Secret 24
    authSecret  = New-Secret 48
  }
  $secrets | ConvertTo-Json | Set-Content -Path $secretsFile -Encoding utf8
}

$databaseUrl = "postgresql://erp:$($secrets.dbPassword)@127.0.0.1:$PgPort/erp?schema=public"

# ---------------------------------------------------------------------------
# Lock down the install directory BEFORE any secret is written into a service
# definition. The rendered XML files and this secrets file contain the database
# password and the JWT signing key; on a shop PC where everyone logs in as the
# same local user, default Program Files ACLs are not enough.
# ---------------------------------------------------------------------------
Write-Step 'Restricting install directory permissions'
$acl = Get-Acl $InstallDir
$acl.SetAccessRuleProtection($true, $false)   # stop inheriting Users

# Well-known SIDs, NOT names. 'NT AUTHORITY\SYSTEM' and 'BUILTIN\Administrators'
# are the ENGLISH names of these accounts; on a Spanish Windows they are
# 'NT AUTHORITY\SISTEMA' and 'BUILTIN\Administradores', and AddAccessRule
# throws IdentityNotMappedException. Every customer of this product runs a
# localised Windows, so the name form fails on all of them -- while passing on
# an English CI runner and an English developer machine.
#
# A SID is the same everywhere: S-1-5-18 is SYSTEM and S-1-5-32-544 is the
# Administrators group, in every language and on every machine.
$identities = @(
  [System.Security.Principal.SecurityIdentifier]::new(
    [System.Security.Principal.WellKnownSidType]::LocalSystemSid, $null)
  [System.Security.Principal.SecurityIdentifier]::new(
    [System.Security.Principal.WellKnownSidType]::BuiltinAdministratorsSid, $null)
)
foreach ($identity in $identities) {
  $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
        $identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
}

# Users get read+execute on the tree, and this is NOT a relaxation of the
# hardening -- it is what makes the bundled database able to run at all.
#
# PostgreSQL refuses to execute with administrative privileges: initdb,
# pg_ctl and postgres call CreateRestrictedToken to DROP the Administrators
# SID from their own token before doing any real work. With the tree readable
# only by SYSTEM and Administrators, that restricted process cannot open its
# own DLLs, and every one of them dies with 0xC0000135 -- silently, printing
# nothing at all, because it fails inside the loader before main() runs.
#
# The secrets are protected below instead, on the directories that actually
# hold them. What must not be readable is the database password and the JWT
# signing key, not initdb.exe.
$usersSid = [System.Security.Principal.SecurityIdentifier]::new(
  [System.Security.Principal.WellKnownSidType]::BuiltinUsersSid, $null)
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
      $usersSid, 'ReadAndExecute', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
Set-Acl -Path $InstallDir -AclObject $acl

# The directories that carry secrets or business data: SYSTEM and
# Administrators only, inheritance broken so the read+execute rule above does
# not reach them. `config` holds erp-secrets.json, `services` the rendered
# WinSW definitions with the database password and the signing key in them,
# and `backups` the dumps.
#
# `data` is deliberately NOT in this list. The cluster directory is created
# and then written by PostgreSQL under its restricted token -- during an
# installation that token belongs to the administrator running the installer,
# not to SYSTEM -- so locking it to SYSTEM and Administrators reintroduces
# exactly the failure described above. Tightening it properly means granting
# the account the service actually runs as; see docs/server-installer.md.
foreach ($name in @('config', 'services', 'backups')) {
  $dir = Join-Path $InstallDir $name
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $secretAcl = Get-Acl $dir
  $secretAcl.SetAccessRuleProtection($true, $false)
  foreach ($identity in $identities) {
    $secretAcl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
          $identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
  }
  Set-Acl -Path $dir -AclObject $secretAcl
}

# ---------------------------------------------------------------------------
# PostgreSQL cluster
# ---------------------------------------------------------------------------
# $initdbExe was resolved and version-checked by the payload validation at the
# top of this script, before anything was written to this machine.

if (Test-Path (Join-Path $pgData 'PG_VERSION')) {
  Write-Step 'PostgreSQL data directory already initialised'
} else {
  Write-Step 'Initialising PostgreSQL data directory'
  New-Item -ItemType Directory -Path $pgData -Force | Out-Null

  # The superuser password goes through a file, never argv: command lines are
  # readable by any process on the machine.
  $pwFile = Join-Path $env:TEMP "erp-initdb-$([guid]::NewGuid()).txt"
  try {
    Set-Content -Path $pwFile -Value $secrets.dbPassword -Encoding ascii -NoNewline
    & $initdbExe `
      --pgdata=$pgData --username=erp --pwfile=$pwFile `
      --encoding=UTF8 --locale=C --auth-local=scram-sha-256 --auth-host=scram-sha-256
    if ($LASTEXITCODE -ne 0) { throw "initdb failed with exit code $LASTEXITCODE" }
  } finally {
    Remove-Item $pwFile -Force -ErrorAction SilentlyContinue
  }

  # Loopback only. LAN clients reach the API, never PostgreSQL directly — the
  # invariant from AGENTS.md and docs/desktop-lan-architecture.md.
  Add-Content -Path (Join-Path $pgData 'postgresql.conf') -Value @"

# --- ERP Server settings (written by install.ps1) ---
listen_addresses = '127.0.0.1'
port = $PgPort
"@
}

# ---------------------------------------------------------------------------
# Service definitions
# ---------------------------------------------------------------------------
Write-Step 'Rendering service definitions'

# XML attribute values must be escaped; a generated secret, an object-store key
# or a bucket name can contain & or <. Declared before first use: PowerShell
# resolves functions at run time, top to bottom.
function ConvertTo-XmlAttribute([string]$value) {
  [System.Security.SecurityElement]::Escape($value)
}

$cloudEnabled = if ($CloudBackup) { 'true' } else { 'false' }
$cloudBlock = ''
if ($CloudBackup) {
  if (-not $CloudBucket -or -not $CloudAccessKeyId -or -not $CloudSecretAccessKey) {
    throw 'CloudBackup requires -CloudBucket, -CloudAccessKeyId and -CloudSecretAccessKey.'
  }
  $endpointLine = if ($CloudEndpoint) {
    "  <env name=`"ERP_BACKUP_CLOUD_ENDPOINT`" value=`"$(ConvertTo-XmlAttribute $CloudEndpoint)`"/>`n"
  } else { '' }
  $cloudBlock = $endpointLine +
    "  <env name=`"ERP_BACKUP_CLOUD_REGION`" value=`"$(ConvertTo-XmlAttribute $CloudRegion)`"/>`n" +
    "  <env name=`"ERP_BACKUP_CLOUD_BUCKET`" value=`"$(ConvertTo-XmlAttribute $CloudBucket)`"/>`n" +
    "  <env name=`"ERP_BACKUP_CLOUD_ACCESS_KEY_ID`" value=`"$(ConvertTo-XmlAttribute $CloudAccessKeyId)`"/>`n" +
    "  <env name=`"ERP_BACKUP_CLOUD_SECRET_ACCESS_KEY`" value=`"$(ConvertTo-XmlAttribute $CloudSecretAccessKey)`"/>"
}

$replacements = @{
  '{{PG_PORT}}'                    = $PgPort
  '{{API_PORT}}'                   = $ApiPort
  '{{GESTION_PORT}}'               = $GestionPort
  '{{FACTURACION_PORT}}'           = $FacturacionPort
  '{{DATABASE_URL}}'               = (ConvertTo-XmlAttribute $databaseUrl)
  # Redis is optional and not installed by the ERP Server — the API starts and
  # runs correctly without it (see apps/api/src/redis/redis.service.ts). The
  # value is still required by the config schema, so it points at a local Redis
  # that may simply never exist.
  '{{REDIS_URL}}'                  = 'redis://127.0.0.1:6379'
  '{{CORS_ORIGIN}}'                = "http://localhost:$GestionPort,http://localhost:$FacturacionPort"
  '{{AUTH_ACCESS_TOKEN_SECRET}}'   = (ConvertTo-XmlAttribute $secrets.authSecret)
  '{{ERP_BACKUP_DIR}}'             = (ConvertTo-XmlAttribute $backupDir)
  '{{ERP_PG_BIN_DIR}}'             = (ConvertTo-XmlAttribute $pgBin)
  '{{ERP_BACKUP_TIMES}}'           = $BackupTimes
  '{{ERP_BACKUP_RETENTION_DAYS}}'  = $BackupRetentionDays
  '{{ERP_BACKUP_KEEP_MINIMUM}}'    = $BackupKeepMinimum
  '{{ERP_BACKUP_CLOUD_ENABLED}}'   = $cloudEnabled
  '{{CLOUD_ENV_BLOCK}}'            = $cloudBlock
}

$winswSource = Join-Path $InstallDir 'winsw\WinSW.exe'
if (-not (Test-Path $winswSource)) {
  throw "WinSW.exe not found at $winswSource. The installer must ship it."
}

$serviceIds = @('erp-postgres', 'erp-api', 'erp-gestion', 'erp-facturacion', 'erp-agent')

# On an upgrade the services are still running, and Windows holds a lock on a
# running service's executable — replacing erp-<id>.exe below would fail. Stop
# them first, dependents before their dependencies so Windows never refuses.
foreach ($id in @('erp-agent', 'erp-facturacion', 'erp-gestion', 'erp-api', 'erp-postgres')) {
  if (Get-Service -Name $id -ErrorAction SilentlyContinue) {
    Write-Step "Stopping $id for upgrade"
    Stop-Service -Name $id -Force -ErrorAction SilentlyContinue
  }
}

foreach ($id in $serviceIds) {
  $template = Join-Path $servicesDir "$id.xml.template"
  $rendered = Join-Path $servicesDir "$id.xml"

  $content = Get-Content $template -Raw
  foreach ($key in $replacements.Keys) {
    $content = $content.Replace($key, [string]$replacements[$key])
  }
  # Any placeholder left unreplaced would become a literal value in a running
  # service — fail loudly instead of shipping a broken configuration.
  if ($content -match '\{\{[A-Z_]+\}\}') {
    throw "Unreplaced placeholder $($Matches[0]) in $id.xml"
  }

  Set-Content -Path $rendered -Value $content -Encoding utf8

  # WinSW v2 finds its configuration by its OWN executable name, so each
  # service needs its own erp-<id>.exe beside its erp-<id>.xml. Hard-link
  # rather than copy: the self-contained WinSW build is 18 MB, and five copies
  # would cost 91 MB of the customer's disk for five identical files. Falls
  # back to a real copy where linking is unavailable (a different volume, or a
  # non-NTFS filesystem).
  $serviceExe = Join-Path $servicesDir "$id.exe"
  Remove-Item $serviceExe -Force -ErrorAction SilentlyContinue
  try {
    New-Item -ItemType HardLink -Path $serviceExe -Target $winswSource -ErrorAction Stop | Out-Null
  } catch {
    Copy-Item $winswSource $serviceExe -Force
  }
}

# ---------------------------------------------------------------------------
# Register and start
# ---------------------------------------------------------------------------
function Install-ErpService([string]$id) {
  $exe = Join-Path $servicesDir "$id.exe"
  if (Get-Service -Name $id -ErrorAction SilentlyContinue) {
    Write-Step "Updating service $id"
    # `stop` on an already-stopped service exits non-zero, which is not a
    # failure here — only the outcome of refresh/install decides that.
    & $exe stop | Out-Null
    & $exe refresh | Out-Null
  } else {
    Write-Step "Installing service $id"
    & $exe install | Out-Null
  }
  if ($LASTEXITCODE -ne 0) { throw "WinSW failed for $id (exit $LASTEXITCODE)" }
}

foreach ($id in $serviceIds) { Install-ErpService $id }

Write-Step 'Starting PostgreSQL'
Start-Service -Name 'erp-postgres'

# Windows reports a service as Running before PostgreSQL is accepting
# connections, so wait for readiness rather than assuming it.
$ready = $false
foreach ($attempt in 1..30) {
  & (Join-Path $pgBin 'pg_isready.exe') -h 127.0.0.1 -p $PgPort -q
  if ($LASTEXITCODE -eq 0) { $ready = $true; break }
  Start-Sleep -Seconds 2
}
if (-not $ready) { throw 'PostgreSQL did not become ready within 60 seconds.' }

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
$env:PGPASSWORD = $secrets.dbPassword
$exists = & (Join-Path $pgBin 'psql.exe') -h 127.0.0.1 -p $PgPort -U erp -d postgres -tAc `
  "select 1 from pg_database where datname = 'erp'"
if ($exists -ne '1') {
  Write-Step 'Creating database'
  & (Join-Path $pgBin 'createdb.exe') -h 127.0.0.1 -p $PgPort -U erp erp
  if ($LASTEXITCODE -ne 0) { throw 'createdb failed' }
}

Write-Step 'Applying migrations'
Push-Location $serverDir
try {
  $env:DATABASE_URL = $databaseUrl
  & (Join-Path $InstallDir 'node\node.exe') `
    (Join-Path $serverDir 'node_modules\prisma\build\index.js') `
    'migrate' 'deploy' '--schema' (Join-Path $serverDir 'apps\api\prisma\schema.prisma')
  if ($LASTEXITCODE -ne 0) { throw 'prisma migrate deploy failed' }

  Write-Step 'Provisioning company and administrator'
  # Real provisioning, NOT the demo seed: a customer must never receive
  # "Distribuidora Horizonte" and ten invented sales. See prisma/provision.ts.
  $env:ERP_COMPANY_NAME   = $CompanyName
  $env:ERP_COMPANY_TAX_ID = $CompanyTaxId
  $env:ERP_ADMIN_EMAIL    = $AdminEmail
  $env:ERP_ADMIN_PASSWORD = $AdminPassword
  # Bundled by build-payload.ps1 next to schema.prisma — NOT under dist/, which
  # excludes prisma/ entirely (see apps/api/tsconfig.build.json).
  & (Join-Path $InstallDir 'node\node.exe') (Join-Path $serverDir 'apps\api\prisma\provision.js')
  if ($LASTEXITCODE -ne 0) { throw 'provisioning failed' }
} finally {
  Remove-Item Env:\ERP_ADMIN_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
  Pop-Location
}

# ---------------------------------------------------------------------------
# Bring up the rest
# ---------------------------------------------------------------------------
foreach ($id in @('erp-api', 'erp-gestion', 'erp-facturacion', 'erp-agent')) {
  Write-Step "Starting $id"
  Start-Service -Name $id
}

$ip = (Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.PrefixOrigin -ne 'WellKnown' -and $_.IPAddress -ne '127.0.0.1' } |
  Select-Object -First 1 -ExpandProperty IPAddress)

Write-Host ''
Write-Host 'ERP Server instalado.' -ForegroundColor Green
Write-Host "  Gestión:      http://$ip`:$GestionPort"
Write-Host "  Facturación:  http://$ip`:$FacturacionPort"
Write-Host "  Usuario:      $AdminEmail"
Write-Host "  Backups:      $backupDir (diario $BackupTimes)"
Write-Host ''
Write-Host 'Configurá esta dirección en el cliente ERP de cada PC de la red.'
