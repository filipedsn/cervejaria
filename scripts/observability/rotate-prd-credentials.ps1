# Cria/rotaciona as credenciais locais de observabilidade PRD (TAP-164) sem superusuario no PC:
#   ELASTIC_API_KEY        chave somente leitura (diagnose, analise, Kibana em leitura), 365 dias
#   ELASTIC_ADMIN_USER/PASSWORD  usuario quiver-obs-admin (papel deploy/observability/roles/quiver-obs-admin-role.json),
#                          usado so por scripts com -ConfirmPrd. Usuario (e nao chave) porque o Kibana amarra cada
#                          regra a credencial que a editou: com usuario, cada regra ganha a propria chave.
# O papel, o usuario e a chave sao criados no VPS com o superusuario do stack Elastic de la; nenhum segredo e impresso.
param(
  [switch]$ConfirmPrd,
  [string]$SshHost = $(if ($env:OPS_PRD_SSH_HOST) { $env:OPS_PRD_SSH_HOST } else { 'quiver-vps' })
)
$ErrorActionPreference = 'Stop'
if (-not $ConfirmPrd) { throw 'Rotacao de credenciais PRD exige -ConfirmPrd (e autorizacao do Filipe).' }

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$envFile = Join-Path $root 'deploy\observability\.env.observability.prd'
if (-not (Test-Path -LiteralPath $envFile)) { throw 'deploy\observability\.env.observability.prd ausente (precisa de ELASTICSEARCH_URL e KIBANA_URL).' }
$roleJson = (Get-Content -LiteralPath (Join-Path $root 'deploy\observability\roles\quiver-obs-admin-role.json') -Raw | ConvertFrom-Json | ConvertTo-Json -Depth 20 -Compress)
$keyJson = (Get-Content -LiteralPath (Join-Path $root 'deploy\observability\roles\quiver-obs-readonly-key.json') -Raw | ConvertFrom-Json | ConvertTo-Json -Depth 20 -Compress)

$alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'.ToCharArray()
$bytes = [byte[]]::new(40); [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$adminPassword = -join ($bytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] })

$remote = @'
set -euo pipefail
cd /docker/elasticsearch-kibana
P="$(sed -n 's/^ELASTIC_PASSWORD=//p' .env | tr -d "\"'")"
es() { curl -fsS -u "elastic:$P" -H 'Content-Type: application/json' "http://127.0.0.1:9200$1" "${@:2}"; }
es /_security/role/quiver_obs_admin -X PUT -d @- >/dev/null <<'JSON'
__ROLE__
JSON
es /_security/user/quiver-obs-admin -X PUT -d @- >/dev/null <<'JSON'
{"password":"__PASSWORD__","roles":["quiver_obs_admin"],"full_name":"Quiver observability admin (TAP-164)"}
JSON
es /_security/api_key -X DELETE -d '{"name":"quiver-obs-readonly-prd","owner":false}' >/dev/null || true
RESP="$(es /_security/api_key -X POST -d @- <<'JSON'
__KEY__
JSON
)"
printf 'KEY=%s\n' "$(printf '%s' "$RESP" | sed -n 's/.*"encoded":"\([^"]*\)".*/\1/p')"
'@
$remote = $remote.Replace('__ROLE__', $roleJson).Replace('__PASSWORD__', $adminPassword).Replace('__KEY__', $keyJson)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$out = $remote | ssh -o BatchMode=yes -o ConnectTimeout=10 $SshHost "tr -d '\r' | bash -s"
if ($LASTEXITCODE -ne 0) { throw "Falha no VPS (ssh $LASTEXITCODE); nada foi alterado no PC." }
$readKey = (@($out) | Where-Object { $_ -like 'KEY=*' } | Select-Object -First 1) -replace '^KEY=', ''
if (-not $readKey) { throw 'Chave somente leitura nao retornada; nada foi alterado no PC.' }

$keep = Get-Content -LiteralPath $envFile | Where-Object { $_ -notmatch '^(ELASTIC_USER|ELASTIC_PASSWORD|ELASTIC_API_KEY|ELASTIC_ADMIN_USER|ELASTIC_ADMIN_PASSWORD)=' }
$lines = @($keep) + @("ELASTIC_API_KEY=$readKey", 'ELASTIC_ADMIN_USER=quiver-obs-admin', "ELASTIC_ADMIN_PASSWORD=$adminPassword")
[IO.File]::WriteAllLines($envFile, $lines, [Text.UTF8Encoding]::new($false))
& icacls.exe $envFile /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null

$esUrl = ((Get-Content -LiteralPath $envFile | Where-Object { $_ -like 'ELASTICSEARCH_URL=*' } | Select-Object -First 1) -replace '^ELASTICSEARCH_URL=', '').Trim().TrimEnd('/')
$ro = Invoke-RestMethod "$esUrl/_security/_authenticate" -Headers @{ Authorization = "ApiKey $readKey" }
$basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("quiver-obs-admin:$adminPassword"))
$adm = Invoke-RestMethod "$esUrl/_security/_authenticate" -Headers @{ Authorization = "Basic $basic" }
Write-Host "leitura: tipo=$($ro.authentication_type) chave=$($ro.api_key.name)"
Write-Host "admin:   usuario=$($adm.username) papeis=$($adm.roles -join ',') superuser=$([bool]($adm.roles -contains 'superuser'))"
