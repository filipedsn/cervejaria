# Inicia o daemon de watchdog (um unico processo oculto) se ainda nao estiver ativo.

param(
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"

$settings = Get-QuiverTapSettings
$paths = Resolve-QuiverTapPaths -Settings $settings

$watchdogPidFile = Join-Path $paths.RuntimeDir 'watchdog.pid'
if (Test-Path $watchdogPidFile) {
  $existingPid = [int](Get-Content $watchdogPidFile -ErrorAction SilentlyContinue)
  if (Test-ProcessAlive -ProcessId $existingPid) {
    if (-not $Quiet) {
      Write-Host "Watchdog daemon ja ativo (PID $existingPid)." -ForegroundColor Green
    }
    exit 0
  }
  Remove-Item $watchdogPidFile -Force -ErrorAction SilentlyContinue
}

$daemonScript = Join-Path $PSScriptRoot 'watchdog-daemon.ps1'
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
  $daemonPid = [int](Get-Content $watchdogPidFile -ErrorAction SilentlyContinue)
} else {
  $daemonPid = $proc.Id
}

Write-WatchdogLog -Paths $paths -Message "Watchdog daemon iniciado PID $daemonPid."
if (-not $Quiet) {
  Write-Host "Watchdog daemon iniciado (PID $daemonPid)." -ForegroundColor Green
}

& "$PSScriptRoot\start-ops-panel.ps1" -Quiet:$Quiet

exit 0
