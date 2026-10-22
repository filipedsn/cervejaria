param(
  [Parameter(Mandatory = $true)][string]$ExpectedReleaseSha
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"
$paths = Get-DevPaths
. (Join-Path $PSScriptRoot '..\prod\release-candidate.ps1')

if ($ExpectedReleaseSha -notmatch '^[a-f0-9]{40}$') { throw 'ExpectedReleaseSha must be a full lowercase Git SHA.' }
$candidateRoot = Join-Path $paths.ProjectRoot 'deploy\release-candidates'
$candidate = Join-Path $candidateRoot $ExpectedReleaseSha
$dependencyRoot = Join-Path $paths.ProjectRoot "deploy\dev-runtime-dependencies\$ExpectedReleaseSha"
$active = Join-Path $paths.ProjectRoot 'deploy\dev-artifacts'
$staging = Join-Path $paths.ProjectRoot ("deploy\.dev-artifacts-staging-$([guid]::NewGuid().ToString('N'))")

if ((Test-DevPortListening -Port $paths.BackendPort) -or (Test-DevPortListening -Port $paths.FrontendPort)) {
  throw 'Stop the DEV frontend/backend before swapping compiled artifacts.'
}
Test-ReleaseCandidate -CandidatePath $candidate -ExpectedReleaseSha $ExpectedReleaseSha -ThrowOnError | Out-Null
if (-not (Test-Path (Join-Path $dependencyRoot 'backend\node_modules'))) { throw 'Pinned DEV runtime dependencies are missing.' }
if (Test-Path -LiteralPath $staging) { throw 'DEV artifact staging path already exists.' }

try {
  New-Item -ItemType Directory -Force -Path $staging | Out-Null
  Copy-Item -LiteralPath (Join-Path $candidate 'frontend') -Destination $staging -Recurse
  Copy-Item -LiteralPath (Join-Path $candidate 'backend') -Destination $staging -Recurse
  Copy-Item -LiteralPath (Get-CandidateManifestPath $candidate) -Destination (Join-Path $staging 'candidate-manifest.json')
  New-Item -ItemType Junction -Path (Join-Path $staging 'backend\node_modules') -Target (Join-Path $dependencyRoot 'backend\node_modules') | Out-Null

  $candidateManifestHash = (Get-FileHash -LiteralPath (Join-Path $staging 'candidate-manifest.json') -Algorithm SHA256).Hash.ToLowerInvariant()
  $runtimeManifest = [ordered]@{
    format = 'tap-quiver-dev-runtime/v1'
    releaseSha = $ExpectedReleaseSha
    sourceCandidate = "deploy/release-candidates/$ExpectedReleaseSha"
    candidateManifestSha256 = $candidateManifestHash
    dependencyManifest = "deploy/dev-runtime-dependencies/$ExpectedReleaseSha/dependency-manifest.json"
    activatedAt = [DateTime]::UtcNow.ToString('o')
  }
  if ($env:QUIVER_DEV_OTEL_ENDPOINT) {
    $endpoint = [uri]$env:QUIVER_DEV_OTEL_ENDPOINT
    if ($endpoint.Scheme -ne 'http' -or $endpoint.Host -notin @('127.0.0.1','localhost') -or $endpoint.Port -lt 1024 -or $endpoint.UserInfo -or $endpoint.Query -or $endpoint.AbsolutePath -ne '/') { throw 'Temporary DEV OTEL endpoint must be a credential-free loopback HTTP base URL.' }
    $runtimeManifest.telemetryEndpoint = $endpoint.AbsoluteUri.TrimEnd('/')
  }
  $runtimeManifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $staging 'manifest.json') -Encoding UTF8

  if (Test-Path -LiteralPath $active) {
    $previous = Join-Path $paths.ProjectRoot "deploy\dev-artifacts.previous-$([DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'))"
    if (Test-Path -LiteralPath $previous) { throw 'Unique DEV rollback-artifact path already exists.' }
    Move-Item -LiteralPath $active -Destination $previous
  }
  try {
    Move-Item -LiteralPath $staging -Destination $active
  } catch {
    if (-not (Test-Path -LiteralPath $active) -and $previous -and (Test-Path -LiteralPath $previous)) {
      Move-Item -LiteralPath $previous -Destination $active
    }
    throw
  }
  Write-Output "DEV_ARTIFACTS_ACTIVE=$active"
  Write-Output "RELEASE_SHA=$ExpectedReleaseSha"
  Write-Output "CANDIDATE_MANIFEST_SHA256=$candidateManifestHash"
} finally {
  if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue }
}
