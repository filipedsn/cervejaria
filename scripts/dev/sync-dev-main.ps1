# Traz a versao oficial (origin/main) para o ambiente de testes (DEV):
# fast-forward da main local, dependencias quando o lockfile muda, migrations
# no banco DEV (cervejaria_dev :5434, via run-with-env) e reinicio do DEV.
# So roda com o PC na main e sem alteracoes em arquivos versionados; arquivos
# novos nao versionados ficam intocados.

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"
# PS 5.1 transforma stderr de comando nativo em erro fatal com 'Stop'; daqui em
# diante cada passo confere $LASTEXITCODE.
$ErrorActionPreference = 'Continue'

$paths = Get-DevPaths
$root = $paths.ProjectRoot

function Fail([string]$Message) {
  [Console]::Error.WriteLine($Message)
  exit 1
}

function Invoke-Git {
  $output = & git -C $root @args 2>&1
  if ($LASTEXITCODE -ne 0) { Fail ("git {0}: {1}" -f ($args -join ' '), (($output | Select-Object -First 1) -join '')) }
  return $output
}

$branch = ([string](Invoke-Git rev-parse --abbrev-ref HEAD)).Trim()
if ($branch -ne 'main') { Fail "O PC está na pasta de trabalho '$branch', não na main; quem desenvolve precisa voltar para a main." }
if (Invoke-Git status --porcelain --untracked-files=no) { Fail 'Há alterações não salvas em arquivos do projeto neste PC; quem desenvolve precisa resolver antes.' }

$before = ([string](Invoke-Git rev-parse HEAD)).Trim()
Invoke-Git fetch --quiet origin main | Out-Null
Invoke-Git merge --ff-only --quiet origin/main | Out-Null
$after = ([string](Invoke-Git rev-parse HEAD)).Trim()
Write-DevLog -Paths $paths -Message "sync-dev-main: $before -> $after"

& (Join-Path $PSScriptRoot 'stop-dev.ps1') | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'Não foi possível desligar o ambiente de testes.' }

$changed = @()
if ($before -ne $after) { $changed = @(Invoke-Git diff --name-only $before $after) }
foreach ($dir in @('backend', 'frontend')) {
  $dirPath = Join-Path $root $dir
  if ($changed -contains "$dir/package-lock.json" -or -not (Test-Path (Join-Path $dirPath 'node_modules'))) {
    Push-Location $dirPath
    try {
      & $paths.NpmCmd ci --no-audit --no-fund *> (Join-Path $paths.LogDir "sync-dev-npm-$dir.log")
      if ($LASTEXITCODE -ne 0) { Fail "Falha ao instalar as dependências de $dir (veja deploy/logs/sync-dev-npm-$dir.log)." }
    } finally {
      Pop-Location
    }
  }
}

$migrateLog = Join-Path $paths.LogDir 'sync-dev-migrate.log'
Push-Location $paths.BackendDir
try {
  & $paths.NodeExe scripts/run-with-env.mjs development npx prisma migrate deploy *> $migrateLog
  $migrateCode = $LASTEXITCODE
} finally {
  Pop-Location
}
if ($migrateCode -ne 0) {
  $tail = (Get-Content -LiteralPath $migrateLog -Tail 3 -ErrorAction SilentlyContinue) -join ' '
  Fail "Falha ao aplicar as mudanças no banco de testes: $tail"
}

& (Join-Path $PSScriptRoot 'supervisor.ps1') | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'O código foi atualizado, mas o ambiente de testes não ligou; use Ligar no painel.' }

Write-Output "DEV_SYNCED=$after"
exit 0
