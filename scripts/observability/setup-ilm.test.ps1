$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$SetupScript = Join-Path $PSScriptRoot 'setup-ilm.ps1'
. (Join-Path $PSScriptRoot 'ilm-plan.ps1')
$checks = 0

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw "FAIL: $Message" }
  $script:checks++
  Write-Host "PASS: $Message"
}

$plan = @(New-DevIlmPlan -ProjectRoot $ProjectRoot)
Assert-True ($plan.Count -eq 5) 'plan contains five explicit DEV families'
Assert-True (@($plan | Where-Object { $_.Pattern -match 'prd|infra|\{|\?|\*\.\*|\*\*' }).Count -eq 0) 'patterns exclude PROD, infra and ambiguous globs'
Assert-True (@($plan.PolicyName | Select-Object -Unique).Count -eq 5) 'policy names are unique'
Assert-True (@($plan.TemplateName | Select-Object -Unique).Count -eq 5) 'template names are unique'
Assert-True (@($plan | Where-Object { $_.PolicyName -notmatch '^quiver-tap96-dev-' -or $_.TemplateName -notmatch '^quiver-tap96-dev-' }).Count -eq 0) 'names are isolated from shared policies'
Assert-True (Test-EsIndexPatternOverlap -Left 'logs-audit_*.otel-dev' -Right 'logs-*-*') 'broad composable template is treated as a conflict'
Assert-True (-not (Test-EsIndexPatternOverlap -Left 'logs-audit_*.otel-dev' -Right 'logs-*.otel-prd')) 'DEV target does not overlap the PROD namespace'
Assert-True (Test-EsIndexPatternOverlap -Left 'logs-audit_*.otel-dev' -Right 'logs-{generic,technical}.otel-*') 'ambiguous brace pattern is rejected conservatively'
$policyA = @{ phases = @{ hot = @{ min_age = '0ms'; actions = @{ rollover = @{ max_age = '14d'; max_primary_shard_size = '30gb' } } }; delete = @{ min_age = '90d'; actions = @{ delete = @{} } } } }
$policyB = @{ phases = @{ delete = @{ actions = @{ delete = @{} }; min_age = '90d' }; hot = @{ actions = @{ rollover = @{ max_primary_shard_size = '30gb'; max_age = '14d' } }; min_age = '0ms' } } }
Assert-True (Test-ExactIlmPolicy -Expected $policyA -Actual $policyB) 'identical existing policy is recognized idempotently despite JSON key order'
$policyB.phases.delete.min_age = '30d'
Assert-True (-not (Test-ExactIlmPolicy -Expected $policyA -Actual $policyB)) 'same-name policy with changed retention is a hard conflict'
$templateA = @{ index_patterns = @('logs-audit_*.otel-dev'); priority = 300; template = @{ settings = @{ 'index.lifecycle.name' = 'quiver-tap96-dev-audit-90d-v1' } }; data_stream = @{} }
$templateB = @{ index_patterns = @('logs-audit_*.otel-dev'); priority = 300; template = @{ settings = @{ 'index.lifecycle.name' = 'quiver-tap96-dev-audit-90d-v1' } }; data_stream = @{} }
Assert-True (Test-ExactIlmTemplate -Expected $templateA -Actual $templateB) 'identical existing template is recognized idempotently'
$templateB.priority = 110
Assert-True (-not (Test-ExactIlmTemplate -Expected $templateA -Actual $templateB)) 'same-name template with different precedence is a hard conflict'

$oldAction = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$missing = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $SetupScript 2>&1 | Out-String
$missingExit = $LASTEXITCODE
$ErrorActionPreference = $oldAction
Assert-True ($missingExit -ne 0 -and $missing -match 'Environment') 'missing environment is rejected'
$ErrorActionPreference = 'Continue'
foreach ($environment in @('prod', 'infra', 'dev-prod', '*')) {
  $null = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $SetupScript -Environment $environment 2>&1
  $invalidExit = $LASTEXITCODE
  Assert-True ($invalidExit -ne 0) "invalid environment '$environment' is rejected"
}
$ErrorActionPreference = $oldAction

$oldUrl = $env:ELASTICSEARCH_URL
$oldKey = $env:ELASTIC_API_KEY
try {
  $env:ELASTICSEARCH_URL = 'http://127.0.0.1:1'
  $env:ELASTIC_API_KEY = 'TAP96-TEST-SENTINEL'
  $ErrorActionPreference = 'Continue'
  $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $SetupScript -Environment dev 2>&1 | Out-String
  $planExit = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  Assert-True ($planExit -eq 0) 'default plan succeeds with Elasticsearch at a closed local port (no HTTP request)'
  Assert-True ($output -match 'Nenhuma chamada HTTP ocorre') 'default mode states that it does not call HTTP'
  Assert-True ($output -match 'logs-audit_\*\.otel-dev') 'plan exposes exact DEV audit pattern'
  Assert-True ($output -match '/_ilm/policy/quiver-tap96-dev-audit-90d-v1') 'plan exposes policy endpoint'
  Assert-True ($output -notmatch 'TAP96-TEST-SENTINEL') 'plan does not print credential-like environment value'
}
finally {
  $env:ELASTICSEARCH_URL = $oldUrl
  $env:ELASTIC_API_KEY = $oldKey
}

$source = Get-Content -LiteralPath $SetupScript -Raw
Assert-True ($source -notmatch 'number_of_replicas|_rollover|DELETE|_delete_by_query') 'script does not configure replicas or mutate/delete existing backings'
Assert-True ($source.IndexOf(". (Join-Path `$PSScriptRoot '_elastic-auth.ps1')") -gt $source.IndexOf('if (-not $Apply)')) 'auth helper is loaded only after explicit apply path'
Assert-True ($source -match 'if \(-not \$env:ELASTIC_API_KEY\)' -and $source -notmatch 'ELASTIC_USER|ELASTIC_PASSWORD|Get-ElasticAuthHeader') 'apply requires an explicit API key and has no privileged username/password fallback'

Write-Host "Completed $checks focused checks."
