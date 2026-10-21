$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'release-gate.ps1')

$mainSha = 'aaaaaaaa00000000000000000000000000000000'
$otherSha = 'bbbbbbbb00000000000000000000000000000000'

function New-FakeGit {
  param(
    [string]$Head = $mainSha,
    [string]$Remote = $mainSha,
    [string[]]$Dirty = @(),
    [string[]]$Loose = @(),
    [int]$FetchExit = 0
  )
  return {
    $joined = $args -join ' '
    $global:LASTEXITCODE = 0
    if ($joined -match 'rev-parse HEAD') { return $Head }
    if ($joined -match 'rev-parse origin/') { return $Remote }
    if ($joined -match 'untracked-files=no') { return $Dirty }
    if ($joined -match 'untracked-files=all') { return $Loose }
    if ($joined -match 'fetch') { $global:LASTEXITCODE = $FetchExit; return }
    throw "git inesperado: $joined"
  }.GetNewClosure()
}

function New-FakeAttestation {
  param(
    [object]$Value = ([pscustomobject]@{ ok = $true; sha = $mainSha; passedAt = '2026-10-21T12:00:00Z' })
  )
  return {
    param($ProjectRoot, $Sha)
    return $Value
  }.GetNewClosure()
}

Describe 'Gate de origem da release' {
  It 'libera commit limpo igual a origin/main com CI local atestado' {
    $result = Get-ReleaseGateResult -ProjectRoot 'X' -Git (New-FakeGit) -ReadAttestation (New-FakeAttestation)
    $result.Ok | Should Be $true
    $result.Sha | Should Be $mainSha
  }

  It 'bloqueia arquivo rastreado alterado' {
    $result = Get-ReleaseGateResult -ProjectRoot 'X' -Git (New-FakeGit -Dirty @(' M backend/src/app.ts')) -ReadAttestation (New-FakeAttestation)
    $result.Ok | Should Be $false
    ($result.Blockers -join ' ') | Should Match 'rastreado'
  }

  It 'bloqueia arquivo sem commit dentro de pasta que entra no build' {
    $result = Get-ReleaseGateResult -ProjectRoot 'X' -Git (New-FakeGit -Loose @('?? backend/src/lib/novo.ts')) -ReadAttestation (New-FakeAttestation)
    $result.Ok | Should Be $false
    ($result.Blockers -join ' ') | Should Match 'backend/src/lib/novo.ts'
  }

  It 'bloqueia HEAD diferente de origin/main' {
    $result = Get-ReleaseGateResult -ProjectRoot 'X' -Git (New-FakeGit -Remote $otherSha) -ReadAttestation (New-FakeAttestation)
    $result.Ok | Should Be $false
    ($result.Blockers -join ' ') | Should Match 'difere de origin/main'
  }

  It 'bloqueia quando o fetch falha' {
    $result = Get-ReleaseGateResult -ProjectRoot 'X' -Git (New-FakeGit -FetchExit 1) -ReadAttestation (New-FakeAttestation)
    $result.Ok | Should Be $false
    ($result.Blockers -join ' ') | Should Match 'fetch'
  }

  It 'bloqueia sem atestado de CI local' {
    $result = Get-ReleaseGateResult -ProjectRoot 'X' -Git (New-FakeGit) -ReadAttestation (New-FakeAttestation -Value $null)
    $result.Ok | Should Be $false
    ($result.Blockers -join ' ') | Should Match 'Sem atestado'
  }

  It 'bloqueia atestado de outro commit' {
    $wrong = [pscustomobject]@{ ok = $true; sha = $otherSha; passedAt = '2026-10-21T12:00:00Z' }
    $result = Get-ReleaseGateResult -ProjectRoot 'X' -Git (New-FakeGit) -ReadAttestation (New-FakeAttestation -Value $wrong)
    $result.Ok | Should Be $false
    ($result.Blockers -join ' ') | Should Match 'nao de'
  }

  It 'bloqueia atestado que nao marca sucesso' {
    $failed = [pscustomobject]@{ ok = $false; sha = $mainSha }
    $result = Get-ReleaseGateResult -ProjectRoot 'X' -Git (New-FakeGit) -ReadAttestation (New-FakeAttestation -Value $failed)
    $result.Ok | Should Be $false
    ($result.Blockers -join ' ') | Should Match 'nao marca sucesso'
  }
}

Describe 'deploy.ps1 aplica o gate' {
  $deploySource = Get-Content (Join-Path $PSScriptRoot 'deploy.ps1') -Raw

  It 'chama o gate dentro do preflight, antes de qualquer acao destrutiva' {
    $preflight = $deploySource.IndexOf('function Invoke-DeployPreflight')
    $gate = $deploySource.IndexOf('Get-ReleaseGateResult -ProjectRoot $paths.ProjectRoot', $preflight)
    $body = $deploySource.IndexOf('function Invoke-DeployBody')
    $gate | Should BeGreaterThan $preflight
    $gate | Should BeLessThan ($deploySource.IndexOf('# ------------------------------------------------------------- auto-elevacao'))
    $body | Should BeGreaterThan $gate
  }

  It 'constroi o candidate retido com NODE_ENV=production' {
    $candidateSource = Get-Content (Join-Path $PSScriptRoot 'release-candidate.ps1') -Raw
    ([regex]::Matches($candidateSource, "\`$env:NODE_ENV = 'production'")).Count | Should Be 2
    ([regex]::Matches($candidateSource, '\$env:NODE_ENV = \$previousNodeEnv')).Count | Should Be 2
  }

  It 'repassa flags e motivo de bypass ao processo elevado' {
    $deploySource | Should Match '\$script:deployBoundParameters = \$PSBoundParameters'
    $deploySource | Should Match '\$script:deployBoundParameters\.ContainsKey\(\$switchName\)'
    $deploySource | Should Match "'-BypassReleaseGate'"
  }
}
