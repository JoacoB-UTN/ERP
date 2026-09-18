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

# Stop everything first, including processes a crashed wrapper left behind:
# anything still running from the install directory would keep its files
# locked and the uninstaller would leave half the program behind.
& (Join-Path $PSScriptRoot 'stop-services.ps1') -InstallDir $InstallDir

# Reverse dependency order, so Windows never refuses to delete a service that
# something else still depends on.
foreach ($id in @('erp-agent', 'erp-facturacion', 'erp-gestion', 'erp-api', 'erp-postgres')) {
  if (-not (Get-Service -Name $id -ErrorAction SilentlyContinue)) { continue }

  $exe = Join-Path $servicesDir "$id.exe"
  Write-Host "Removing $id"
  if (Test-Path $exe) {
    & $exe uninstall | Out-Null
  } else {
    # The WinSW shim is gone (a partial install, or files removed first) --
    # fall back to the built-in tool so the service does not linger forever.
    & sc.exe delete $id | Out-Null
  }
}

# The firewall rules the installer created. Removed here because leaving
# allow-rules behind for ports nothing listens on any more is exactly the kind
# of residue an uninstall is supposed to clean up -- unlike the data and the
# backups below, a firewall rule holds nothing of the business's.
foreach ($name in @('ERP Server - Gestion', 'ERP Server - Facturacion', 'ERP Server - API')) {
  $rule = Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue
  if ($rule) {
    Write-Host "Removing firewall rule: $name"
    $rule | Remove-NetFirewallRule -ErrorAction SilentlyContinue
  }
}

Write-Host ''
Write-Host 'Servicios del ERP eliminados.'
Write-Host "La base de datos y las copias de seguridad NO se borraron:"
Write-Host "  Datos:   $(Join-Path $InstallDir 'data')"
Write-Host "  Backups: $(Join-Path $InstallDir 'backups')"
Write-Host 'Borralas a mano solo si estás seguro de que no las vas a necesitar.'
