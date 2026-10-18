param(
  [switch]$CheckOnly
)

# Recover only the compiled DEV frontend that matches the API currently serving :3002.
# This entry point intentionally never starts, stops, or edits the API.
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"
$paths = Get-DevPaths
. (Join-Path $paths.ProjectRoot 'scripts\prod\release-candidate.ps1')

$artifactRoot = Join-Path $paths.ProjectRoot 'deploy\dev-artifacts'
$manifestPath = Join-Path $artifactRoot 'manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.format -ne 'tap-quiver-dev-runtime/v1' -or $manifest.releaseSha -notmatch '^[a-f0-9]{40}$') {
  throw 'DEV runtime manifest is invalid.'
}

$candidatePath = Join-Path $paths.ProjectRoot $manifest.sourceCandidate
Test-ReleaseCandidate -CandidatePath $candidatePath -ExpectedReleaseSha $manifest.releaseSha -ThrowOnError | Out-Null
$candidateManifestPath = Get-CandidateManifestPath $candidatePath
$candidateManifest = Get-Content -LiteralPath $candidateManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$candidateManifestHash = (Get-FileHash -LiteralPath $candidateManifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($candidateManifestHash -ne $manifest.candidateManifestSha256) {
  throw 'Active DEV candidate manifest checksum mismatch.'
}

$frontendDist = Join-Path $artifactRoot 'frontend'
if (-not (Test-Path -LiteralPath (Join-Path $frontendDist 'index.html') -PathType Leaf)) {
  throw 'Active DEV frontend artifact is missing.'
}
foreach ($file in @($candidateManifest.files | Where-Object { $_.path.StartsWith('frontend/', [StringComparison]::OrdinalIgnoreCase) })) {
  $relativePath = $file.path.Substring('frontend/'.Length).Replace('/', '\')
  $activeFile = Join-Path $frontendDist $relativePath
  if (-not (Test-Path -LiteralPath $activeFile -PathType Leaf) -or
      (Get-FileHash -LiteralPath $activeFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) {
    throw "Active frontend artifact does not match release $($manifest.releaseSha): $relativePath."
  }
}

$dependencyManifestPath = Join-Path $paths.ProjectRoot $manifest.dependencyManifest
$dependencyManifest = Get-Content -LiteralPath $dependencyManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$frontendRuntime = Split-Path $dependencyManifestPath -Parent
$viteEntry = Join-Path $frontendRuntime 'frontend\node_modules\vite\bin\vite.js'
$viteConfig = Join-Path $frontendRuntime 'frontend\vite.config.ts'
if ($dependencyManifest.releaseSha -ne $manifest.releaseSha -or
    -not (Test-Path -LiteralPath $viteEntry -PathType Leaf) -or
    -not (Test-Path -LiteralPath $viteConfig -PathType Leaf)) {
  throw 'Pinned DEV frontend dependencies/config do not match the active release.'
}

# Read-only compatibility check: never alter or restart the active API.
$health = Invoke-RestMethod -Uri "http://127.0.0.1:$($paths.BackendPort)/api/health" -TimeoutSec 8
if ($health.status -ne 'ok' -or $health.releaseSha -ne $manifest.releaseSha) {
  throw "Active API does not match frontend release $($manifest.releaseSha)."
}
$readiness = Invoke-RestMethod -Uri "http://127.0.0.1:$($paths.BackendPort)/api/ready" -TimeoutSec 8
if ($readiness.status -ne 'ready' -or -not $readiness.checks.database.ok) {
  throw 'Active API/database readiness check failed; frontend was not started.'
}

function Get-FrontendListenerIdentity {
  param([int]$Port)

  $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  if ($listeners.Count -eq 0) { return $null }
  if ($listeners.Count -ne 1) { throw "Port $Port has $($listeners.Count) listeners; refusing to start or alter any process." }
  $listener = $listeners[0]
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
  if (-not $process) { throw "Listener PID $($listener.OwningProcess) cannot be inspected; refusing to start a duplicate." }
  return [pscustomobject]@{
    ProcessId = [int]$listener.OwningProcess
    LocalAddress = [string]$listener.LocalAddress
    Name = [string]$process.Name
    ExecutablePath = [string]$process.ExecutablePath
    CommandLine = [string]$process.CommandLine
  }
}

function Get-FrontendProcessIdentity {
  param([int]$ProcessId)
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
  if (-not $process) { return $null }
  return [pscustomobject]@{
    ProcessId = [int]$process.ProcessId
    Name = [string]$process.Name
    ExecutablePath = [string]$process.ExecutablePath
    CommandLine = [string]$process.CommandLine
  }
}

function Test-ExpectedFrontendCommand {
  param([psobject]$Identity)
  if (-not $Identity) { return $false }
  $expectedNode = [IO.Path]::GetFullPath($paths.NodeExe)
  $expectedVite = [IO.Path]::GetFullPath($viteEntry)
  $expectedDist = [IO.Path]::GetFullPath($frontendDist)
  $actualNode = if ($Identity.ExecutablePath) { [IO.Path]::GetFullPath($Identity.ExecutablePath) } else { '' }
  return ($Identity.Name -ieq 'node.exe' -and
    $actualNode -ieq $expectedNode -and
    $Identity.CommandLine.Contains('"' + $expectedVite + '"') -and
    $Identity.CommandLine -match '(?i)(^|\s)preview(\s|$)' -and
    $Identity.CommandLine.Contains($expectedDist) -and
    $Identity.CommandLine.Contains("--host 127.0.0.1") -and
    $Identity.CommandLine.Contains("--port $($paths.FrontendPort)") -and
    $Identity.CommandLine.Contains('--strictPort'))
}

function Test-ExpectedFrontendIdentity {
  param([psobject]$Identity)
  return ($Identity -and $Identity.LocalAddress -eq '127.0.0.1' -and
    (Test-ExpectedFrontendCommand -Identity $Identity))
}

$identity = Get-FrontendListenerIdentity -Port $paths.FrontendPort
if ($identity) {
  if (-not (Test-ExpectedFrontendIdentity -Identity $identity)) {
    throw "Port $($paths.FrontendPort) is occupied by a process that does not match the pinned DEV frontend; it was left untouched. PID $($identity.ProcessId), executable '$($identity.ExecutablePath)', command '$($identity.CommandLine)'."
  }
  Set-Content -LiteralPath $paths.FrontendPidFile -Value $identity.ProcessId -Encoding ASCII
  Write-DevLog -Paths $paths -Message "Frontend DEV compiled release $($manifest.releaseSha) already healthy at :$($paths.FrontendPort), PID $($identity.ProcessId)."
  Write-Output "FRONTEND_ALREADY_ACTIVE=$($identity.ProcessId)"
  if ($CheckOnly) { exit 0 }
  exit 0
}

if ($CheckOnly) {
  Write-Output "FRONTEND_START_PLAN release=$($manifest.releaseSha) port=$($paths.FrontendPort) vite=$viteEntry outDir=$frontendDist host=127.0.0.1 api=$($paths.BackendPort)"
  exit 0
}

if (-not $paths.NodeExe -or -not (Test-Path -LiteralPath $paths.NodeExe -PathType Leaf)) {
  throw 'Node executable is unavailable; frontend was not started.'
}

$process = $null
$existingPid = 0
$pidText = Get-Content -LiteralPath $paths.FrontendPidFile -ErrorAction SilentlyContinue | Select-Object -First 1
if ([int]::TryParse(("" + $pidText).Trim(), [ref]$existingPid) -and $existingPid -gt 0) {
  $existingIdentity = Get-FrontendProcessIdentity -ProcessId $existingPid
  if ($existingIdentity -and (Test-ExpectedFrontendCommand -Identity $existingIdentity)) {
    $process = Get-Process -Id $existingPid -ErrorAction Stop
    Write-DevLog -Paths $paths -Message "Matching frontend start PID $existingPid is still initializing; waiting instead of launching a duplicate."
  } elseif ($existingIdentity) {
    Write-DevLog -Paths $paths -Message "Frontend PID file $existingPid refers to another process; leaving that process untouched and replacing only the stale reference."
  }
}

$oldNodeOptions = $env:NODE_OPTIONS
$oldQuiverEnv = $env:QUIVER_ENV
$oldApiPort = $env:VITE_API_PORT
$oldReleaseSha = $env:VITE_RELEASE_SHA
$oldNodeEnv = $env:NODE_ENV
$env:NODE_OPTIONS = ''
$env:QUIVER_ENV = ''
$env:VITE_API_PORT = [string]$paths.BackendPort
$env:VITE_RELEASE_SHA = $manifest.releaseSha
$env:NODE_ENV = 'development'

try {
  if (-not $process) {
    $arguments = @(
      $viteEntry, 'preview', '--outDir', $frontendDist,
      '--host', '127.0.0.1', '--port', [string]$paths.FrontendPort,
      '--strictPort', '--configLoader', 'runner'
    )
    $process = Start-Process -FilePath $paths.NodeExe -ArgumentList $arguments -WorkingDirectory (Join-Path $frontendRuntime 'frontend') -WindowStyle Hidden -PassThru -RedirectStandardOutput $paths.FrontendLog -RedirectStandardError $paths.FrontendErrLog
    Set-Content -LiteralPath $paths.FrontendPidFile -Value $process.Id -Encoding ASCII
    Write-DevLog -Paths $paths -Message "Frontend DEV recovery launch requested PID $($process.Id), release $($manifest.releaseSha), port $($paths.FrontendPort). API left untouched."
  }

  $deadline = (Get-Date).AddSeconds(60)
  do {
    if ($process.HasExited) {
      $pidFileValue = Get-Content -LiteralPath $paths.FrontendPidFile -ErrorAction SilentlyContinue | Select-Object -First 1
      if (("" + $pidFileValue).Trim() -eq [string]$process.Id) {
        Remove-Item -LiteralPath $paths.FrontendPidFile -Force -ErrorAction SilentlyContinue
      }
      Write-DevLog -Paths $paths -Message "Frontend DEV recovery exited code $($process.ExitCode); inspect $($paths.FrontendErrLog). API left untouched."
      throw "Frontend DEV exited with code $($process.ExitCode); inspect the frontend error log."
    }
    $identity = Get-FrontendListenerIdentity -Port $paths.FrontendPort
    if ($identity) {
      if (-not (Test-ExpectedFrontendIdentity -Identity $identity)) {
        throw "Port $($paths.FrontendPort) became occupied by an unexpected process; it was left untouched. PID $($identity.ProcessId)."
      }
      Set-Content -LiteralPath $paths.FrontendPidFile -Value $identity.ProcessId -Encoding ASCII
      Write-DevLog -Paths $paths -Message "Frontend DEV compiled release $($manifest.releaseSha) ready on :$($paths.FrontendPort), PID $($identity.ProcessId)."
      Write-Output "FRONTEND_READY=$($identity.ProcessId)"
      exit 0
    }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)

  Write-DevLog -Paths $paths -Message "Frontend DEV recovery timed out on :$($paths.FrontendPort); launched process was not stopped. Inspect $($paths.FrontendErrLog). API left untouched."
  throw "Frontend DEV did not become ready within 60 seconds; launched process was not stopped. Inspect the frontend error log."
} finally {
  $env:NODE_OPTIONS = $oldNodeOptions
  $env:QUIVER_ENV = $oldQuiverEnv
  $env:VITE_API_PORT = $oldApiPort
  $env:VITE_RELEASE_SHA = $oldReleaseSha
  $env:NODE_ENV = $oldNodeEnv
}
