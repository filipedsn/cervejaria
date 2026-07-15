# Cria usuarios Postgres segregados (cervejaria_prod / cervejaria_dev) no container existente.

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$prodPass = 'QvPr0d_xK9m2026'
$devPass = 'QvDev_pL4n2026'

Write-Host 'Criando usuarios Postgres segregados...' -ForegroundColor Cyan

Get-Content (Join-Path $ProjectRoot 'deploy\db\create-env-users-prod.sql') -Raw |
  docker exec -i cervejaria-db psql -U cervejaria -d cervejaria -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { exit 1 }

Get-Content (Join-Path $ProjectRoot 'deploy\db\create-env-users-dev.sql') -Raw |
  docker exec -i cervejaria-db psql -U cervejaria -d cervejaria_dev -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { exit 1 }

function Update-DatabaseUrl {
  param(
    [string]$EnvFile,
    [string]$User,
    [string]$Password,
    [string]$Database
  )
  if (-not (Test-Path $EnvFile)) { return }
  $escaped = [uri]::EscapeDataString($Password)
  $newUrl = "postgresql://${User}:${escaped}@localhost:5432/${Database}?schema=public"
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
  -User 'cervejaria_prod' -Password $prodPass -Database 'cervejaria'
Update-DatabaseUrl -EnvFile (Join-Path $ProjectRoot 'backend\.env.development') `
  -User 'cervejaria_dev' -Password $devPass -Database 'cervejaria_dev'

Write-Host 'Usuarios Postgres segregados criados.' -ForegroundColor Green
