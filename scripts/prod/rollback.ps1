# Volta producao para a release anterior preservada em deploy/prod-artifacts.previous.
#
# O rollback e reversivel: a release que sai do ar toma o lugar da anterior, entao
# rodar rollback duas vezes devolve exatamente o estado em que voce comecou.
#
# NAO reverte banco de dados. Migration aplicada continua aplicada — se o deploy que
# voce esta desfazendo rodou migration destrutiva, restaure o dump de deploy/backups.

param(
  [switch]$Confirmed,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"
. "$PSScriptRoot\publish-artifacts.ps1"

$settings = Get-QuiverTapSettings
$paths = Resolve-QuiverTapPaths -Settings $settings

Set-Location $paths.ProjectRoot

$previous = $paths.ProdArtifactsPrevious
$previousFrontend = Join-Path $previous 'frontend'
$previousBackend = Join-Path $previous 'backend'
$previousManifest = Join-Path $previous 'manifest.json'
$previousMeta = Join-Path $previous 'rollback-point.json'
$rollbackStartedAt = $null
$rollbackResult = 'FAILED'
$rollbackSmoke = 'NOT_RUN'
$rollbackError = $null

function Read-JsonFile {
  param([string]$Path)

  if (-not (Test-Path $Path)) { return $null }
  try {
    return Get-Content $Path -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Format-Release {
  param($Manifest)

  if (-not $Manifest) { return 'desconhecida (sem manifest)' }
  $sha = if ($Manifest.gitSha) { $Manifest.gitSha } else { 'unknown' }
  $at = if ($Manifest.deployedAt) { $Manifest.deployedAt } else { 'data desconhecida' }
  return "$sha  ($at)"
}

$hasFrontend = Test-Path (Join-Path $previousFrontend 'index.html')
$hasBackend = Test-Path (Join-Path $previousBackend 'dist\index.js')

Write-Host ''
Write-Host 'Quiver Tap - Rollback de producao' -ForegroundColor Cyan
Write-Host '=================================' -ForegroundColor Cyan
Write-Host "Artefatos:  $($paths.ProdArtifactsDir)"
Write-Host "Release anterior: $previous"
Write-Host ''

if (-not (Test-Path $previous) -or (-not $hasFrontend -and -not $hasBackend)) {
  Write-Host 'Nenhuma release anterior preservada.' -ForegroundColor Red
  Write-Host 'O rollback so fica disponivel depois do primeiro deploy feito com esta versao' -ForegroundColor Yellow
  Write-Host 'do publish-artifacts.ps1, que move a release antiga para prod-artifacts.previous.' -ForegroundColor Yellow
  exit 1
}

$current = Read-JsonFile $paths.ProdManifest
$target = Read-JsonFile $previousManifest
$meta = Read-JsonFile $previousMeta

Write-Host "No ar agora:  $(Format-Release $current)"
Write-Host "Voltar para:  $(Format-Release $target)"
Write-Host "Partes salvas: $(if ($meta -and $meta.parts) { ($meta.parts -join ', ') } else { 'frontend/backend conforme disponivel' })"
if ($meta -and $meta.savedAt) {
  Write-Host "Preservada em: $($meta.savedAt)"
}
Write-Host ''
Write-Host 'ATENCAO: o banco de dados NAO e revertido. Migrations aplicadas continuam aplicadas.' -ForegroundColor Yellow
Write-Host ''

if ($DryRun) {
  Write-Host 'Dry-run: nenhuma acao executada.' -ForegroundColor Yellow
  Write-Host "  frontend disponivel: $(if ($hasFrontend) { 'sim' } else { 'nao' })"
  Write-Host "  backend disponivel:  $(if ($hasBackend) { 'sim' } else { 'nao' })"
  exit 0
}

if (-not $Confirmed) {
  $answer = Read-Host 'Digite ROLLBACK para voltar producao para a release anterior'
  if ($answer -ne 'ROLLBACK') {
    Write-Host 'Rollback cancelado.' -ForegroundColor Yellow
    exit 1
  }
}

$rollbackStartedAt = (Get-Date).ToUniversalTime()

$swap = "$previous.swap"
$restored = @()

try {
  if (Test-Path $swap) {
    Remove-Item -Path $swap -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $swap | Out-Null

  # A release atual vira o novo ponto de rollback, para que a operacao seja reversivel.
  if (Test-Path $paths.ProdManifest) {
    Copy-Item -Path $paths.ProdManifest -Destination (Join-Path $swap 'manifest.json') -Force
  }

  if ($hasFrontend) {
    if (Test-Path $paths.ProdFrontendDist) {
      Move-Item -Path $paths.ProdFrontendDist -Destination (Join-Path $swap 'frontend')
    }
    Move-Item -Path $previousFrontend -Destination $paths.ProdFrontendDist
    $restored += 'frontend'
  }

  if ($hasBackend) {
    $liveBackendRoot = Join-Path $paths.ProdArtifactsDir 'backend'
    if (Test-Path $liveBackendRoot) {
      Move-Item -Path $liveBackendRoot -Destination (Join-Path $swap 'backend')
    }
    Move-Item -Path $previousBackend -Destination $liveBackendRoot
    $restored += 'backend'
  }

  if (Test-Path $previousManifest) {
    Copy-Item -Path $previousManifest -Destination $paths.ProdManifest -Force
  }

  Remove-Item -Path $previous -Recurse -Force
  Move-Item -Path $swap -Destination $previous
  Write-ProdRollbackMeta -PreviousDir $previous -Parts $restored

  Write-Host "Artefatos restaurados: $($restored -join ', ')" -ForegroundColor Green

  # O node_modules volta junto no move, mas se a release antiga foi materializada com
  # outro schema o client precisa ser regerado antes de subir a API.
  Ensure-ProdBackendRuntime -Paths $paths

  $artifactErrors = Test-ProdArtifactsReady -Paths $paths
  if ($artifactErrors.Count -gt 0) {
    throw ($artifactErrors -join '; ')
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

  $record = [ordered]@{
    rolledBackAt = (Get-Date).ToUniversalTime().ToString('o')
    fromGitSha   = if ($current) { $current.gitSha } else { 'unknown' }
    toGitSha     = if ($target) { $target.gitSha } else { 'unknown' }
    parts        = $restored
    smokeOk      = ($readyOk -and $frontendOk)
  }
  $record | ConvertTo-Json -Depth 4 | Set-Content -Path (Join-Path $paths.RuntimeDir 'last-rollback.json') -Encoding UTF8

  $rollbackSmoke = if ($readyOk -and $frontendOk) { 'PASS' } else { 'FAIL' }

  if (-not $readyOk -or -not $frontendOk) {
    $rollbackError = 'Smoke test falhou para /api/ready ou frontend.'
    Write-Host ''
    Write-Host "Rollback aplicado, mas o smoke test falhou. Veja $($paths.ApiErrLog)" -ForegroundColor Red
    exit 1
  }

  Write-Host ''
  Write-Host "Rollback concluido: producao esta em $(Format-Release $target)." -ForegroundColor Green
  Write-Host 'Rodar rollback de novo devolve a release que acabou de sair do ar.' -ForegroundColor Cyan
  $rollbackResult = 'SUCCESS'
  Write-Host ''
  & "$PSScriptRoot\status.ps1"
  exit 0
} catch {
  $rollbackError = $_.Exception.Message
  Write-Host ''
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host "Rollback abortado. Verifique $($paths.ProdArtifactsDir) e $swap antes de tentar de novo." -ForegroundColor Yellow
  Write-Host 'npm run prod:status mostra o estado atual.' -ForegroundColor Yellow
  exit 1
} finally {
  if ($rollbackStartedAt) {
    $finishedAt = (Get-Date).ToUniversalTime()
    $event = [ordered]@{
      id = "rollback-$($rollbackStartedAt.ToString('yyyyMMddTHHmmssfffZ'))-$PID"
      type = 'ROLLBACK'
      startedAt = $rollbackStartedAt.ToString('o')
      finishedAt = $finishedAt.ToString('o')
      durationSeconds = [math]::Round(($finishedAt - $rollbackStartedAt).TotalSeconds, 3)
      removedGitSha = if ($current) { $current.gitSha } else { $null }
      restoredGitSha = if ($target) { $target.gitSha } else { $null }
      result = $rollbackResult
      smoke = $rollbackSmoke
      errorSummary = if ($rollbackResult -ne 'SUCCESS') { Get-SafeRecoveryErrorSummary -Message $rollbackError } else { $null }
    }
    [void](Add-ReleaseHistoryEvent -Paths $paths -Event $event)
  }
}
