# Configura no Kibana a jornada do usuario (TAP-160): data view, buscas salvas, dashboard e regra de surto de ui.error.
# Os arquivos sao gerados por: node scripts/observability/jornada-kibana.mjs --env <dev|prd> --write
[CmdletBinding()]
param([ValidateSet('dev', 'prd')][string]$Target = 'dev', [switch]$ConfirmPrd)

$ErrorActionPreference = 'Stop'
$script:ObsTarget = $Target
. (Join-Path $PSScriptRoot '_elastic-auth.ps1')
Assert-PrdMutationConfirmed -Confirmed:$ConfirmPrd

$ObsDir = Join-Path $ObsProjectRoot 'deploy\observability'
$ndjson = Join-Path $ObsDir "kibana-jornada-dashboard-$Target.ndjson"
$ruleFile = Join-Path $ObsDir "kibana-alert-ui-error-surge-$Target.json"
foreach ($file in @($ndjson, $ruleFile)) {
  if (-not (Test-Path -LiteralPath $file)) { throw "Arquivo ausente: $file (gere com jornada-kibana.mjs --env $Target --write)" }
}

function Write-Utf8NoBom {
  param([string]$Path, [string]$Content)
  [System.IO.File]::WriteAllText($Path, $Content, (New-Object System.Text.UTF8Encoding $false))
}

Write-Host "Quiver Tap - Jornada do usuario no Kibana ($Target)" -ForegroundColor Cyan

Write-Host '1. Data view, buscas salvas, visualizacoes e dashboard...' -ForegroundColor Yellow
$authArgs = Get-ElasticCurlAuthArgs
$import = curl.exe -s -X POST "$KibanaBase/api/saved_objects/_import?overwrite=true" -H 'kbn-xsrf: true' @authArgs -F "file=@$ndjson"
$importResult = $import | ConvertFrom-Json
if (-not $importResult.success) {
  $errors = @($importResult.errors | ForEach-Object { "$($_.type)/$($_.id): $($_.error.type) $($_.error.message)" }) -join '; '
  throw "Import falhou ($($importResult.successCount) ok): $errors"
}
Write-Host "   OK $($importResult.successCount) objetos importados" -ForegroundColor Green

Write-Host '2. Regra de surto de erros de interface...' -ForegroundColor Yellow
$spec = Get-Content -Raw -LiteralPath $ruleFile | ConvertFrom-Json
$find = Invoke-Kibana -Path "/api/alerting/rules/_find?search=$($spec.name)&search_fields=name&per_page=20" | ConvertFrom-Json
$existing = @($find.data) | Where-Object { $_.name -eq $spec.name } | Select-Object -First 1
if ($existing) {
  # PUT preserva as acoes ligadas depois pelo wire-alert-actions.ps1.
  $actions = @(@($existing.actions) | Where-Object { $_ } | ForEach-Object {
    $a = [ordered]@{ group = $_.group; id = $_.id; params = $_.params }
    if ($_.frequency) { $a.frequency = $_.frequency }
    $a
  })
  $update = [ordered]@{ name = $spec.name; tags = @($spec.tags); schedule = $spec.schedule; params = $spec.params; actions = $actions }
  if (-not @($actions | Where-Object { $_.Contains('frequency') }).Count) { $update.notify_when = $spec.notify_when }
  $tmp = Join-Path $env:TEMP "quiver-jornada-rule-$([guid]::NewGuid().ToString('N')).json"
  try {
    Write-Utf8NoBom -Path $tmp -Content ($update | ConvertTo-Json -Depth 20 -Compress)
    $result = Invoke-Kibana -Method PUT -Path "/api/alerting/rule/$($existing.id)" -BodyFile $tmp
  } finally { Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue }
  if ($result -notmatch '"id"') { throw "Regra $($spec.name) PUT: $result" }
  Write-Host "   OK $($spec.name) (atualizada; $($actions.Count) acoes preservadas)" -ForegroundColor Green
} else {
  $result = Invoke-Kibana -Method POST -Path '/api/alerting/rule' -BodyFile $ruleFile
  if ($result -notmatch '"id"') { throw "Regra $($spec.name) POST: $result" }
  Write-Host "   OK $($spec.name) (criada)" -ForegroundColor Green
}

Write-Host ''
Write-Host "Dashboard: $KibanaBase/app/dashboards#/view/quiver-tap-jornada-$Target" -ForegroundColor Gray
Write-Host "Discover:  $KibanaBase/app/discover#/view/quiver-tap-jornada-$Target-por-usuario" -ForegroundColor Gray
