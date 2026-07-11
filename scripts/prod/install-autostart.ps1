# Instala tarefas agendadas: sobe backend + frontend + tunnel no boot e monitora a cada 2 minutos.
# Modo completo: PowerShell como Administrador.
# Modo parcial (-UserOnly): sem admin, so login + watchdog (sem boot antes do login).

param(
  [switch]$SkipBuild,
  [switch]$SkipTunnelServiceHint,
  [switch]$UserOnly
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

if (-not $SkipBuild) {
  $distEntry = Join-Path $projectRoot 'backend\dist\index.js'
  if (Test-Path $distEntry) {
    Write-Host 'backend/dist encontrado - pulando build.' -ForegroundColor Gray
  } else {
    Write-Host 'Build do backend...' -ForegroundColor Cyan
    if ($npmCmd) {
      & $npmCmd run build --prefix backend
    } else {
      npm run build --prefix backend
    }
    if ($LASTEXITCODE -ne 0) {
      Write-Host 'Build do backend falhou e backend/dist nao existe.' -ForegroundColor Red
      exit 1
    }
  }
}

$nodePath = Join-Path ${env:ProgramFiles} 'nodejs'
if (Test-Path $nodePath) { $env:Path = "$nodePath;$env:Path" }

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

$action = New-ScheduledTaskAction `
  -Execute 'wscript.exe' `
  -Argument "`"$(Join-Path $PSScriptRoot 'ensure-running-hidden.vbs')`""

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
$watchdogDuration = New-TimeSpan -Days 3650
$watchdogTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
  -RepetitionInterval (New-TimeSpan -Minutes 5) `
  -RepetitionDuration $watchdogDuration

Register-ScheduledTask -TaskName 'QuiverTap-AtLogon' -Action $action -Trigger $logonTrigger -Principal $principal -Settings $settings -Force | Out-Null
Register-ScheduledTask -TaskName 'QuiverTap-Watchdog' -Action $action -Trigger $watchdogTrigger -Principal $principal -Settings $settings -Force | Out-Null

Write-Host ''
Write-Host 'Tarefas instaladas:' -ForegroundColor Green
Write-Host '  QuiverTap-AtLogon    - ao entrar no Windows'
Write-Host '  QuiverTap-Watchdog   - a cada 5 min (backend + frontend + tunnel)'

if ($isAdmin -and -not $UserOnly) {
  $startupTrigger = New-ScheduledTaskTrigger -AtStartup
  $startupTrigger.Delay = 'PT1M'
  Register-ScheduledTask -TaskName 'QuiverTap-AtStartup' -Action $action -Trigger $startupTrigger -Principal $principal -Settings $settings -Force | Out-Null
  Write-Host '  QuiverTap-AtStartup  - 1 min apos ligar o PC'
} else {
  Write-Host ''
  Write-Host 'Modo parcial: QuiverTap-AtStartup NAO instalada (precisa de admin).' -ForegroundColor Yellow
  Write-Host 'Apos reiniciar o PC, os servicos sobem quando voce fizer login.' -ForegroundColor Yellow
}

if (-not $SkipTunnelServiceHint) {
  Write-Host ''
  Write-Host 'Cloudflare: tap.quivercloud.com.br -> localhost:5201 (painel Cloudflare)' -ForegroundColor Cyan
}

Write-Host ''
Write-Host 'Subindo agora...' -ForegroundColor Cyan
& $ensureScript
& (Join-Path $PSScriptRoot 'status.ps1')
