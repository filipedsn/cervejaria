[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('dev')]
  [string]$Environment,

  [switch]$Apply,

  [string]$ConfirmApply
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'ilm-plan.ps1')

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$plan = New-DevIlmPlan -ProjectRoot $ProjectRoot

Write-Host 'Quiver Tap — plano ILM limitado a DEV' -ForegroundColor Cyan
Write-Host 'Nenhuma chamada HTTP ocorre no modo padrão.' -ForegroundColor Green
Write-Host 'As janelas são propostas nos JSON versionados; não significam aprovação de retenção.' -ForegroundColor Yellow
Write-Host 'Policies/templates propostos:'
$plan | ForEach-Object {
  Write-Host ("- {0}: rollover={1}; delete_after={2} (proposta); destino={3}; policy={4}; template={5} endpoint={6}; prioridade={7}" -f $_.PolicyName, $_.RolloverProposal, $_.DeleteAfter, $_.Pattern, $_.EndpointPolicy, $_.TemplateName, $_.EndpointTemplate, $_.Priority)
}
Write-Host 'Nenhum backing existente, documento, réplica ou limite será alterado por este plano.'

if (-not $Apply) {
  Write-Host 'Planejamento concluído. Use -Apply -ConfirmApply TAP96-DEV-RETENTION somente após aprovação explícita de retenção e revisão do conflito de templates.'
  return
}

if ($ConfirmApply -cne 'TAP96-DEV-RETENTION') {
  throw 'Aplicação recusada: confirme com -ConfirmApply TAP96-DEV-RETENTION.'
}

# Authentication is deliberately loaded only after explicit apply intent.
. (Join-Path $PSScriptRoot '_elastic-auth.ps1')
if (-not $env:ELASTIC_API_KEY) {
  throw 'Aplicação recusada: informe uma ELASTIC_API_KEY autorizada; usuário/senha e fallback administrativo não são aceitos.'
}
if (-not $script:ElasticAuthHeader) {
  throw 'Aplicação recusada: credencial ausente.'
}

function Invoke-IlmApi {
  param([Parameter(Mandatory)][string]$Method, [Parameter(Mandatory)][string]$Path, [string]$Json)
  $uri = "$($script:EsBase)$Path"
  $headers = @{ Authorization = $script:ElasticAuthHeader }
  try {
    if ($Json) {
      return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers -ContentType 'application/json' -Body $Json -ErrorAction Stop
    }
    return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers -ErrorAction Stop
  }
  catch {
    $status = 0
    try { $status = [int]$_.Exception.Response.StatusCode } catch {}
    if ($Method -eq 'GET' -and $status -eq 404) { return $null }
    throw "Elasticsearch recusou a precondição/operação (HTTP $status). Nenhuma credencial foi incluída no erro; não haverá fallback."
  }
}

# All GET preconditions are completed before the first write. Any existing
# template in these families is a conflict: composable templates are selected
# by priority rather than merged, so a new winner could discard its mappings.
$allTemplates = Invoke-IlmApi -Method GET -Path '/_index_template'
if (-not $allTemplates.index_templates) { throw 'Estado de templates indeterminado; nenhuma escrita foi enviada.' }
$prepared = @()
foreach ($item in $plan) {
  $targetNames = @($item.ProbeName)
  $existingStreams = Invoke-IlmApi -Method GET -Path ("/_data_stream/{0}" -f [Uri]::EscapeDataString($item.Pattern))
  if ($existingStreams -and $existingStreams.data_streams) {
    $targetNames += @($existingStreams.data_streams | ForEach-Object { $_.name })
  }
  $conflicts = @()
  foreach ($candidate in $allTemplates.index_templates) {
    $patterns = @($candidate.index_template.index_patterns)
    foreach ($existingPattern in $patterns) {
      if (Test-EsIndexPatternOverlap -Left $item.Pattern -Right $existingPattern) { $conflicts += $candidate.name; break }
    }
  }
  $conflicts = @($conflicts | Sort-Object -Unique | Where-Object { $_ -ne $item.TemplateName })
  if ($conflicts.Count) {
    throw "Aplicação recusada: template efetivo concorrente ($($conflicts -join ', ')) para $($item.Pattern). Integração manual de template necessária; nenhuma escrita foi enviada."
  }

  $policy = Get-Content -LiteralPath $item.PolicyPath -Raw | ConvertFrom-Json
  $existingPolicy = Invoke-IlmApi -Method GET -Path $item.EndpointPolicy
  if ($existingPolicy -and $existingPolicy.PSObject.Properties[$item.PolicyName]) {
    $currentPolicy = $existingPolicy.PSObject.Properties[$item.PolicyName].Value.policy
    if (-not (Test-ExactIlmPolicy -Expected $policy.policy -Actual $currentPolicy)) { throw "Policy de mesmo nome com conteúdo divergente ($($item.PolicyName)); nenhuma escrita foi enviada." }
  }

  $templatePath = "/_index_template/$($item.TemplateName)"
  $existingTemplate = Invoke-IlmApi -Method GET -Path $templatePath
  $templateBody = @{
    index_patterns = @($item.Pattern)
    template = @{ settings = @{ 'index.lifecycle.name' = $item.PolicyName } }
    data_stream = @{}
    priority = $item.Priority
    _meta = @{ purpose = 'TAP-96 DEV only; reviewed retention proposal' }
  }
  if ($existingTemplate -and $existingTemplate.index_templates) {
    $current = $existingTemplate.index_templates[0].index_template
    if (-not (Test-ExactIlmTemplate -Expected $templateBody -Actual $current)) { throw "Template de mesmo nome com conteúdo divergente ($($item.TemplateName)); nenhuma escrita foi enviada." }
  }
  $prepared += [pscustomobject]@{ Item = $item; Policy = $policy; ExistingPolicy = [bool]$existingPolicy; Template = $templateBody; ExistingTemplate = [bool]($existingTemplate -and $existingTemplate.index_templates) }
}

foreach ($entry in $prepared) {
  if (-not $entry.ExistingPolicy) {
    $body = ConvertTo-Json -InputObject $entry.Policy -Depth 40 -Compress
    Invoke-IlmApi -Method PUT -Path $entry.Item.EndpointPolicy -Json $body | Out-Null
  }
  if (-not $entry.ExistingTemplate) {
    $body = ConvertTo-Json -InputObject $entry.Template -Depth 40 -Compress
    Invoke-IlmApi -Method PUT -Path ("/_index_template/{0}" -f $entry.Item.TemplateName) -Json $body | Out-Null
  }
}
Write-Host 'Aplicação concluída: policies e templates para índices futuros. Backings existentes não foram alterados.' -ForegroundColor Green
