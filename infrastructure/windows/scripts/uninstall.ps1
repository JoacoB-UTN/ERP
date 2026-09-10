<#
.SYNOPSIS
  Stops and removes the ERP Server's Windows services.

.DESCRIPTION
  Run by the uninstaller before it deletes the program files, and safe to run by
  hand during support.

  It removes SERVICES ONLY. The PostgreSQL data directory, the backups and the
  generated secrets are left in place on purpose: uninstalling an application
  must never be the action that destroys a business's accounting data. Someone
  who genuinely wants the data gone has to delete those folders deliberately,
  which is a decision a person makes, not a side effect of clicking "Desinstalar".
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$InstallDir
)

$ErrorActionPreference = 'Continue'
Set-StrictMode -Version Latest

$servicesDir = Join-Path $InstallDir 'services'

# Reverse dependency order: dependents first, PostgreSQL last, so Windows never
# refuses to stop a service something else still depends on.
$serviceIds = @('erp-agent', 'erp-facturacion', 'erp-gestion', 'erp-api', 'erp-postgres')

foreach ($id in $serviceIds) {
  $service = Get-Service -Name $id -ErrorAction SilentlyContinue
  if (-not $service) { continue }

  Write-Host "Stopping $id"
  Stop-Service -Name $id -Force -ErrorAction SilentlyContinue

  # Wait for it to actually stop: WinSW cannot uninstall a running service, and
  # Stop-Service returns before the process has necessarily exited.
  foreach ($attempt in 1..30) {
    $service.Refresh()
    if ($service.Status -eq 'Stopped') { break }
    Start-Sleep -Seconds 1
  }

  $exe = Join-Path $servicesDir "$id.exe"
  if (Test-Path $exe) {
    Write-Host "Removing $id"
    & $exe uninstall | Out-Null
  } else {
    # The WinSW shim is gone (a partial install, or files removed first) —
    # fall back to the built-in tool so the service does not linger forever.
    & sc.exe delete $id | Out-Null
  }
}

Write-Host ''
Write-Host 'Servicios del ERP eliminados.'
Write-Host "La base de datos y las copias de seguridad NO se borraron:"
Write-Host "  Datos:   $(Join-Path $InstallDir 'data')"
Write-Host "  Backups: $(Join-Path $InstallDir 'backups')"
Write-Host 'Borralas a mano solo si estás seguro de que no las vas a necesitar.'
