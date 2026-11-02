# Jornada de um cliente em PRD, executada no conteiner quiver-tap-support-analyst do VPS (chave de leitura do proprio VPS).
# Mesmos argumentos de `npm run journey`, ex.:
#   .\scripts\support-analyst\jornada-prd.ps1 --usuario cliente@exemplo.com --desde 24h
#   .\scripts\support-analyst\jornada-prd.ps1 --correlacao <correlationId>
# A saida aparece no terminal e uma copia fica em deploy\runtime\support-analyst\journeys (fora do Git, 30 dias).
# A jornada tem dados pessoais: nunca cole em Telegram, ticket ou commit. --resumo nao tem LLM no VPS (sai so a linha do tempo).
# Para DEV use `npm run journey --prefix support-analyst -- ... --env dev` no PC.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$sshHost = if ($env:OPS_PRD_SSH_HOST) { $env:OPS_PRD_SSH_HOST } else { 'quiver-vps' }

for ($i = 0; $i -lt $args.Count; $i++) {
  if ($args[$i] -eq '--env' -and $i + 1 -lt $args.Count -and $args[$i + 1] -ne 'prd') { throw 'jornada-prd.ps1 so consulta PRD; para DEV use npm run journey --prefix support-analyst -- ... --env dev' }
  if ([string]$args[$i] -match '"') { throw 'Argumento com aspas duplas nao e suportado.' }
}
$quoted = @($args | ForEach-Object { "'" + ([string]$_ -replace "'", "'\''") + "'" }) -join ' '
$remote = "docker exec quiver-tap-support-analyst node dist/journey/cli.js $quoted"

$previousEncoding = [Console]::OutputEncoding
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
try {
  $lines = @(& ssh -o BatchMode=yes -o ConnectTimeout=15 $sshHost $remote)
  $code = $LASTEXITCODE
} finally {
  [Console]::OutputEncoding = $previousEncoding
}
$lines | ForEach-Object { Write-Host $_ }
if ($code -ne 0) { exit $code }

$fileLine = $lines | Where-Object { $_ -match '^Arquivo: .*/(jornada-[a-z0-9-]+\.txt)$' } | Select-Object -First 1
if ($fileLine -and $fileLine -match '/(jornada-[a-z0-9-]+\.txt)$') {
  $name = $Matches[1]
  $cut = [Array]::IndexOf($lines, $fileLine)
  $timeline = ($lines[0..([Math]::Max(0, $cut - 1))] -join "`n").TrimEnd() + "`n"
  $dir = Join-Path $root 'deploy\runtime\support-analyst\journeys'
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  Get-ChildItem -LiteralPath $dir -Filter 'jornada-*.txt' -File | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item -Force
  $localPath = Join-Path $dir $name
  [IO.File]::WriteAllText($localPath, $timeline, [Text.UTF8Encoding]::new($false))
  Write-Host "Copia local: $localPath"
}
