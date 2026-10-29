# Troca o codigo do ambiente de testes (DEV) para uma versao exata, na propria
# pasta do projeto (o DEV roda dela):
#   -Kind main : versao oficial (volta para a branch main, atualizada com origin/main)
#   -Kind prd  : a versao que esta no site (precisa fazer parte da main)
#   -Kind pr   : a ultima versao de um PR aberto, para testar antes de aceitar
# Fora da versao oficial a pasta fica em "detached HEAD" nessa versao; nada se
# perde, as branches continuam como estao. So roda sem alteracoes em arquivos
# versionados (arquivos novos nao versionados ficam intocados).
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
$supervisor = Join-Path $PSScriptRoot 'supervisor.ps1'
$stopped = $false

function Fail([string]$Message) {
  # Depois de desligar, tenta deixar o DEV ligado com o codigo que estiver na pasta.
  if ($stopped) { & $supervisor | Out-Null }
  [Console]::Error.WriteLine($Message)
  exit 1
}

function Invoke-Git {
  $output = & git -C $root @args 2>&1
  if ($LASTEXITCODE -ne 0) { Fail ("git {0}: {1}" -f ($args -join ' '), (($output | Select-Object -First 1) -join '')) }
  return $output
}

if ($Sha -notmatch '^[0-9a-f]{40}$') { Fail 'Versão inválida (SHA de 40 caracteres).' }
if ($Kind -eq 'pr' -and $Pr -le 0) { Fail 'Número do PR inválido.' }

# 1. Pasta sem alteracoes em arquivos versionados
if (Invoke-Git status --porcelain --untracked-files=no) {
  Fail 'Há alterações não salvas em arquivos do projeto neste PC; quem desenvolve precisa salvá-las (commit) antes de trocar a versão do ambiente de testes.'
}

# 2. Traz a versao do GitHub e confere
Invoke-Git fetch --quiet origin main | Out-Null
$originMain = ([string](Invoke-Git rev-parse origin/main)).Trim()
if ($Kind -eq 'pr') {
  Invoke-Git fetch --quiet origin "+refs/pull/${Pr}/head:refs/remotes/origin/pr/${Pr}" | Out-Null
  $head = ([string](Invoke-Git rev-parse "refs/remotes/origin/pr/${Pr}")).Trim()
  if ($head -ne $Sha) { Fail "O PR #$Pr recebeu mudanças depois da conferência. Clique em Recarregar no topo e tente de novo." }
} else {
  & git -C $root merge-base --is-ancestor $Sha origin/main 2>$null
  if ($LASTEXITCODE -ne 0) { Fail 'Essa versão não faz parte da versão oficial (main).' }
}
$before = ([string](Invoke-Git rev-parse HEAD)).Trim()
$beforeRef = ([string](Invoke-Git rev-parse --abbrev-ref HEAD)).Trim()

# 3. Desliga o DEV (libera node_modules e o motor do Prisma)
& (Join-Path $PSScriptRoot 'stop-dev.ps1') | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'Não foi possível desligar o ambiente de testes.' }
$stopped = $true

# 4. Troca o codigo na pasta do projeto
if ($Sha -eq $originMain) {
  Invoke-Git checkout --quiet main | Out-Null
  & git -C $root merge --ff-only --quiet origin/main 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail 'A main deste PC tem mudanças que não estão no GitHub; quem desenvolve precisa resolver.' }
} else {
  Invoke-Git checkout --quiet --detach $Sha | Out-Null
}
$after = ([string](Invoke-Git rev-parse HEAD)).Trim()
if ($after -ne $Sha) { Fail "A pasta do projeto não ficou na versão pedida ($after)." }
Write-DevLog -Paths $paths -Message "switch-dev-code: kind=$Kind pr=$Pr $beforeRef@$before -> $Sha"

# 5. Dependencias e acesso ao banco
$changed = @()
if ($before -ne $Sha) { $changed = @(Invoke-Git diff --name-only $before $Sha) }
foreach ($dir in @('backend', 'frontend')) {
  $dirPath = Join-Path $root $dir
  if ($changed -contains "$dir/package-lock.json" -or -not (Test-Path (Join-Path $dirPath 'node_modules'))) {
    Push-Location $dirPath
    try {
      & $paths.NpmCmd ci --no-audit --no-fund *> (Join-Path $paths.LogDir "switch-dev-npm-$dir.log")
      if ($LASTEXITCODE -ne 0) { Fail "Falha ao instalar as dependências de $dir (veja deploy/logs/switch-dev-npm-$dir.log)." }
    } finally {
      Pop-Location
    }
  }
}
# Prisma no Windows falha com EPERM se algum node do backend ainda segura query_engine-windows.dll.node.
$prismaLog = Join-Path $paths.LogDir 'switch-dev-prisma.log'
$prismaOk = $false
Push-Location $paths.BackendDir
try {
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
      $cmd = $_.CommandLine
      if ($cmd -and $cmd -like "*$root*" -and $cmd -like '*\backend\*' -and $cmd -notlike '*ops-panel*') {
        & taskkill.exe /PID $_.ProcessId /T /F 2>$null | Out-Null
      }
    }
    Start-Sleep -Seconds $(if ($attempt -eq 1) { 1 } else { 2 })
    & $paths.NpmCmd exec prisma generate *> $prismaLog
    if ($LASTEXITCODE -eq 0) { $prismaOk = $true; break }
  }
} finally {
  Pop-Location
}
if (-not $prismaOk) { Fail 'Falha ao preparar o acesso ao banco (veja deploy/logs/switch-dev-prisma.log).' }

$marker = [ordered]@{ sha = $Sha; kind = $Kind; pr = $(if ($Kind -eq 'pr') { $Pr } else { $null }); from = $beforeRef; at = (Get-Date).ToUniversalTime().ToString('o') }
[IO.File]::WriteAllText((Join-Path $paths.RuntimeDir 'dev-code.json'), ($marker | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))

# 6. Migrations no banco DEV
$migrateError = ''
if (-not $SkipMigrate) {
  $migrateLog = Join-Path $paths.LogDir 'switch-dev-migrate.log'
  Push-Location $paths.BackendDir
  try {
    & $paths.NodeExe scripts/run-with-env.mjs development npx prisma migrate deploy *> $migrateLog
    if ($LASTEXITCODE -ne 0) { $migrateError = (Get-Content -LiteralPath $migrateLog -Tail 3 -ErrorAction SilentlyContinue) -join ' ' }
  } finally {
    Pop-Location
  }
}

# 7. Liga o DEV
$stopped = $false
& $supervisor | Out-Null
$started = $LASTEXITCODE -eq 0
$label = @{ main = 'versão oficial'; prd = 'versão do site'; pr = "PR #$Pr" }[$Kind]
if ($migrateError) {
  [Console]::Error.WriteLine("O ambiente de testes está com a $label, mas as mudanças no banco de testes falharam: $migrateError. Se o banco de testes tem mudanças de outro teste, use Igualar ao site com a cópia do banco.")
  exit 1
}
if (-not $started) {
  [Console]::Error.WriteLine("A pasta do projeto foi trocada para a $label, mas o ambiente de testes não ligou; use Ligar no painel.")
  exit 1
}

Write-Output "DEV_CODE=$Sha kind=$Kind"
exit 0
