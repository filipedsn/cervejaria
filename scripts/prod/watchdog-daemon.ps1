# Daemon unico: monitora producao em loop sem abrir novas janelas a cada ciclo.

param(
  # Apos um boot, Docker e seus containers podem levar alguns minutos para ficar
  # prontos. Um ciclo curto reduz a indisponibilidade sem criar processos extras.
  [int]$IntervalSeconds = 60
)

$ErrorActionPreference = 'Continue'
. "$PSScriptRoot\_config.ps1"

try {
  $settings = Get-QuiverTapSettings
  $paths = Resolve-QuiverTapPaths -Settings $settings
} catch {
  exit 1
}

$watchdogPidFile = Join-Path $paths.RuntimeDir 'watchdog.pid'
Set-Content -Path $watchdogPidFile -Value $PID -Encoding ASCII
Write-WatchdogLog -Paths $paths -Message "Watchdog daemon em execucao PID $PID."

try {
  do {
    & "$PSScriptRoot\ensure-running.ps1" -Quiet
    Start-Sleep -Seconds $IntervalSeconds
  } while ($true)
} finally {
  Write-WatchdogLog -Paths $paths -Message "Watchdog daemon encerrado PID $PID."
  Remove-Item $watchdogPidFile -Force -ErrorAction SilentlyContinue
}
