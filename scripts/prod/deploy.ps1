# Deploy de producao: backup, build, migrate, restart API e smoke test.

param(
  [switch]$Confirmed,
  [switch]$SkipBackup,
  [switch]$SkipMigrate,
  [switch]$FrontendOnly,
  [switch]$BackendOnly,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"

if ($FrontendOnly -and $BackendOnly) {
  Write-Host 'Use apenas -FrontendOnly ou -BackendOnly, nao ambos.' -ForegroundColor Red
  exit 1
}

$settings = Get-QuiverTapSettings
$paths = Resolve-QuiverTapPaths -Settings $settings

Set-Location $paths.ProjectRoot

$env:NODE_ENV = 'production'
Import-BackendEnvFile -BackendDir $paths.BackendDir -Environment production

$buildFrontend = -not $BackendOnly
$buildBackend = -not $FrontendOnly

$plan = [ordered]@{
  Backup   = -not $SkipBackup
  BuildFE  = $buildFrontend
  BuildBE  = $buildBackend
  Migrate  = -not $SkipMigrate
  Restart  = $true
  Smoke    = $true
}

Write-Host ''
Write-Host 'Quiver Tap - Deploy de producao' -ForegroundColor Cyan
Write-Host '================================' -ForegroundColor Cyan
Write-Host "Projeto: $($paths.ProjectRoot)"
Write-Host "API:     http://127.0.0.1:$($paths.ApiPort)"
Write-Host "Publico: https://tap.quivercloud.com.br"
Write-Host ''
Write-Host 'Plano:' -ForegroundColor Cyan
foreach ($step in $plan.Keys) {
  $enabled = $plan[$step]
  $label = if ($enabled) { 'SIM' } else { 'nao' }
  Write-Host "  $step : $label"
}
Write-Host ''

if ($DryRun) {
  Write-Host 'Dry-run: nenhuma acao executada.' -ForegroundColor Yellow
  Write-Host 'Para deploy real: npm run prod:deploy'
  exit 0
}

if (-not $Confirmed) {
  Write-Host 'ATENCAO: isto altera PRODUCAO (banco cervejaria, porta 3001).' -ForegroundColor Yellow
  $answer = Read-Host 'Digite DEPLOY para continuar'
  if ($answer -ne 'DEPLOY') {
    Write-Host 'Deploy cancelado.' -ForegroundColor Yellow
    exit 1
  }
}

function Invoke-NpmStep {
  param(
    [string]$Label,
    [string[]]$NpmArgs
  )

  Write-Host ''
  Write-Host "$Label..." -ForegroundColor Cyan
  if ($paths.NpmCmd) {
    & $paths.NpmCmd @NpmArgs
  } else {
    npm @NpmArgs
  }
  if ($LASTEXITCODE -ne 0) {
    throw "$Label falhou (exit $LASTEXITCODE)."
  }
}

try {
  if ($plan.Backup) {
    Write-Host ''
    Write-Host 'Backup do banco cervejaria...' -ForegroundColor Cyan
    & "$PSScriptRoot\backup-db.ps1"
    if ($LASTEXITCODE -ne 0) { throw 'Backup falhou.' }
  }

  if ($plan.BuildFE) {
    Invoke-NpmStep -Label 'Build frontend (vite)' -NpmArgs @('run', 'build:deploy', '--prefix', 'frontend')
    $frontendIndex = Join-Path $paths.ProjectRoot 'frontend\dist\index.html'
    if (-not (Test-Path $frontendIndex)) {
      throw 'frontend/dist/index.html nao encontrado apos build.'
    }
  }

  if ($plan.BuildBE) {
    Invoke-NpmStep -Label 'Build backend (tsc)' -NpmArgs @('run', 'build', '--prefix', 'backend')
    if (-not (Test-Path $paths.ApiEntry)) {
      throw 'backend/dist/index.js nao encontrado apos build.'
    }
  } elseif (-not (Test-Path $paths.ApiEntry)) {
    throw 'backend/dist ausente. Rode build do backend ou use deploy completo.'
  }

  if ($paths.ServeFrontendFromApi) {
    $frontendIndex = Join-Path $paths.ProjectRoot 'frontend\dist\index.html'
    if (-not (Test-Path $frontendIndex)) {
      throw 'Frontend dist ausente. Build do frontend e obrigatorio em ServeFrontendFromApi.'
    }
  }

  if ($plan.Migrate) {
    Invoke-NpmStep -Label 'Migrations (producao)' -NpmArgs @('run', 'db:migrate:prod')
  }

  Write-Host ''
  Write-Host 'Reiniciando API...' -ForegroundColor Cyan
  & "$PSScriptRoot\restart-api.ps1" -Quiet
  if ($LASTEXITCODE -ne 0) { throw 'Restart da API falhou.' }

  Write-Host ''
  Write-Host 'Smoke test...' -ForegroundColor Cyan
  $readyOk = Test-ApiHealthy -HealthUrl $paths.ReadyUrl -Retries 5
  $frontendOk = Test-FrontendHealthy -FrontendUrl $paths.FrontendUrl -Retries 3

  Write-Host "  /api/ready : $(if ($readyOk) { 'OK' } else { 'FALHOU' })" -ForegroundColor $(if ($readyOk) { 'Green' } else { 'Red' })
  Write-Host "  /          : $(if ($frontendOk) { 'OK' } else { 'FALHOU' })" -ForegroundColor $(if ($frontendOk) { 'Green' } else { 'Red' })

  if (-not $readyOk -or -not $frontendOk) {
    Write-Host ''
    Write-Host "Deploy concluido com falha no smoke test. Veja $($paths.ApiErrLog)" -ForegroundColor Red
    exit 1
  }

  Write-Host ''
  Write-Host 'Deploy concluido com sucesso.' -ForegroundColor Green
  Write-Host "  Local:  http://127.0.0.1:$($paths.ApiPort)"
  Write-Host '  Publico: https://tap.quivercloud.com.br'
  Write-Host ''
  & "$PSScriptRoot\status.ps1"
  exit 0
} catch {
  Write-Host ''
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host 'Deploy abortado. Producao pode estar parcialmente atualizada — verifique npm run prod:status' -ForegroundColor Yellow
  exit 1
}
