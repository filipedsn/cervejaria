# Batimento do Support Analyst no Elastic PRD (TAP-169): template do data stream e chave so-escrita.
# Sem -Apply so mostra o estado. Com -Apply -ConfirmPrd (GATE do Filipe):
#   1. PUT do template quiver-tap-analyst-heartbeat (retencao 30d, sem replica);
#   2. cria no VPS (ssh, superusuario de la) a API key de docs\support-analyst\prd-heartbeat-writer-role.json
#      (create_doc so nesse data stream) se o env do analista ainda nao tiver uma (-RotateKey forca outra) e grava
#      SUPPORT_ANALYST_REMOTE_HEARTBEAT_API_KEY em deploy\runtime\support-analyst-prd.env sem imprimir o valor.
# A regra Kibana vem do configure-kibana.ps1 + wire-alert-actions.ps1. Reinicie a tarefa do analista depois.
[CmdletBinding()]
param([switch]$Apply, [switch]$ConfirmPrd, [switch]$RotateKey)

$ErrorActionPreference = 'Stop'
$script:ObsTarget = 'prd'
. (Join-Path $PSScriptRoot '_elastic-auth.ps1')

$root = $ObsProjectRoot
$templateFile = Join-Path $root 'deploy\observability\es-template-analyst-heartbeat-prd.json'
$roleFile = Join-Path $root 'docs\support-analyst\prd-heartbeat-writer-role.json'
$envFile = Join-Path $root 'deploy\runtime\support-analyst-prd.env'
$varName = 'SUPPORT_ANALYST_REMOTE_HEARTBEAT_API_KEY'

if (-not (Test-Path -LiteralPath $envFile)) { throw "Env do analista ausente: $envFile" }
$envLines = @(Get-Content -LiteralPath $envFile)
$hasKey = [bool]($envLines | Where-Object { $_ -match "^$varName=.+" })
Write-Host "Chave do batimento no env: $(if ($hasKey) { 'sim' } else { 'nao' }) (o template so e visivel com a credencial de admin)"
if (-not $Apply) { Write-Host 'Modo PLAN: nada alterado. Use -Apply -ConfirmPrd com GATE autorizado.'; return }

Assert-PrdMutationConfirmed -Confirmed:$ConfirmPrd

$putRaw = Invoke-Elastic -Method PUT -Path '/_index_template/quiver-tap-analyst-heartbeat' -BodyFile $templateFile | Out-String
if ($putRaw -notmatch '"acknowledged"\s*:\s*true') { throw "PUT do template falhou: $(($putRaw -replace '\s+', ' ').Trim())" }
Write-Host 'Template aplicado.' -ForegroundColor Green

if ($hasKey -and -not $RotateKey) { Write-Host 'Chave ja configurada no env; nada a criar (use -RotateKey para trocar).'; return }

# O quiver-obs-admin nao gerencia chaves (papel sem seguranca): a chave nasce no VPS com o superusuario de la,
# como em rotate-prd-credentials.ps1. Nenhum segredo e impresso.
$keyJson = (Get-Content -LiteralPath $roleFile -Raw | ConvertFrom-Json | ConvertTo-Json -Depth 20 -Compress)
$remote = @'
set -euo pipefail
cd /docker/elasticsearch-kibana
P="$(sed -n 's/^ELASTIC_PASSWORD=//p' .env | tr -d "\"'")"
es() { curl -fsS -u "elastic:$P" -H 'Content-Type: application/json' "http://127.0.0.1:9200$1" "${@:2}"; }
es /_security/api_key -X DELETE -d '{"name":"quiver-support-analyst-heartbeat-prd","owner":false}' >/dev/null || true
RESP="$(es /_security/api_key -X POST -d @- <<'JSON'
__KEY__
JSON
)"
printf 'KEY=%s\n' "$(printf '%s' "$RESP" | sed -n 's/.*"encoded":"\([^"]*\)".*/\1/p')"
'@
$remote = $remote.Replace('__KEY__', $keyJson)
$sshHost = if ($env:OPS_PRD_SSH_HOST) { $env:OPS_PRD_SSH_HOST } else { 'quiver-vps' }
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$out = $remote | ssh -o BatchMode=yes -o ConnectTimeout=10 $sshHost "sed '1s/^\xEF\xBB\xBF//' | tr -d '\r' | bash -s"
if ($LASTEXITCODE -ne 0) { throw "Falha no VPS (ssh $LASTEXITCODE); env do analista nao alterado." }
$key = (@($out) | Where-Object { $_ -like 'KEY=*' } | Select-Object -First 1) -replace '^KEY=', ''
if (-not $key) { throw 'Chave nao retornada pelo VPS; env do analista nao alterado.' }
$kept = @($envLines | Where-Object { $_ -notmatch "^$varName=" })
$content = (@($kept) + "$varName=$key") -join "`r`n"
[IO.File]::WriteAllText($envFile, $content + "`r`n", [Text.UTF8Encoding]::new($false))
$esUrl = $env:ELASTICSEARCH_URL.TrimEnd('/')
$who = Invoke-RestMethod "$esUrl/_security/_authenticate" -Headers @{ Authorization = "ApiKey $key" }
Write-Host "Chave $($who.api_key.name) criada (tipo $($who.authentication_type)); gravada no env do analista." -ForegroundColor Green
