# Copia dados de producao (cervejaria-db) para desenvolvimento (cervejaria-db-dev).

param(
  [switch]$Confirmed
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"
. (Join-Path (Split-Path $PSScriptRoot -Parent) 'db\_containers.ps1')

Write-Host '=== Copiar producao -> desenvolvimento ===' -ForegroundColor Cyan
Write-Host 'ATENCAO: todos os dados de cervejaria_dev serao substituidos.' -ForegroundColor Yellow
Assert-DbContainers

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
docker exec $DbProdContainer pg_dump -U cervejaria -d cervejaria --no-owner --no-acl -f $containerDump
if ($LASTEXITCODE -ne 0) { throw 'pg_dump falhou.' }
docker cp "${DbProdContainer}:$containerDump" $dumpFile
if ($LASTEXITCODE -ne 0) { throw "Falha ao copiar dump para $dumpFile" }

$sizeKb = [math]::Round((Get-Item $dumpFile).Length / 1024, 1)
Write-Host "Dump salvo: $dumpFile ($sizeKb KB)" -ForegroundColor Gray

Write-Host ''
Write-Host '3/5 Preparando banco cervejaria_dev no container dev...' -ForegroundColor Yellow
docker exec $DbDevContainer psql -U cervejaria -d postgres -c `
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DbDevName' AND pid <> pg_backend_pid();" | Out-Null
docker exec $DbDevContainer psql -U cervejaria -d $DbDevName -c `
  'DROP SCHEMA IF EXISTS quiosque CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO cervejaria; GRANT ALL ON SCHEMA public TO public;' | Out-Null

Write-Host ''
Write-Host '4/5 Restaurando dump em cervejaria_dev (container dev)...' -ForegroundColor Yellow
docker cp $dumpFile "${DbDevContainer}:$containerDump"
if ($LASTEXITCODE -ne 0) { throw 'Falha ao copiar dump para container dev.' }
docker exec $DbDevContainer psql -U cervejaria -d $DbDevName -v ON_ERROR_STOP=1 -f $containerDump
$restoreExitCode = $LASTEXITCODE
if ($restoreExitCode -ne 0) {
  docker exec $DbDevContainer rm -f $containerDump 2>$null | Out-Null
  throw "Restauracao falhou (exit $restoreExitCode). Dump local: $dumpFile"
}
docker exec $DbDevContainer rm -f $containerDump 2>$null | Out-Null
docker exec $DbProdContainer rm -f $containerDump 2>$null | Out-Null

Write-Host ''
Write-Host '5/5 Aplicando permissoes cervejaria_dev...' -ForegroundColor Yellow
$grantsFile = Join-Path $paths.ProjectRoot 'deploy\db\create-env-users-dev-container.sql'
if (-not (Test-Path $grantsFile)) {
  throw "Arquivo de grants nao encontrado: $grantsFile"
}
$devPass = $env:QUIVER_DEV_DB_PASSWORD
if ([string]::IsNullOrWhiteSpace($devPass)) {
  Import-BackendEnvFile -BackendDir $paths.BackendDir -Environment development
  $devDatabaseUri = [Uri]$env:DATABASE_URL
  $devCredentials = $devDatabaseUri.UserInfo.Split(':', 2)
  if ($devCredentials.Count -ne 2 -or [string]::IsNullOrWhiteSpace($devCredentials[1])) {
    throw 'Nao foi possivel obter a senha de cervejaria_dev em backend/.env.development.'
  }
  $devPass = [Uri]::UnescapeDataString($devCredentials[1])
}
Get-Content $grantsFile -Raw | docker exec -i $DbDevContainer psql -U cervejaria -d $DbDevName -v ON_ERROR_STOP=1 -v "DEV_PASSWORD=$devPass" | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw 'Falha ao aplicar grants em cervejaria_dev.'
}

Write-Host ''
Write-Host 'SUCESSO: cervejaria_dev agora espelha producao.' -ForegroundColor Green
Write-Host 'Use "Iniciar dev" no painel para subir API e Vite novamente.' -ForegroundColor Gray
