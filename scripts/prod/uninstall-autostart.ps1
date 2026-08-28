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
  Stop-ManagedPidFile -PidFile $watchdogPidFile -ExpectedProcessNames @('powershell.exe', 'pwsh.exe') -CommandLinePatterns @('watchdog-daemon.ps1') -Label 'Watchdog daemon' | Out-Null
} catch {}

Write-Host 'Concluido. Processos em execucao nao foram encerrados (use stop-all.ps1).' -ForegroundColor Green
