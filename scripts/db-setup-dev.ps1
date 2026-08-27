# Cria o banco cervejaria_dev no container dedicado e aplica migrations + seed.

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot
. (Join-Path $PSScriptRoot 'db\_containers.ps1')

$NodePath = 'C:\Program Files\nodejs'
if (Test-Path $NodePath) { $env:Path = "$NodePath;$env:Path" }

Write-Host ''
Write-Host 'Quiver Tap - Setup banco de desenvolvimento' -ForegroundColor Cyan
Write-Host '=============================================' -ForegroundColor Cyan
Write-Host ''

$devEnv = Join-Path $ProjectRoot 'backend\.env.development'
if (-not (Test-Path $devEnv)) {
  $example = Join-Path $ProjectRoot 'backend\.env.development.example'
  if (Test-Path $example) {
    Copy-Item $example $devEnv
    Write-Host 'Criado backend/.env.development a partir do exemplo.' -ForegroundColor Yellow
  } else {
    Write-Host 'Arquivo backend/.env.development nao encontrado.' -ForegroundColor Red
    exit 1
  }
}

Write-Host 'Verificando Postgres dev (Docker)...' -ForegroundColor Gray
$devRunning = docker ps --filter "name=^${DbDevContainer}$" --format '{{.Names}}' 2>$null
if (-not $devRunning) {
  Write-Host "Container $DbDevContainer nao esta rodando. Subindo..." -ForegroundColor Yellow
  if ([string]::IsNullOrWhiteSpace($env:POSTGRES_DEV_PASSWORD)) {
    throw 'Defina POSTGRES_DEV_PASSWORD antes de subir o PostgreSQL de desenvolvimento.'
  }
  docker compose up -d postgres-dev
  Start-Sleep -Seconds 5
}

Assert-DbDevContainer
Write-Host "Banco dev no container $DbDevContainer (porta $DbDevPort)." -ForegroundColor Green

Push-Location (Join-Path $ProjectRoot 'backend')

Write-Host 'Aplicando migrations no banco de desenvolvimento...' -ForegroundColor Cyan
node scripts/run-with-env.mjs development npx prisma migrate deploy
if ($LASTEXITCODE -ne 0) {
  Pop-Location
  Write-Host 'Migrations falharam.' -ForegroundColor Red
  exit 1
}

Write-Host 'Populando dados de demonstracao (seed)...' -ForegroundColor Cyan
node scripts/run-with-env.mjs development npx tsx prisma/seed.ts
if ($LASTEXITCODE -ne 0) {
  Pop-Location
  Write-Host 'Seed falhou.' -ForegroundColor Red
  exit 1
}

Pop-Location

Write-Host ''
Write-Host 'Desenvolvimento pronto:' -ForegroundColor Green
Write-Host "  Container: $DbDevContainer" -ForegroundColor Gray
Write-Host "  Banco: $DbDevName (porta $DbDevPort)" -ForegroundColor Gray
Write-Host '  Login demo: dono@demo.com / 123456' -ForegroundColor Gray
Write-Host '  Inicie com: npm run dev:start' -ForegroundColor Gray
Write-Host ''
