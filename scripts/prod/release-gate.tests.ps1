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

function New-FakeGh {
  param([string]$Json = '[{"status":"completed","conclusion":"success","event":"push","headBranch":"main","url":"u"}]', [int]$Exit = 0)
  return {
    $global:LASTEXITCODE = $Exit
    return $Json
  }.GetNewClosure()
}

Describe 'Gate de origem da release' {
  It 'libera commit limpo igual a origin/main com CI verde' {
    $result = Get-ReleaseGateResult -ProjectRoot 'X' -Git (New-FakeGit) -Gh (New-FakeGh)
    $result.Ok | Should Be $true
    $result.Sha | Should Be $mainSha
  }

  It 'bloqueia arquivo rastreado alterado' {
    $result = Get-ReleaseGateResult -ProjectRoot 'X' -Git (New-FakeGit -Dirty @(' M backend/src/app.ts')) -Gh (New-FakeGh)
    $result.Ok | Should Be $false
    ($result.Blockers -join ' ') | Should Match 'rastreado'
  }

  It 'bloqueia arquivo sem commit dentro de pasta que entra no build' {
    $result = Get-ReleaseGateResult -ProjectRoot 'X' -Git (New-FakeGit -Loose @('?? backend/src/lib/novo.ts')) -Gh (New-FakeGh)
    $result.Ok | Should Be $false
    ($result.Blockers -join ' ') | Should Match 'backend/src/lib/novo.ts'
  }

  It 'bloqueia HEAD diferente de origin/main' {
    $result = Get-ReleaseGateResult -ProjectRoot 'X' -Git (New-FakeGit -Remote $otherSha) -Gh (New-FakeGh)
    $result.Ok | Should Be $false
    ($result.Blockers -join ' ') | Should Match 'difere de origin/main'
  }

  It 'bloqueia quando o fetch falha' {
    $result = Get-ReleaseGateResult -ProjectRoot 'X' -Git (New-FakeGit -FetchExit 1) -Gh (New-FakeGh)
    $result.Ok | Should Be $false
    ($result.Blockers -join ' ') | Should Match 'fetch'
  }

  It 'bloqueia CI com falha' {
    $gh = New-FakeGh -Json '[{"status":"completed","conclusion":"failure","event":"push","headBranch":"main","url":"https://ci/1"}]'
    $result = Get-ReleaseGateResult -ProjectRoot 'X' -Git (New-FakeGit) -Gh $gh
    $result.Ok | Should Be $false
    ($result.Blockers -join ' ') | Should Match 'https://ci/1'
  }

  It 'bloqueia CI ainda em execucao' {
    $gh = New-FakeGh -Json '[{"status":"in_progress","conclusion":"","event":"push","headBranch":"main","url":"u"}]'
    $result = Get-ReleaseGateResult -ProjectRoot 'X' -Git (New-FakeGit) -Gh $gh
    $result.Ok | Should Be $false
    ($result.Blockers -join ' ') | Should Match 'em execucao'
  }

  It 'bloqueia commit sem nenhuma execucao de CI' {
    $result = Get-ReleaseGateResult -ProjectRoot 'X' -Git (New-FakeGit) -Gh (New-FakeGh -Json '[]')
    $result.Ok | Should Be $false
    ($result.Blockers -join ' ') | Should Match 'Nenhuma execucao'
  }

  It 'bloqueia quando o gh nao responde' {
    $result = Get-ReleaseGateResult -ProjectRoot 'X' -Git (New-FakeGit) -Gh (New-FakeGh -Json '' -Exit 1)
    $result.Ok | Should Be $false
    ($result.Blockers -join ' ') | Should Match 'gh instalado'
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
