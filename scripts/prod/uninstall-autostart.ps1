# Remove tarefas agendadas do Quiver Tap.

$ErrorActionPreference = 'SilentlyContinue'

foreach ($name in @('QuiverTap-AtLogon', 'QuiverTap-AtStartup', 'QuiverTap-Watchdog')) {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false
  Write-Host "Removida: $name"
}

Write-Host 'Concluido. Processos em execucao nao foram encerrados (use stop-all.ps1).' -ForegroundColor Green
