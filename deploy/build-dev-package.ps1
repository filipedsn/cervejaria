# DEV-only: builds an immutable DEV package (release candidate + runtime dependencies) from a DEV source copy.
# Never touches deploy/prod-artifacts or port 3001. Publishing is done separately by swap-dev-release.ps1.
param(
  [string]$Source = 'deploy\.dev-source-fiado-quitado-depois',
  [Parameter(Mandatory)][string]$BaseSha,
  [Parameter(Mandatory)][string]$Note
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root $Source
$baseCandidate = Join-Path $root "deploy\release-candidates\$BaseSha"
$baseDeps = Join-Path $root "deploy\dev-runtime-dependencies\$BaseSha"
foreach ($path in @($src, $baseCandidate, $baseDeps)) { if (-not (Test-Path -LiteralPath $path)) { throw "Missing $path" } }

function Invoke-Native([string]$Label, [scriptblock]$Block) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $Block 2>&1 | ForEach-Object { "$_" } | Where-Object { $_ -notmatch 'Unknown env config "devdir"' } }
  finally { $ErrorActionPreference = $previous }
  if ($LASTEXITCODE) { throw "$Label failed (exit $LASTEXITCODE)" }
}

function Get-Sha256([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }

$baseSchema = Join-Path $baseCandidate 'backend\prisma\schema.prisma'
if ((Get-Sha256 (Join-Path $src 'backend\prisma\schema.prisma')) -ne (Get-Sha256 $baseSchema)) {
  throw 'Prisma schema differs from the base package; reusing its dependencies and migrations is not safe.'
}
foreach ($project in @('backend', 'frontend')) {
  $lock = Join-Path $src "$project\package-lock.json"
  $baseLock = if ($project -eq 'backend') { Join-Path $baseCandidate 'backend\package-lock.json' } else { Join-Path $baseDeps 'frontend\package-lock.json' }
  if ((Get-Sha256 $lock) -ne (Get-Sha256 $baseLock)) { throw "$project package-lock differs from the base package; dependencies cannot be reused." }
}

$gitDir = Join-Path $root '.git'
$index = Join-Path $env:TEMP ("dev-source-index-{0}" -f [guid]::NewGuid())
try {
  $env:GIT_INDEX_FILE = $index
  Invoke-Native 'git add' { git --git-dir $gitDir --work-tree $src add -A -- . }
  $sha = ([string](git --git-dir $gitDir --work-tree $src write-tree)).Trim()
  if ($LASTEXITCODE -or $sha -notmatch '^[0-9a-f]{40}$') { throw 'git write-tree failed' }
} finally {
  Remove-Item Env:GIT_INDEX_FILE -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $index -Force -ErrorAction SilentlyContinue
}
Write-Output "RELEASE_ID=$sha"

$candidate = Join-Path $root "deploy\release-candidates\$sha"
$deps = Join-Path $root "deploy\dev-runtime-dependencies\$sha"
if ((Test-Path -LiteralPath $candidate) -or (Test-Path -LiteralPath $deps)) { throw "Package $sha already exists; nothing changed in the source?" }

Push-Location (Join-Path $src 'backend')
try {
  if (Test-Path dist) { Remove-Item dist -Recurse -Force }
  Invoke-Native 'backend tsc' { npx tsc }
} finally { Pop-Location }

New-Item -ItemType Directory -Path (Join-Path $candidate 'backend') -Force | Out-Null
Push-Location (Join-Path $src 'frontend')
try {
  Invoke-Native 'frontend typecheck' { npx tsc -b --noEmit }
  Invoke-Native 'vite build' { npx vite build --configLoader runner --outDir (Join-Path $candidate 'frontend') --emptyOutDir }
} finally { Pop-Location }

Copy-Item -LiteralPath (Join-Path $src 'backend\dist') -Destination (Join-Path $candidate 'backend\dist') -Recurse
foreach ($item in @('package.json', 'package-lock.json', 'prisma')) {
  Copy-Item -LiteralPath (Join-Path $baseCandidate "backend\$item") -Destination (Join-Path $candidate "backend\$item") -Recurse
}

$baseManifest = Get-Content -LiteralPath (Join-Path $baseCandidate 'candidate-manifest.json') -Raw | ConvertFrom-Json
$candidateRoot = (Resolve-Path -LiteralPath $candidate).Path.TrimEnd('\') + '\'
$files = Get-ChildItem -LiteralPath $candidate -Recurse -File | Sort-Object FullName | ForEach-Object {
  [ordered]@{ path = $_.FullName.Substring($candidateRoot.Length).Replace('\', '/'); sha256 = Get-Sha256 $_.FullName }
}
$manifest = [ordered]@{
  format = $baseManifest.format
  releaseSha = $sha
  releaseTree = $sha
  createdAt = [DateTime]::UtcNow.ToString('o')
  nodeVersion = ([string](node --version)).Trim()
  npmVersion = $baseManifest.npmVersion
  artifacts = $baseManifest.artifacts
  sourceNote = "Fonte: $Source (base $BaseSha). $Note releaseSha e o git tree da fonte."
  migrationIntegrity = $baseManifest.migrationIntegrity
  files = @($files)
}
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $candidate 'candidate-manifest.json') -Encoding UTF8

foreach ($project in @('backend', 'frontend')) {
  New-Item -ItemType Directory -Path (Join-Path $deps $project) -Force | Out-Null
  $target = (Get-Item -LiteralPath (Join-Path $baseDeps "$project\node_modules")).Target | Select-Object -First 1
  if (-not $target) { $target = Join-Path $baseDeps "$project\node_modules" }
  New-Item -ItemType Junction -Path (Join-Path $deps "$project\node_modules") -Target $target | Out-Null
}
foreach ($item in @('package.json', 'package-lock.json', 'vite.config.ts')) {
  Copy-Item -LiteralPath (Join-Path $baseDeps "frontend\$item") -Destination (Join-Path $deps "frontend\$item")
}
$depManifest = Get-Content -LiteralPath (Join-Path $baseDeps 'dependency-manifest.json') -Raw | ConvertFrom-Json
$depManifest.releaseSha = $sha
$depManifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $deps 'dependency-manifest.json') -Encoding UTF8

. (Join-Path $root 'scripts\prod\release-candidate.ps1')
$check = Test-ReleaseCandidate -CandidatePath (Resolve-Path -LiteralPath $candidate).Path -ExpectedReleaseSha $sha
Write-Output ($check | ConvertTo-Json -Depth 4 -Compress)
Write-Output ("PACKAGE_OK={0} files={1}" -f $sha, @($files).Count)
