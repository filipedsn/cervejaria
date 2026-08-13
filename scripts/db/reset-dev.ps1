# Zera o banco cervejaria_dev (container dedicado) e repopula com seed demo.

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $ProjectRoot
. (Join-Path $PSScriptRoot '_containers.ps1')

Write-Host ''
Write-Host 'Quiver Tap - Reset banco de desenvolvimento' -ForegroundColor Cyan
Write-Host '============================================' -ForegroundColor Cyan
Write-Host 'ATENCAO: apaga TODOS os dados de cervejaria_dev e roda seed demo.' -ForegroundColor Yellow
Write-Host ''

Assert-DbDevContainer

Push-Location (Join-Path $ProjectRoot 'backend')

Write-Host 'Recriando schema (migrate reset)...' -ForegroundColor Cyan
node scripts/run-with-env.mjs development npx prisma migrate reset --force
if ($LASTEXITCODE -ne 0) {
  Pop-Location
  Write-Host 'Reset falhou.' -ForegroundColor Red
  exit 1
}

Write-Host 'Reaplicando permissoes do usuario cervejaria_dev...' -ForegroundColor Cyan
$sql = Join-Path $ProjectRoot 'deploy\db\create-env-users-dev-container.sql'
Get-Content $sql -Raw | docker exec -i $DbDevContainer psql -U cervejaria -d $DbDevName -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) {
  Pop-Location
  Write-Host 'Grants falharam.' -ForegroundColor Red
  exit 1
}

Pop-Location

Write-Host ''
Write-Host 'Dev resetado:' -ForegroundColor Green
Write-Host "  Container: $DbDevContainer (porta $DbDevPort)" -ForegroundColor Gray
Write-Host '  Login demo: dono@demo.com / 123456' -ForegroundColor Gray
Write-Host ''
