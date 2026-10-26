# Inicia o daemon de watchdog (um unico processo oculto) se ainda nao estiver ativo.

param(
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"
. "$PSScriptRoot\boot-dependencies.ps1"

$settings = Get-QuiverTapSettings
$paths = Resolve-QuiverTapPaths -Settings $settings
Start-ProdDockerDesktop
if (-not [Security.Principal.WindowsIdentity]::GetCurrent().IsSystem) {
  # Processo de usuario separado: nao bloquear o daemon SYSTEM esperando WSL.
  $recoveryScript=Join-Path $PSScriptRoot 'recover-docker-startup.ps1'
  Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$recoveryScript+'"')) -WindowStyle Hidden | Out-Null
}

$watchdogPidFile = Join-Path $paths.RuntimeDir 'watchdog.pid'
$daemonScript = Join-Path $PSScriptRoot 'watchdog-daemon.ps1'
$watchdogIdentity = Test-ManagedPidFile -PidFile $watchdogPidFile -ExpectedProcessNames @('powershell.exe', 'pwsh.exe') -CommandLinePatterns @('watchdog-daemon.ps1')
if ($watchdogIdentity.State -eq 'VALID') {
    if (-not $Quiet) {
      Write-Host "Watchdog daemon ja ativo (PID $($watchdogIdentity.ProcessId))." -ForegroundColor Green
    }
    exit 0
}
if ($watchdogIdentity.State -ne 'MISSING') { Clear-InvalidManagedPidFile -Identity $watchdogIdentity -PidFile $watchdogPidFile | Out-Null }

$nodeDir = Split-Path $paths.NodeExe -Parent
$env:Path = "$nodeDir;$env:Path"

$proc = Start-Process `
  -FilePath 'powershell.exe' `
  -ArgumentList @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-WindowStyle', 'Hidden',
    '-File', $daemonScript
  ) `
  -WindowStyle Hidden `
  -PassThru

Start-Sleep -Seconds 1

if (Test-Path $watchdogPidFile) {
  $daemonPid = Get-PidFromFile -PidFile $watchdogPidFile
} else {
  $daemonPid = $proc.Id
}

Write-WatchdogLog -Paths $paths -Message "Watchdog daemon iniciado PID $daemonPid."
if (-not $Quiet) {
  Write-Host "Watchdog daemon iniciado (PID $daemonPid)." -ForegroundColor Green
}

exit 0
