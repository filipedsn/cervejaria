# Backup do banco de producao (cervejaria) via Docker.

param(
  [string]$DestinationDir = ''
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"

function Assert-PostgresContainer {
  $container = docker ps --filter 'name=cervejaria-db' --format '{{.Names}}' 2>$null
  if (-not $container) {
    throw 'Container cervejaria-db nao esta rodando. Execute: npm run db:up'
  }
}

function Resolve-BackupDirectory {
  param(
    [string]$RequestedDir,
    [string]$ProjectRoot
  )

  if (-not $RequestedDir) {
    return Join-Path $ProjectRoot 'deploy\backups'
  }

  $resolved = [System.IO.Path]::GetFullPath($RequestedDir)
  if (-not (Test-Path $resolved)) {
    New-Item -ItemType Directory -Force -Path $resolved | Out-Null
  }
  if (-not (Test-Path $resolved -PathType Container)) {
    throw "Destino invalido (nao e uma pasta): $resolved"
  }
  return $resolved
}

Write-Host '=== Backup banco de producao ===' -ForegroundColor Cyan
Assert-PostgresContainer

$settings = Get-QuiverTapSettings
$paths = Resolve-QuiverTapPaths -Settings $settings
$backupDir = Resolve-BackupDirectory -RequestedDir $DestinationDir -ProjectRoot $paths.ProjectRoot
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

$timestamp = Get-Date -Format 'yyyy-MM-dd-HHmmss'
$outFile = Join-Path $backupDir "backup-prod-$timestamp.sql"

Write-Host "Origem: cervejaria (producao)" -ForegroundColor Gray
Write-Host "Destino: $outFile" -ForegroundColor Gray
Write-Host 'Gerando dump...' -ForegroundColor Yellow

docker exec cervejaria-db pg_dump -U cervejaria -d cervejaria --no-owner --no-acl |
  Out-File -FilePath $outFile -Encoding utf8

$size = (Get-Item $outFile).Length
$sizeKb = [math]::Round($size / 1024, 1)
Write-Host "Arquivo criado: $sizeKb KB" -ForegroundColor Green
Write-Host 'SUCESSO: backup de producao concluido.' -ForegroundColor Green
