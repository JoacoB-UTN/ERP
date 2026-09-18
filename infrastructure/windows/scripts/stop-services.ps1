<#
.SYNOPSIS
  Stops the ERP Server's services and makes sure nothing is left running from
  the install directory.

.DESCRIPTION
  Used by the installer before it replaces files on an upgrade, and by
  uninstall.ps1 before the program files are deleted. Both need the same
  guarantee: no process holds a file under the install directory.

  Stopping the services is not enough to give that guarantee, for two reasons.

  1. A service in a failure loop gets started again by the Service Control
     Manager's recovery actions -- 10 to 300 seconds later, i.e. in the middle
     of the file copy. So each service is set to Disabled before it is stopped;
     the SCM does not start a disabled service, recovery action or not. Both
     callers undo that: install.ps1 re-registers every service from its XML,
     uninstall.ps1 deletes them.

  2. If a WinSW wrapper dies on its own, its child keeps running with no
     service attached to it. That is what happened on the test VM: the
     erp-postgres wrapper crashed, the postmaster kept serving, and Windows
     reported the service as stopped. Stop-Service cannot reach that process,
     and it holds postgres.exe, its DLLs and the data directory's lock. So
     after the services are down this script ends whatever still runs from the
     install directory:
       - PostgreSQL through pg_ctl, a clean shutdown with a checkpoint; only if
         that fails, by ending the process (crash recovery on the next start,
         which WAL makes safe, just slow);
       - node.exe outright: the API and the frontends keep no state of their
         own, everything lives in PostgreSQL.

  Only processes whose executable lives under -InstallDir are touched; a
  developer's own node.exe or another PostgreSQL on the machine are not.

  Exit code 0 when nothing is left running from -InstallDir, 1 otherwise.
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$InstallDir
)

$ErrorActionPreference = 'Continue'
Set-StrictMode -Version Latest

$InstallDir = [System.IO.Path]::GetFullPath($InstallDir).TrimEnd('\')

# Dependents first, PostgreSQL last, so Windows never refuses to stop a
# service something else still depends on.
$serviceIds = @('erp-agent', 'erp-facturacion', 'erp-gestion', 'erp-api', 'erp-postgres')

foreach ($id in $serviceIds) {
  $service = Get-Service -Name $id -ErrorAction SilentlyContinue
  if (-not $service) { continue }

  Set-Service -Name $id -StartupType Disabled -ErrorAction SilentlyContinue
  if ($service.Status -ne 'Stopped') {
    Write-Host "Stopping $id"
    Stop-Service -Name $id -Force -ErrorAction SilentlyContinue
  }

  # Stop-Service can return before the process has exited, and a service that
  # was mid-restart can still be StartPending. erp-postgres allows its own
  # stop up to 90 seconds (pg_ctl -t 60 plus margin), so wait that long.
  foreach ($attempt in 1..90) {
    $service.Refresh()
    if ($service.Status -eq 'Stopped') { break }
    Start-Sleep -Seconds 1
  }
  if ($service.Status -ne 'Stopped') {
    Write-Warning "$id is still $($service.Status) after 90 seconds."
  }
}

function Get-ProcessesUnder([string]$dir) {
  $prefix = $dir + '\'
  @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
      $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
    })
}

$leftovers = Get-ProcessesUnder $InstallDir
$postmasters = @($leftovers | Where-Object { $_.Name -eq 'postgres.exe' })

if ($postmasters.Count -gt 0) {
  $pgCtl = Join-Path $InstallDir 'pgsql\bin\pg_ctl.exe'
  $pgData = Join-Path $InstallDir 'data'
  Write-Warning 'PostgreSQL is still running with no service attached to it. Shutting it down cleanly.'
  if ((Test-Path $pgCtl) -and (Test-Path (Join-Path $pgData 'postmaster.pid'))) {
    & $pgCtl stop -D $pgData -m fast -w -t 60
  }
}

# Whatever survives the clean shutdown -- postgres children that did not exit,
# orphaned node.exe, a wrapper stuck mid-restart -- is ended here.
foreach ($attempt in 1..2) {
  $leftovers = Get-ProcessesUnder $InstallDir
  if ($leftovers.Count -eq 0) { break }
  foreach ($p in $leftovers) {
    Write-Warning "Ending $($p.Name) (PID $($p.ProcessId)), still running from $($p.ExecutablePath)"
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 3
}

$leftovers = Get-ProcessesUnder $InstallDir
if ($leftovers.Count -gt 0) {
  foreach ($p in $leftovers) { Write-Warning "Could not end $($p.Name) (PID $($p.ProcessId))." }
  exit 1
}
Write-Host 'Nothing is running from the install directory.'
exit 0
