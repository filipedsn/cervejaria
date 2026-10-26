# Traz a versao oficial (origin/main) para o ambiente de testes (DEV), na pasta
# propria do DEV (switch-dev-code.ps1). A pasta de trabalho de quem desenvolve
# nao muda: pode estar em qualquer branch e com alteracoes.

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"
$ErrorActionPreference = 'Continue'

$paths = Get-DevPaths

& git -C $paths.ProjectRoot fetch --quiet origin main 2>$null
if ($LASTEXITCODE -ne 0) {
  [Console]::Error.WriteLine('Não foi possível buscar a versão oficial no GitHub; verifique a internet.')
  exit 1
}
$sha = ([string](& git -C $paths.ProjectRoot rev-parse origin/main)).Trim()

& (Join-Path $PSScriptRoot 'switch-dev-code.ps1') -Sha $sha -Kind main
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output "DEV_SYNCED=$sha"
exit 0
