function New-DevIlmPlan {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$ProjectRoot)

  $families = @(
    @{ Family = 'audit'; PolicyName = 'quiver-tap96-dev-audit-90d-v1'; PolicyFile = 'es-ilm-policy-audit.json'; Pattern = 'logs-audit_*.otel-dev'; ProbeName = 'logs-audit_tap96-template-probe.otel-dev' },
    @{ Family = 'technical'; PolicyName = 'quiver-tap96-dev-technical-30d-v1'; PolicyFile = 'es-ilm-policy-logs.json'; Pattern = 'logs-technical.otel-dev'; ProbeName = 'logs-technical.otel-dev' },
    @{ Family = 'generic-logs'; PolicyName = 'quiver-tap96-dev-generic-logs-30d-v1'; PolicyFile = 'es-ilm-policy-logs.json'; Pattern = 'logs-generic.otel-dev'; ProbeName = 'logs-generic.otel-dev' },
    @{ Family = 'traces'; PolicyName = 'quiver-tap96-dev-traces-30d-v1'; PolicyFile = 'es-ilm-policy-traces.json'; Pattern = 'traces-*.otel-dev'; ProbeName = 'traces-generic.otel-dev' },
    @{ Family = 'metrics'; PolicyName = 'quiver-tap96-dev-metrics-45d-v1'; PolicyFile = 'es-ilm-policy-metrics.json'; Pattern = 'metrics-generic.otel-dev'; ProbeName = 'metrics-generic.otel-dev' }
  )

  foreach ($family in $families) {
    if ($family.Pattern -match '\.otel-(prd|infra)(\*|$)' -or $family.Pattern -match '[{},?]' -or $family.Pattern -match '(^|\*)\*') {
      throw "Padrão fora da allowlist DEV: $($family.Pattern)"
    }
    $policyPath = Join-Path (Join-Path $ProjectRoot 'deploy\observability') $family.PolicyFile
    if (-not (Test-Path -LiteralPath $policyPath -PathType Leaf)) {
      throw "Policy versionada ausente: $($family.PolicyFile)"
    }
    [pscustomobject]@{
      Environment = 'dev'
      Family = $family.Family
      PolicyName = $family.PolicyName
      PolicyFile = $family.PolicyFile
      PolicyPath = $policyPath
      Pattern = $family.Pattern
      TemplateName = "$($family.PolicyName)-template"
      Priority = 300
      ProbeName = $family.ProbeName
      EndpointPolicy = "/_ilm/policy/$($family.PolicyName)"
      EndpointTemplate = "/_index_template/$($family.PolicyName)-template"
    }
  }
}

function Test-EsIndexPatternOverlap {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$Left, [Parameter(Mandatory)][string]$Right)

  # Elasticsearch index patterns support * and ?. Treat other syntax, or ?,
  # conservatively as a conflict instead of guessing at glob semantics.
  if ($Left -match '[{}\[\]]' -or $Right -match '[{}\[\]]' -or $Left.Contains('?') -or $Right.Contains('?')) { return $true }
  $leftPrefix = ($Left -split '\*', 2)[0]
  $rightPrefix = ($Right -split '\*', 2)[0]
  $leftSuffix = ($Left -split '\*')[-1]
  $rightSuffix = ($Right -split '\*')[-1]

  $prefixCompatible = $leftPrefix.StartsWith($rightPrefix, [StringComparison]::OrdinalIgnoreCase) -or
    $rightPrefix.StartsWith($leftPrefix, [StringComparison]::OrdinalIgnoreCase)
  $suffixCompatible = [string]::IsNullOrEmpty($leftSuffix) -or [string]::IsNullOrEmpty($rightSuffix) -or
    $leftSuffix.EndsWith($rightSuffix, [StringComparison]::OrdinalIgnoreCase) -or
    $rightSuffix.EndsWith($leftSuffix, [StringComparison]::OrdinalIgnoreCase)
  return $prefixCompatible -and $suffixCompatible
}

function ConvertTo-StableIlmValue {
  param([AllowNull()][object]$Value)
  if ($null -eq $Value) { return $null }
  if ($Value -is [System.Collections.IDictionary]) {
    $stable = [ordered]@{}
    foreach ($key in @($Value.Keys | Sort-Object -CaseSensitive)) { $stable[$key] = ConvertTo-StableIlmValue $Value[$key] }
    return $stable
  }
  if ($Value -is [pscustomobject]) {
    $stable = [ordered]@{}
    foreach ($property in @($Value.PSObject.Properties | Sort-Object Name -CaseSensitive)) { $stable[$property.Name] = ConvertTo-StableIlmValue $property.Value }
    return $stable
  }
  if ($Value -is [System.Collections.IEnumerable] -and $Value -isnot [string]) {
    return ,@($Value | ForEach-Object { ConvertTo-StableIlmValue $_ })
  }
  return $Value
}

function Test-ExactIlmPolicy {
  param([Parameter(Mandatory)][object]$Expected, [Parameter(Mandatory)][object]$Actual)
  $left = ConvertTo-Json -InputObject (ConvertTo-StableIlmValue $Expected) -Depth 50 -Compress
  $right = ConvertTo-Json -InputObject (ConvertTo-StableIlmValue $Actual) -Depth 50 -Compress
  return $left -ceq $right
}

function Test-ExactIlmTemplate {
  param([Parameter(Mandatory)][object]$Expected, [Parameter(Mandatory)][object]$Actual)
  return (@($Expected.index_patterns) -join ',') -ceq (@($Actual.index_patterns) -join ',') -and
    [int]$Expected.priority -eq [int]$Actual.priority -and
    [string]$Expected.template.settings.'index.lifecycle.name' -ceq [string]$Actual.template.settings.'index.lifecycle.name' -and
    [bool]$Expected.data_stream -eq [bool]$Actual.data_stream
}
