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
Write-Host '1/5 Parando ambiente dev (libera conexoes)...' -ForegroundColor Yellow
& "$PSScriptRoot\..\dev\stop-dev.ps1"

$backupDir = Join-Path $paths.ProjectRoot 'deploy\backups'
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

$timestamp = Get-Date -Format 'yyyy-MM-dd-HHmmss'
$dumpFile = Join-Path $backupDir "sync-prod-to-dev-$timestamp.sql"

Write-Host ''
Write-Host '2/5 Gerando dump de producao (cervejaria)...' -ForegroundColor Yellow
$containerDump = "/tmp/sync-prod-to-dev-$timestamp.sql"
docker exec cervejaria-db pg_dump -U cervejaria -d cervejaria --no-owner --no-acl -f $containerDump
if ($LASTEXITCODE -ne 0) { throw 'pg_dump falhou.' }
docker cp "cervejaria-db:$containerDump" $dumpFile
if ($LASTEXITCODE -ne 0) { throw "Falha ao copiar dump para $dumpFile" }

$sizeKb = [math]::Round((Get-Item $dumpFile).Length / 1024, 1)
Write-Host "Dump salvo: $dumpFile ($sizeKb KB)" -ForegroundColor Gray

Write-Host ''
Write-Host '3/5 Preparando banco cervejaria_dev...' -ForegroundColor Yellow
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
Write-Host '4/5 Restaurando dump em cervejaria_dev...' -ForegroundColor Yellow
docker exec cervejaria-db psql -U cervejaria -d cervejaria_dev -v ON_ERROR_STOP=1 -f $containerDump
if ($LASTEXITCODE -ne 0) {
  docker exec cervejaria-db rm -f $containerDump 2>$null | Out-Null
  throw "Restauracao falhou (exit $LASTEXITCODE). Dump local: $dumpFile"
}
docker exec cervejaria-db rm -f $containerDump 2>$null | Out-Null

Write-Host ''
Write-Host '5/5 Aplicando permissoes cervejaria_dev...' -ForegroundColor Yellow
$grantsFile = Join-Path $paths.ProjectRoot 'deploy\db\create-env-users-dev.sql'
if (-not (Test-Path $grantsFile)) {
  throw "Arquivo de grants nao encontrado: $grantsFile"
}
Get-Content $grantsFile -Raw | docker exec -i cervejaria-db psql -U cervejaria -d cervejaria_dev -v ON_ERROR_STOP=1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw 'Falha ao aplicar grants em cervejaria_dev.'
}

Write-Host ''
Write-Host 'SUCESSO: cervejaria_dev agora espelha producao.' -ForegroundColor Green
Write-Host 'Use "Iniciar dev" no painel para subir API e Vite novamente.' -ForegroundColor Gray
