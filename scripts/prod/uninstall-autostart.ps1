# Remove tarefas agendadas do Quiver Tap.

$ErrorActionPreference = 'SilentlyContinue'

foreach ($name in @('QuiverTap-AtLogon', 'QuiverTap-AtStartup', 'QuiverTap-Watchdog')) {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false
  Write-Host "Removida: $name"
}

. "$PSScriptRoot\_config.ps1"
try {
  $paths = Resolve-QuiverTapPaths -Settings (Get-QuiverTapSettings)
  $watchdogPidFile = Join-Path $paths.RuntimeDir 'watchdog.pid'
  if (Test-Path $watchdogPidFile) {
    $processId = [int](Get-Content $watchdogPidFile -ErrorAction SilentlyContinue)
    if (Test-ProcessAlive -ProcessId $processId) {
      Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
      Write-Host "Encerrado watchdog daemon (PID $processId)"
    }
    Remove-Item $watchdogPidFile -Force -ErrorAction SilentlyContinue
  }
} catch {}

Write-Host 'Concluido. Processos em execucao nao foram encerrados (use stop-all.ps1).' -ForegroundColor Green
