# Status da API, tunnel e tarefas agendadas.

. "$PSScriptRoot\_config.ps1"

try {
  $settings = Get-QuiverTapSettings
  $paths = Resolve-QuiverTapPaths -Settings $settings
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  exit 1
}

Write-Host ''
Write-Host 'Quiver Tap - Status de producao' -ForegroundColor Cyan
Write-Host '================================' -ForegroundColor Cyan
Write-Host "Projeto: $($paths.ProjectRoot)"
Write-Host ''

$apiOk = Test-ApiHealthy -HealthUrl $paths.HealthUrl
Write-Host "Backend ($($paths.HealthUrl)): $(if ($apiOk) { 'OK' } else { 'FORA' })" -ForegroundColor $(if ($apiOk) { 'Green' } else { 'Red' })

if (Test-Path $paths.ApiPidFile) {
  $processId = Get-Content $paths.ApiPidFile
  $alive = Test-ProcessAlive -ProcessId ([int]$processId)
  Write-Host "  PID arquivo: $processId $(if ($alive) { '(ativo)' } else { '(morto)' })"
}

$frontendOk = Test-FrontendHealthy -FrontendUrl $paths.FrontendUrl
Write-Host "Frontend ($($paths.FrontendUrl)): $(if ($frontendOk) { 'OK' } else { 'FORA' })" -ForegroundColor $(if ($frontendOk) { 'Green' } else { 'Red' })

if (Test-Path $paths.FrontendPidFile) {
  $processId = Get-Content $paths.FrontendPidFile
  $alive = Test-ProcessAlive -ProcessId ([int]$processId)
  Write-Host "  PID arquivo: $processId $(if ($alive) { '(ativo)' } else { '(morto)' })"
}

Write-Host "Cloudflare (publico): https://tap.quivercloud.com.br -> localhost:$($paths.FrontendPort)"

$tunnelOk = Test-CloudflaredRunning
Write-Host "Cloudflare Tunnel: $(if ($tunnelOk) { 'OK' } else { 'FORA' })" -ForegroundColor $(if ($tunnelOk) { 'Green' } else { 'Red' })

$svc = Get-Service -Name 'Cloudflared' -ErrorAction SilentlyContinue
if ($svc) {
  Write-Host "  Servico Windows Cloudflared: $($svc.Status)"
}

if (Test-Path $paths.TunnelPidFile) {
  $processId = Get-Content $paths.TunnelPidFile
  $alive = Test-ProcessAlive -ProcessId ([int]$processId)
  Write-Host "  PID arquivo: $processId $(if ($alive) { '(ativo)' } else { '(morto)' })"
}

Write-Host ''
Write-Host 'Tarefas agendadas:' -ForegroundColor Cyan
foreach ($name in @('QuiverTap-AtLogon', 'QuiverTap-AtStartup', 'QuiverTap-Watchdog')) {
  $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  if ($task) {
    $info = Get-ScheduledTaskInfo -TaskName $name
    Write-Host "  $name : $($task.State) | Ultima execucao: $($info.LastRunTime)"
  } else {
    Write-Host "  $name : nao instalada" -ForegroundColor DarkGray
  }
}

Write-Host ''
Write-Host "Logs: $($paths.LogDir)"
Write-Host ''
