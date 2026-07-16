# Copia dados de producao (cervejaria) para desenvolvimento (cervejaria_dev).
# Sobrescreve completamente o banco dev.

param(
  [switch]$Confirmed
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"

function Assert-PostgresContainer {
  $container = docker ps --filter 'name=cervejaria-db' --format '{{.Names}}' 2>$null
  if (-not $container) {
    throw 'Container cervejaria-db nao esta rodando. Execute: npm run db:up'
  }
}

Write-Host '=== Copiar producao -> desenvolvimento ===' -ForegroundColor Cyan
Write-Host 'ATENCAO: todos os dados de cervejaria_dev serao substituidos.' -ForegroundColor Yellow
Assert-PostgresContainer

$settings = Get-QuiverTapSettings
$paths = Resolve-QuiverTapPaths -Settings $settings

Write-Host ''
Write-Host '1/4 Parando ambiente dev (libera conexoes)...' -ForegroundColor Yellow
& "$PSScriptRoot\..\dev\stop-dev.ps1"

$backupDir = Join-Path $paths.ProjectRoot 'deploy\backups'
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

$timestamp = Get-Date -Format 'yyyy-MM-dd-HHmmss'
$dumpFile = Join-Path $backupDir "sync-prod-to-dev-$timestamp.sql"

Write-Host ''
Write-Host '2/4 Gerando dump de producao (cervejaria)...' -ForegroundColor Yellow
docker exec cervejaria-db pg_dump -U cervejaria -d cervejaria --no-owner --no-acl |
  Out-File -FilePath $dumpFile -Encoding utf8

$sizeKb = [math]::Round((Get-Item $dumpFile).Length / 1024, 1)
Write-Host "Dump salvo: $dumpFile ($sizeKb KB)" -ForegroundColor Gray

Write-Host ''
Write-Host '3/4 Preparando banco cervejaria_dev...' -ForegroundColor Yellow
$exists = docker exec cervejaria-db psql -U cervejaria -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'cervejaria_dev'" 2>$null
if (-not ($exists -match '1')) {
  Write-Host 'Criando banco cervejaria_dev...' -ForegroundColor Gray
  docker exec cervejaria-db psql -U cervejaria -d postgres -c 'CREATE DATABASE cervejaria_dev OWNER cervejaria;' | Out-Null
} else {
  docker exec cervejaria-db psql -U cervejaria -d postgres -c `
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'cervejaria_dev' AND pid <> pg_backend_pid();" | Out-Null
  docker exec cervejaria-db psql -U cervejaria -d cervejaria_dev -c `
    'DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO cervejaria; GRANT ALL ON SCHEMA public TO public;' | Out-Null
}

Write-Host ''
Write-Host '4/4 Restaurando dump em cervejaria_dev...' -ForegroundColor Yellow
$containerDump = "/tmp/sync-prod-to-dev-$timestamp.sql"
docker cp $dumpFile "cervejaria-db:$containerDump"
docker exec cervejaria-db psql -U cervejaria -d cervejaria_dev -v ON_ERROR_STOP=1 -f $containerDump
if ($LASTEXITCODE -ne 0) {
  docker exec cervejaria-db rm -f $containerDump 2>$null | Out-Null
  throw "Restauracao falhou (exit $LASTEXITCODE). Dump local: $dumpFile"
}
docker exec cervejaria-db rm -f $containerDump 2>$null | Out-Null

Write-Host ''
Write-Host 'SUCESSO: cervejaria_dev agora espelha producao.' -ForegroundColor Green
Write-Host 'Use "Iniciar dev" no painel para subir API e Vite novamente.' -ForegroundColor Gray
