# Cria usuarios Postgres segregados — prod no container prod, dev no container dev.

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
. (Join-Path $PSScriptRoot 'db\_containers.ps1')

$prodPass = $env:QUIVER_PROD_DB_PASSWORD
$devPass = $env:QUIVER_DEV_DB_PASSWORD
if ([string]::IsNullOrWhiteSpace($prodPass)) { throw 'Defina QUIVER_PROD_DB_PASSWORD no ambiente antes de executar.' }
if ([string]::IsNullOrWhiteSpace($devPass)) { throw 'Defina QUIVER_DEV_DB_PASSWORD no ambiente antes de executar.' }

Write-Host 'Criando usuarios Postgres segregados...' -ForegroundColor Cyan

Assert-DbProdContainer
Get-Content (Join-Path $ProjectRoot 'deploy\db\create-env-users-prod-only.sql') -Raw |
  docker exec -i $DbProdContainer psql -U cervejaria -d cervejaria -v ON_ERROR_STOP=1 -v "PROD_PASSWORD=$prodPass"
if ($LASTEXITCODE -ne 0) { exit 1 }

Assert-DbDevContainer
Get-Content (Join-Path $ProjectRoot 'deploy\db\create-env-users-dev-container.sql') -Raw |
  docker exec -i $DbDevContainer psql -U cervejaria -d cervejaria_dev -v ON_ERROR_STOP=1 -v "DEV_PASSWORD=$devPass"
if ($LASTEXITCODE -ne 0) { exit 1 }

function Update-DatabaseUrl {
  param(
    [string]$EnvFile,
    [string]$User,
    [string]$Password,
    [string]$Database,
    [int]$Port
  )
  if (-not (Test-Path $EnvFile)) { return }
  $escaped = [uri]::EscapeDataString($Password)
  $newUrl = "postgresql://${User}:${escaped}@localhost:${Port}/${Database}?schema=public"
  $lines = Get-Content $EnvFile -Encoding UTF8
  $updated = $false
  $result = foreach ($line in $lines) {
    if ($line -match '^DATABASE_URL=') {
      $updated = $true
      "DATABASE_URL=`"$newUrl`""
    } else {
      $line
    }
  }
  if ($updated) {
    Set-Content -Path $EnvFile -Value $result -Encoding UTF8
    Write-Host "  Atualizado: $EnvFile" -ForegroundColor Green
  }
}

Update-DatabaseUrl -EnvFile (Join-Path $ProjectRoot 'backend\.env.production') `
  -User 'cervejaria_prod' -Password $prodPass -Database 'cervejaria' -Port $DbProdPort
Update-DatabaseUrl -EnvFile (Join-Path $ProjectRoot 'backend\.env.development') `
  -User 'cervejaria_dev' -Password $devPass -Database 'cervejaria_dev' -Port $DbDevPort

Write-Host 'Usuarios Postgres segregados criados.' -ForegroundColor Green
