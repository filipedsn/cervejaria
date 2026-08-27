# Instala tarefas agendadas: sobe backend + frontend + tunnel no boot e monitora a cada 2 minutos.
# Modo completo: PowerShell como Administrador.
# Modo parcial (-UserOnly): sem admin, so login + watchdog (sem boot antes do login).

param(
  [switch]$SkipBuild,
  [switch]$SkipTunnelServiceHint,
  [switch]$UserOnly,
  # Reinstala somente as tarefas agendadas. Seguro para aplicar a correcao de
  # boot: nao faz build, deploy, migracao nem toca nos artefatos publicados.
  [switch]$RepairTasksOnly
)

$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator
)

if (-not $isAdmin -and -not $UserOnly) {
  Write-Host ''
  Write-Host 'Este instalador precisa de PowerShell como Administrador.' -ForegroundColor Red
  Write-Host ''
  Write-Host 'Como abrir:' -ForegroundColor Yellow
  Write-Host '  1. Menu Iniciar -> digite PowerShell'
  Write-Host '  2. Clique direito em Windows PowerShell'
  Write-Host '  3. Executar como administrador'
  Write-Host '  4. Rode:'
  Write-Host '     cd C:\Users\Papai\Documents\Desenvolvimento\Cervejaria'
  Write-Host '     npm.cmd run prod:install'
  Write-Host ''
  Write-Host 'Alternativa sem admin (parcial - so ao fazer login):' -ForegroundColor Cyan
  Write-Host '     npm.cmd run prod:install-user'
  Write-Host ''
  exit 1
}

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$ensureScript = Join-Path $PSScriptRoot 'ensure-running.ps1'
$settingsExample = Join-Path $projectRoot 'deploy\production.settings.psd1.example'
$settingsLocal = Join-Path $projectRoot 'deploy\production.settings.psd1'

if (-not (Test-Path $settingsLocal)) {
  Copy-Item $settingsExample $settingsLocal
  Write-Host "Criado $settingsLocal - revise caminhos se necessario." -ForegroundColor Yellow
}

Set-Location $projectRoot

$npmCmd = Join-Path ${env:ProgramFiles} 'nodejs\npm.cmd'
if (-not (Test-Path $npmCmd)) {
  $npmCmd = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
}

. "$PSScriptRoot\_config.ps1"
. "$PSScriptRoot\publish-artifacts.ps1"
$settings = Get-QuiverTapSettings
$paths = Resolve-QuiverTapPaths -Settings $settings

if (-not $SkipBuild -and -not $RepairTasksOnly) {
  Write-Host 'Build e publicacao de artefatos de producao...' -ForegroundColor Cyan
  Ensure-ProdArtifactsBaseline -Paths $paths
  Initialize-ProdStaging -Paths $paths

  if ($npmCmd) {
    & $npmCmd run build:prod --prefix frontend
  } else {
    npm run build:prod --prefix frontend
  }
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'Build do frontend (prod) falhou.' -ForegroundColor Red
    exit 1
  }

  if (-not (Test-Path $paths.DevApiEntry)) {
    Write-Host 'Build do backend (dist ausente)...' -ForegroundColor Cyan
    if ($npmCmd) {
      & $npmCmd run build:deploy --prefix backend
    } else {
      npm run build:deploy --prefix backend
    }
    if ($LASTEXITCODE -ne 0) {
      Write-Host 'Build do backend falhou e backend/dist nao existe.' -ForegroundColor Red
      exit 1
    }
  }

  Stage-BackendArtifacts -Paths $paths
  Publish-ProdArtifactsSwap -Paths $paths -Frontend -Backend
  Write-ProdManifest -Paths $paths -DeployMeta @{ source = 'prod:install' }
}

$nodePath = Join-Path ${env:ProgramFiles} 'nodejs'
if (Test-Path $nodePath) { $env:Path = "$nodePath;$env:Path" }

if (-not $RepairTasksOnly) {
  Write-Host 'Migrations (producao)...' -ForegroundColor Cyan
  Push-Location (Join-Path $projectRoot 'backend')
  $env:NODE_ENV = 'production'
  if ($npmCmd) {
    node scripts/run-with-env.mjs production $npmCmd exec prisma migrate deploy
  } else {
    node scripts/run-with-env.mjs production npx prisma migrate deploy
  }
  if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Host 'prisma migrate deploy falhou.' -ForegroundColor Red
    exit 1
  }

  Write-Host 'Prisma generate...' -ForegroundColor Cyan
  if ($npmCmd) {
    & $npmCmd exec prisma generate
  } else {
    npx prisma generate
  }
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'Prisma generate falhou (backend rodando?). Continuando.' -ForegroundColor Yellow
  }
  Pop-Location
} else {
  Write-Host 'Modo reparo: build, migracoes e artefatos nao serao alterados.' -ForegroundColor Yellow
}

$logonAction = New-ScheduledTaskAction `
  -Execute 'wscript.exe' `
  -Argument "`"$(Join-Path $PSScriptRoot 'start-watchdog-daemon-hidden.vbs')`""

$runLevel = if ($isAdmin) { 'Highest' } else { 'Limited' }
$principal = New-ScheduledTaskPrincipal `
  -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType Interactive `
  -RunLevel $runLevel

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -Hidden

$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

Register-ScheduledTask -TaskName 'QuiverTap-AtLogon' -Action $logonAction -Trigger $logonTrigger -Principal $principal -Settings $settings -Force | Out-Null

Write-Host ''
Write-Host 'Tarefas instaladas:' -ForegroundColor Green
Write-Host '  QuiverTap-AtLogon    - ao entrar no Windows (inicia daemon oculto)'

if ($isAdmin -and -not $UserOnly) {
  # Diferente do gatilho de login, o boot precisa funcionar sem sessao de usuario.
  # SYSTEM tambem evita depender do Docker Desktop ja ter aberto uma janela.
  $bootAction = New-ScheduledTaskAction `
    -Execute (Join-Path $PSHOME 'powershell.exe') `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $PSScriptRoot 'start-watchdog-daemon.ps1')`" -Quiet"
  $bootPrincipal = New-ScheduledTaskPrincipal `
    -UserId 'SYSTEM' `
    -LogonType ServiceAccount `
    -RunLevel Highest
  $startupTrigger = New-ScheduledTaskTrigger -AtStartup
  $startupTrigger.Delay = 'PT1M'
  Register-ScheduledTask -TaskName 'QuiverTap-AtStartup' -Action $bootAction -Trigger $startupTrigger -Principal $bootPrincipal -Settings $settings -Force | Out-Null
  Write-Host '  QuiverTap-AtStartup  - 1 min apos ligar o PC, como SYSTEM (sem depender de login)'
} else {
  Write-Host ''
  Write-Host 'Modo parcial: QuiverTap-AtStartup NAO instalada (precisa de admin).' -ForegroundColor Yellow
  Write-Host 'Apos reiniciar o PC, os servicos sobem quando voce fizer login.' -ForegroundColor Yellow
}

if (-not $SkipTunnelServiceHint) {
  Write-Host ''
  Write-Host 'Cloudflare: tap.quivercloud.com.br -> localhost:3001 (API + frontend estatico)' -ForegroundColor Cyan
}

Write-Host ''
Write-Host 'Subindo agora...' -ForegroundColor Cyan
& "$PSScriptRoot\start-watchdog-daemon.ps1"
& (Join-Path $PSScriptRoot 'status.ps1')
