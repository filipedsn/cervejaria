# Remove banco cervejaria_dev do container de producao (apos dev validado em :5434).

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $PSScriptRoot '_containers.ps1')

Write-Host '=== Limpar vestigios de dev no container de producao ===' -ForegroundColor Cyan
Write-Host 'ATENCAO: remove cervejaria_dev e usuario cervejaria_dev do container prod.' -ForegroundColor Yellow
Assert-DbProdContainer

$sql = Join-Path $ProjectRoot 'deploy\db\drop-dev-from-prod.sql'
Get-Content $sql -Raw | docker exec -i $DbProdContainer psql -U cervejaria -d postgres -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host 'SUCESSO: dev removido do container de producao.' -ForegroundColor Green
