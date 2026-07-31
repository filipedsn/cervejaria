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

$apiOk = Test-ApiHealthy -HealthUrl $paths.ReadyUrl
$liveOk = Test-ApiHealthy -HealthUrl $paths.HealthUrl
Write-Host "Backend ready ($($paths.ReadyUrl)): $(if ($apiOk) { 'OK' } else { 'FORA' })" -ForegroundColor $(if ($apiOk) { 'Green' } else { 'Red' })
Write-Host "Backend live ($($paths.HealthUrl)): $(if ($liveOk) { 'OK' } else { 'FORA' })" -ForegroundColor $(if ($liveOk) { 'Green' } else { 'DarkGray' })

if (Test-Path $paths.ApiPidFile) {
  $processId = Get-Content $paths.ApiPidFile
  $alive = Test-ProcessAlive -ProcessId ([int]$processId)
  Write-Host "  PID arquivo: $processId $(if ($alive) { '(ativo)' } else { '(morto)' })"
}

$watchdogPidFile = Join-Path $paths.RuntimeDir 'watchdog.pid'
if (Test-Path $watchdogPidFile) {
  $processId = Get-Content $watchdogPidFile
  $alive = Test-ProcessAlive -ProcessId ([int]$processId)
  Write-Host "Watchdog daemon: $(if ($alive) { 'OK' } else { 'FORA' }) (PID $processId)" -ForegroundColor $(if ($alive) { 'Green' } else { 'Red' })
}

$opsPidFile = Join-Path $paths.RuntimeDir 'ops-panel.pid'
if (Test-Path $opsPidFile) {
  $processId = Get-Content $opsPidFile
  $alive = Test-ProcessAlive -ProcessId ([int]$processId)
  Write-Host "Ops panel (:3099): $(if ($alive) { 'OK' } else { 'FORA' }) (PID $processId)" -ForegroundColor $(if ($alive) { 'Green' } else { 'Red' })
  Write-Host "  http://127.0.0.1:3099" -ForegroundColor Gray
}

$frontendOk = Test-FrontendHealthy -FrontendUrl $paths.FrontendUrl
$frontendLabel = if ($paths.ServeFrontendFromApi) { 'Frontend estatico (via API)' } else { 'Frontend Vite' }
Write-Host "$frontendLabel ($($paths.FrontendUrl)): $(if ($frontendOk) { 'OK' } else { 'FORA' })" -ForegroundColor $(if ($frontendOk) { 'Green' } else { 'Red' })

if (Test-Path $paths.FrontendPidFile) {
  $processId = Get-Content $paths.FrontendPidFile
  $alive = Test-ProcessAlive -ProcessId ([int]$processId)
  Write-Host "  PID arquivo: $processId $(if ($alive) { '(ativo)' } else { '(morto)' })"
}

$cloudflarePort = if ($paths.ServeFrontendFromApi) { $paths.ApiPort } else { $paths.FrontendPort }
Write-Host "Cloudflare (publico): https://tap.quivercloud.com.br -> localhost:$cloudflarePort"

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
foreach ($name in @('QuiverTap-AtLogon', 'QuiverTap-AtStartup')) {
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

if (Test-Path $paths.ProdManifest) {
  try {
    $manifest = Get-Content -Path $paths.ProdManifest -Raw -Encoding UTF8 | ConvertFrom-Json
    Write-Host ''
    Write-Host 'Artefatos prod:' -ForegroundColor Cyan
    Write-Host "  Dir:      $($paths.ProdArtifactsDir)"
    Write-Host "  Deploy:   $($manifest.deployedAt)"
    Write-Host "  gitSha:   $($manifest.gitSha)"
    & "$PSScriptRoot\verify-prod-artifacts.ps1" -Quiet
    if ($LASTEXITCODE -ne 0) {
      Write-Host '  Verificacao: DRIFT (rode npm run prod:verify)' -ForegroundColor Red
    } else {
      Write-Host '  Verificacao: OK' -ForegroundColor Green
    }
  } catch {
    Write-Host '  Manifest ilegivel.' -ForegroundColor Yellow
  }
} else {
  Write-Host ''
  Write-Host 'Artefatos prod: manifest ausente (rode prod:deploy)' -ForegroundColor Yellow
}

Write-Host ''
