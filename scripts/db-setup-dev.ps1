# Cria o banco cervejaria_dev e aplica migrations + seed de demonstracao.

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

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

Write-Host 'Verificando Postgres (Docker)...' -ForegroundColor Gray
$container = docker ps --filter 'name=cervejaria-db' --format '{{.Names}}' 2>$null
if (-not $container) {
  Write-Host 'Container cervejaria-db nao esta rodando. Subindo...' -ForegroundColor Yellow
  docker compose up -d postgres
  Start-Sleep -Seconds 5
}

Write-Host 'Criando banco cervejaria_dev (se nao existir)...' -ForegroundColor Gray
$exists = docker exec cervejaria-db psql -U cervejaria -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'cervejaria_dev'" 2>$null
if ($exists -ne '1') {
  docker exec cervejaria-db psql -U cervejaria -d postgres -c 'CREATE DATABASE cervejaria_dev;'
  Write-Host 'Banco cervejaria_dev criado.' -ForegroundColor Green
} else {
  Write-Host 'Banco cervejaria_dev ja existe.' -ForegroundColor Green
}

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
Write-Host '  Banco: cervejaria_dev' -ForegroundColor Gray
Write-Host '  Login demo: dono@demo.com / 123456' -ForegroundColor Gray
Write-Host '  Inicie com: npm run restart' -ForegroundColor Gray
Write-Host ''
