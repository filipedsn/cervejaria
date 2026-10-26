# Troca o codigo do ambiente de testes (DEV) para uma versao exata, na pasta
# propria do DEV (git worktree ao lado da pasta principal, criada na primeira vez).
# A pasta de trabalho de quem desenvolve nao muda.
#   -Kind main : versao oficial (origin/main)
#   -Kind prd  : a versao que esta no site (precisa fazer parte da main)
#   -Kind pr   : a ultima versao de um PR aberto, para testar antes de aceitar
# Passos: busca no GitHub, desliga o DEV, troca o codigo, dependencias quando o
# lockfile muda, migrations no banco DEV (cervejaria_dev :5434, via run-with-env)
# e liga o DEV de novo. -SkipMigrate quando o banco vai ser copiado do site em seguida.

param(
  [Parameter(Mandatory = $true)][string]$Sha,
  [ValidateSet('main', 'prd', 'pr')][string]$Kind = 'main',
  [int]$Pr = 0,
  [switch]$SkipMigrate
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"
# PS 5.1 transforma stderr de comando nativo em erro fatal com 'Stop'; daqui em
# diante cada passo confere $LASTEXITCODE.
$ErrorActionPreference = 'Continue'

$paths = Get-DevPaths
$root = $paths.ProjectRoot
$code = $paths.DevCodeRoot

function Fail([string]$Message) {
  [Console]::Error.WriteLine($Message)
  exit 1
}

function Invoke-Git([string]$Dir) {
  $gitArgs = $args
  $output = & git -C $Dir @gitArgs 2>&1
  if ($LASTEXITCODE -ne 0) { Fail ("git {0}: {1}" -f ($gitArgs -join ' '), (($output | Select-Object -First 1) -join '')) }
  return $output
}

if ($Sha -notmatch '^[0-9a-f]{40}$') { Fail 'Versão inválida (SHA de 40 caracteres).' }
if ($Kind -eq 'pr' -and $Pr -le 0) { Fail 'Número do PR inválido.' }

# 1. Traz a versao do GitHub (a pasta do DEV compartilha o repositorio da principal)
Invoke-Git $root fetch --quiet origin main | Out-Null
if ($Kind -eq 'pr') {
  Invoke-Git $root fetch --quiet origin "+refs/pull/${Pr}/head:refs/remotes/origin/pr/${Pr}" | Out-Null
  $head = ([string](Invoke-Git $root rev-parse "refs/remotes/origin/pr/${Pr}")).Trim()
  if ($head -ne $Sha) { Fail "O PR #$Pr recebeu mudanças depois da conferência. Clique em Recarregar no topo e tente de novo." }
} else {
  & git -C $root merge-base --is-ancestor $Sha origin/main 2>$null
  if ($LASTEXITCODE -ne 0) { Fail 'Essa versão não faz parte da versão oficial (main).' }
}

# 2. Pasta propria do DEV
$created = $false
if (Test-Path -LiteralPath (Join-Path $code '.git')) {
  if (Invoke-Git $code status --porcelain --untracked-files=no) {
    Fail "Há alterações feitas à mão na pasta do ambiente de testes ($code); quem desenvolve precisa desfazê-las."
  }
  $before = ([string](Invoke-Git $code rev-parse HEAD)).Trim()
} elseif (Test-Path -LiteralPath $code) {
  Fail "A pasta $code já existe e não é a pasta do ambiente de testes; quem desenvolve precisa movê-la."
} else {
  $before = ''
}

# 3. Desliga o DEV (libera node_modules e o motor do Prisma)
& (Join-Path $PSScriptRoot 'stop-dev.ps1') | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'Não foi possível desligar o ambiente de testes.' }

# 4. Troca o codigo
if ($before) {
  Invoke-Git $code checkout --quiet --detach $Sha | Out-Null
} else {
  Invoke-Git $root worktree add --quiet --detach $code $Sha | Out-Null
  $created = $true
}
$paths = Get-DevPaths
if ($paths.CodeRoot -ne $code) { Fail "A pasta do ambiente de testes ($code) não ficou pronta." }
Write-DevLog -Paths $paths -Message "switch-dev-code: kind=$Kind pr=$Pr $before -> $Sha"

# 5. Configuracao local (fora do git) vem da pasta principal
Copy-DevEnvToCode -Paths $paths

# 6. Dependencias
$changed = @()
if ($before -and $before -ne $Sha) { $changed = @(Invoke-Git $code diff --name-only $before $Sha) }
foreach ($dir in @('backend', 'frontend')) {
  $dirPath = Join-Path $code $dir
  if ($created -or $changed -contains "$dir/package-lock.json" -or -not (Test-Path (Join-Path $dirPath 'node_modules'))) {
    Push-Location $dirPath
    try {
      & $paths.NpmCmd ci --no-audit --no-fund *> (Join-Path $paths.LogDir "switch-dev-npm-$dir.log")
      if ($LASTEXITCODE -ne 0) { Fail "Falha ao instalar as dependências de $dir (veja deploy/logs/switch-dev-npm-$dir.log). Use Ligar para tentar de novo." }
    } finally {
      Pop-Location
    }
  }
}
Push-Location $paths.CodeBackendDir
try {
  & $paths.NpmCmd exec prisma generate *> (Join-Path $paths.LogDir 'switch-dev-prisma.log')
  if ($LASTEXITCODE -ne 0) { Fail 'Falha ao preparar o acesso ao banco (veja deploy/logs/switch-dev-prisma.log).' }
} finally {
  Pop-Location
}

$label = @{ main = 'versão oficial'; prd = 'versão do site'; pr = "PR #$Pr" }[$Kind]
$marker = [ordered]@{ sha = $Sha; kind = $Kind; pr = $(if ($Kind -eq 'pr') { $Pr } else { $null }); at = (Get-Date).ToUniversalTime().ToString('o') }
[IO.File]::WriteAllText($paths.DevCodeFile, ($marker | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))

# 7. Migrations no banco DEV
$migrateError = ''
if (-not $SkipMigrate) {
  $migrateLog = Join-Path $paths.LogDir 'switch-dev-migrate.log'
  Push-Location $paths.CodeBackendDir
  try {
    & $paths.NodeExe scripts/run-with-env.mjs development npx prisma migrate deploy *> $migrateLog
    if ($LASTEXITCODE -ne 0) { $migrateError = (Get-Content -LiteralPath $migrateLog -Tail 3 -ErrorAction SilentlyContinue) -join ' ' }
  } finally {
    Pop-Location
  }
}

# 8. Liga o DEV
& (Join-Path $PSScriptRoot 'supervisor.ps1') | Out-Null
$started = $LASTEXITCODE -eq 0
if ($migrateError) {
  Fail "O ambiente de testes está com a $label, mas as mudanças no banco de testes falharam: $migrateError. Se o banco de testes tem mudanças de outro teste, use Igualar ao site com a cópia do banco."
}
if (-not $started) { Fail "O código foi trocado para a $label, mas o ambiente de testes não ligou; use Ligar no painel." }

Write-Output "DEV_CODE=$Sha kind=$Kind"
exit 0
