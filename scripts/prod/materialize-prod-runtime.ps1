# Materializa runtime isolado de producao (node_modules + Prisma Client) em prod-artifacts/backend.
# Nao reinicia a API. Use prod:restart apos materializar para carregar o runtime novo.

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"
. "$PSScriptRoot\publish-artifacts.ps1"

$settings = Get-QuiverTapSettings
$paths = Resolve-QuiverTapPaths -Settings $settings

if (-not (Test-Path $paths.ProdApiEntry)) {
  Write-Host ('ProdApiEntry ausente: ' + $paths.ProdApiEntry) -ForegroundColor Red
  Write-Host 'Artefatos de producao ausentes. Execute deploy completo ou copie backend/dist para prod-artifacts.' -ForegroundColor Red
  exit 1
}

Write-Host 'Materializando runtime isolado de producao...' -ForegroundColor Cyan
$linkedToDev = Test-ProdNodeModulesLinkedToDev -Paths $paths
$missingRuntime = -not (Test-Path (Join-Path $paths.ProdBackendNodeModules '.prisma\client\index.js'))
Install-ProdBackendRuntime -Paths $paths -ForceRefresh:($linkedToDev -or $missingRuntime) -RefreshPrismaSchema

Write-Host 'Verificando sincronia schema x banco...' -ForegroundColor Cyan
try {
  Assert-ProdDatabaseSchemaSync -Paths $paths
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  exit 1
}

Write-Host 'Runtime de producao materializado em deploy/prod-artifacts/backend.' -ForegroundColor Green
Write-Host 'Reinicie a API para aplicar: npm run prod:restart' -ForegroundColor Yellow
