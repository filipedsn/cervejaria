$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"
$paths = Get-DevPaths
. (Join-Path $paths.ProjectRoot 'scripts\prod\_config.ps1')
. (Join-Path $paths.ProjectRoot 'scripts\dev\_config.ps1')
. (Join-Path $paths.ProjectRoot 'scripts\prod\release-candidate.ps1')

$artifactRoot = Join-Path $paths.ProjectRoot 'deploy\dev-artifacts'
$manifestPath = Join-Path $artifactRoot 'manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.format -ne 'tap-quiver-dev-runtime/v1' -or $manifest.releaseSha -notmatch '^[a-f0-9]{40}$') {
  throw 'DEV runtime manifest is invalid.'
}
$candidatePath = Join-Path $paths.ProjectRoot $manifest.sourceCandidate
Test-ReleaseCandidate -CandidatePath $candidatePath -ExpectedReleaseSha $manifest.releaseSha -ThrowOnError | Out-Null
$candidateManifestHash = (Get-FileHash -LiteralPath (Get-CandidateManifestPath $candidatePath) -Algorithm SHA256).Hash.ToLowerInvariant()
if ($candidateManifestHash -ne $manifest.candidateManifestSha256) { throw 'Active DEV candidate manifest checksum mismatch.' }
if (-not (Test-Path (Join-Path $artifactRoot 'frontend\index.html')) -or -not (Test-Path (Join-Path $artifactRoot 'backend\dist\index.js'))) {
  throw 'Active DEV runtime artifacts are incomplete.'
}

$dependencyManifestPath = Join-Path $paths.ProjectRoot $manifest.dependencyManifest
$dependencyManifest = Get-Content -LiteralPath $dependencyManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($dependencyManifest.releaseSha -ne $manifest.releaseSha -or -not (Test-Path (Join-Path $artifactRoot 'backend\node_modules\@prisma\client')) -or -not (Test-Path (Join-Path (Split-Path $dependencyManifestPath -Parent) 'frontend\node_modules\vite\bin\vite.js'))) {
  throw 'Pinned DEV runtime dependencies do not match the active release.'
}

$nodeDir = Split-Path $paths.NpmCmd -Parent
$env:Path = "$nodeDir;$env:Path"
$env:NODE_ENV = 'development'
Import-BackendEnvFile -BackendDir $paths.BackendDir -Environment development
$env:RELEASE_SHA = $manifest.releaseSha
$env:VITE_RELEASE_SHA = $manifest.releaseSha
$env:PORT = [string]$paths.BackendPort
$env:HOST = '0.0.0.0'
$env:FRONTEND_DIST = Join-Path $artifactRoot 'frontend'
if ($env:UPLOADS_DIR -and -not [IO.Path]::IsPathRooted($env:UPLOADS_DIR)) {
  $env:UPLOADS_DIR = [IO.Path]::GetFullPath((Join-Path $paths.BackendDir $env:UPLOADS_DIR))
}

function Start-DevArtifactService {
  param([string]$Label, [string]$WorkingDir, [string[]]$NpmArgs, [string]$PidFile, [int]$Port, [string]$StdoutLog, [string]$StderrLog)
  if (Test-DevPortListening -Port $Port) { throw "$Label port $Port is already occupied; refusing to serve a different process." }
  if (Test-Path -LiteralPath $PidFile) {
    $identity = Test-ManagedPidFile -PidFile $PidFile -ExpectedProcessNames @('node.exe')
    if ($identity.State -eq 'REUSED') { Write-DevLog -Paths $paths -Message "$Label stale/reused PID reference discarded." }
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
  }
  $proc = Start-HiddenNpm -NpmCmd $paths.NpmCmd -WorkingDirectory $WorkingDir -NpmArgs $NpmArgs -StdoutLog $StdoutLog -StderrLog $StderrLog
  Set-Content -LiteralPath $PidFile -Value $proc.Id -Encoding ASCII
  $deadline = (Get-Date).AddSeconds(90)
  do {
    if ($proc.HasExited) { throw "$Label exited with code $($proc.ExitCode). Inspect DEV logs." }
    if (Test-DevPortListening -Port $Port) {
      $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess
      if ($listener) { Set-Content -LiteralPath $PidFile -Value $listener -Encoding ASCII }
      return
    }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  throw "$Label did not become ready on port $Port."
}

$savedNodeOptions = $env:NODE_OPTIONS
$env:NODE_OPTIONS = if ($savedNodeOptions -and $savedNodeOptions -notlike '*opentelemetry-node*') { $savedNodeOptions } else { '' }
try {
  Start-DevArtifactService -Label 'API DEV compiled release' -WorkingDir (Join-Path $artifactRoot 'backend') -NpmArgs @('run','start') -PidFile $paths.BackendPidFile -Port $paths.BackendPort -StdoutLog $paths.BackendLog -StderrLog $paths.BackendErrLog
  $env:NODE_OPTIONS = ''
  $env:VITE_API_PORT = [string]$paths.BackendPort
  $frontendDependencies = Join-Path (Split-Path $dependencyManifestPath -Parent) 'frontend'
  Start-DevArtifactService -Label 'Frontend DEV compiled release' -WorkingDir $frontendDependencies -NpmArgs @('run','preview','--','--outDir',(Join-Path $artifactRoot 'frontend'),'--host','0.0.0.0','--port',[string]$paths.FrontendPort,'--strictPort','--configLoader','runner') -PidFile $paths.FrontendPidFile -Port $paths.FrontendPort -StdoutLog $paths.FrontendLog -StderrLog $paths.FrontendErrLog
} catch {
  Stop-ManagedPidFile -PidFile $paths.FrontendPidFile -ExpectedProcessNames @('node.exe') -CommandLinePatterns @('vite') -Label 'Frontend DEV failed start' | Out-Null
  Stop-ManagedPidFile -PidFile $paths.BackendPidFile -ExpectedProcessNames @('node.exe') -CommandLinePatterns @('backend') -Label 'API DEV failed start' | Out-Null
  throw
} finally {
  $env:NODE_OPTIONS = $savedNodeOptions
}

Write-DevLog -Paths $paths -Message "Compiled DEV release $($manifest.releaseSha) serving frontend and backend artifacts."
Write-Host "DEV artifacts active: $($manifest.releaseSha)" -ForegroundColor Green
Write-Host "Local: http://localhost:$($paths.FrontendPort) (API :$($paths.BackendPort))" -ForegroundColor Green
Write-Host 'Public DEV: https://tapdev.quivercloud.com.br' -ForegroundColor Cyan
