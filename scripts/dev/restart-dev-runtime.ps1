param(
  [string]$ExpectedReleaseSha = '4555adf8bcf36a6b0055c67bf1cb97b951a52bb9'
)

# Coordinated DEV-only restart. All service operations require live listener,
# executable, command line, release path and process ancestry validation.
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"
$paths = Get-DevPaths
. (Join-Path $paths.ProjectRoot 'scripts\prod\_config.ps1')
. (Join-Path $paths.ProjectRoot 'scripts\prod\release-candidate.ps1')

$activeRoot = Join-Path $paths.ProjectRoot 'deploy\dev-artifacts'
$activeManifestPath = Join-Path $activeRoot 'manifest.json'
$runtimeLog = Join-Path $paths.LogDir 'dev-runtime-restart.log'
$targetSha = $ExpectedReleaseSha.ToLowerInvariant()

function Write-RestartLog([string]$Message) {
  Add-Content -LiteralPath $runtimeLog -Value ("[{0}] {1}" -f [DateTime]::UtcNow.ToString('o'), $Message) -Encoding UTF8
}

function Get-Proc([int]$Id) {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$Id" -ErrorAction SilentlyContinue
  if (-not $p) { return $null }
  [pscustomobject]@{ Id=[int]$p.ProcessId; Parent=[int]$p.ParentProcessId; Name=[string]$p.Name;
    Exe=[string]$p.ExecutablePath; Cmd=[string]$p.CommandLine;
    CreatedTicks=if($p.CreationDate){([DateTime]$p.CreationDate).ToUniversalTime().Ticks}else{0L} }
}

function Get-Lineage([int]$Id) {
  $items=@(); $next=$Id
  for($n=0;$n -lt 10 -and $next -gt 0;$n++) {
    $p=Get-Proc $next; if(-not $p){break}; $items+= $p; $next=$p.Parent
  }
  # Return the process records as individual pipeline objects. Unary comma here
  # nests the array, making $_ and $_.Cmd arrays inside downstream filters.
  return $items
}

function Get-Listener([int]$Port) {
  $items=@(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  if($items.Count -gt 1){throw "Port $Port has multiple listeners; no process was stopped."}
  if($items.Count -eq 0){return $null}
  $p=Get-Proc ([int]$items[0].OwningProcess); if(-not $p){throw "Port $Port process is not inspectable."}
  [pscustomobject]@{ Address=[string]$items[0].LocalAddress; Process=$p; Lineage=@(ConvertTo-FlatProcessLineage (Get-Lineage $p.Id)) }
}

function Same-Path([string]$A,[string]$B) {
  if(-not $A -or -not $B){return $false}
  [IO.Path]::GetFullPath($A).TrimEnd('\') -ieq [IO.Path]::GetFullPath($B).TrimEnd('\')
}

. (Join-Path $PSScriptRoot 'dev-runtime-identity.ps1')

function Get-ApiProcesses($Listener,[string]$RuntimeRoot,[string]$ReleaseSha) {
  if(-not $Listener){return @()}
  $node=$Listener.Process
  $health=Invoke-RestMethod "http://127.0.0.1:$($paths.BackendPort)/api/health" -TimeoutSec 8
  $candidatePath=Join-Path $RuntimeRoot 'candidate-manifest.json'
  $candidateManifest=Read-Manifest $candidatePath
  $entry=@($candidateManifest.files|Where-Object {$_.path -ieq 'backend/dist/index.js'}|Select-Object -First 1)
  $artifact=Join-Path $RuntimeRoot 'backend\dist\index.js'
  if($candidateManifest.releaseSha -ne $ReleaseSha -or $entry.Count -ne 1 -or -not (Test-Path -LiteralPath $artifact -PathType Leaf)) {
    throw "3002 has an unrecognized listener (PID $($node.Id)); nothing was stopped."
  }
  $chain=@($Listener.Lineage)
  $artifactSha=(Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash.ToLowerInvariant()
  if(-not (Test-DevBackendProcessIdentity -Process $node -ExpectedExe $paths.NodeExe -RuntimeRoot $RuntimeRoot -ReleaseSha $ReleaseSha -HealthSha ([string]$health.releaseSha) -ManifestFileSha ([string]$entry[0].sha256) -ArtifactFileSha $artifactSha -Lineage $chain)) {
    throw "3002 has an unrecognized DEV backend identity (PID $($node.Id)); no process was stopped."
  }
  # Only stop ancestors that are uniquely tied to this verified compiled backend.
  $node | Add-Member -NotePropertyName Service -NotePropertyValue 'API DEV' -Force
  $safe=@($node)
  [string]$backendPath=[IO.Path]::GetFullPath((Join-Path $RuntimeRoot 'backend'))
  foreach($p in $chain | Select-Object -Skip 1) {
    [string]$ancestorName=if($null -eq $p.Name){''}else{[string]$p.Name}
    [string]$ancestorCommand=if($null -eq $p.Cmd){''}else{[string]$p.Cmd}
    if($ancestorName -ieq 'cmd.exe' -and $ancestorCommand -match '(?i)/c.*node.*dist/index\.js') { $safe += $p; continue }
    if($ancestorName -ieq 'node.exe' -and $ancestorCommand -match '(?i)npm-cli\.js.*run\s+start') { $safe += $p; continue }
    if($ancestorName -match '(?i)^powershell(?:\.exe)?$' -and $ancestorCommand -match '(?i)run\s+start' -and (Test-CommandLineContainsPath -CommandLine $ancestorCommand -ExpectedPath $backendPath)) { $safe += $p; continue }
  }
  return $safe
}

function Get-FrontendProcesses($Listener,[string]$ReleaseSha,[string]$RuntimeRoot) {
  if(-not $Listener){return @()}
  $vite=Join-Path $paths.ProjectRoot "deploy\dev-runtime-dependencies\$ReleaseSha\frontend\node_modules\vite\bin\vite.js"
  $out=Join-Path $RuntimeRoot 'frontend'
  $node=$Listener.Process
  if(-not (Test-Path -LiteralPath $vite -PathType Leaf) -or -not (Test-DevFrontendProcessIdentity -Process $node -Address $Listener.Address -ExpectedExe $paths.NodeExe -ReleaseSha $ReleaseSha -VitePath $vite -OutputPath $out -Port $paths.FrontendPort)) {
    throw "5202 has an unrecognized listener (PID $($node.Id)); nothing was stopped."
  }
  $node | Add-Member -NotePropertyName Service -NotePropertyValue 'Frontend DEV' -Force
  return @($node)
}

function Get-Supervisors {
  $expected=[IO.Path]::GetFullPath((Join-Path $paths.ProjectRoot 'scripts\dev\supervisor.ps1'))
  $result=@()
  foreach($p in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue|Where-Object {$_.Name -in @('powershell.exe','pwsh.exe')})) {
    if($p.CommandLine -and $p.CommandLine.Contains($expected)) {
      $result += [pscustomobject]@{Id=[int]$p.ProcessId;Parent=[int]$p.ParentProcessId;Name=[string]$p.Name;Exe=[string]$p.ExecutablePath;Cmd=[string]$p.CommandLine;CreatedTicks=if($p.CreationDate){([DateTime]$p.CreationDate).ToUniversalTime().Ticks}else{0L};Service='DEV supervisor'}
    }
  }
  return ConvertTo-FlatProcessLineage $result
}

function Stop-Verified($Snapshot) {
  $label=if($Snapshot -and $Snapshot.Service){[string]$Snapshot.Service}else{[string]$Snapshot.Name}
  if($Snapshot -is [System.Array]) { $comparison=Compare-DevProcessSnapshot -Current $null -Snapshot $Snapshot }
  else {
    $current=if($Snapshot -and $Snapshot.Id){Get-Proc ([int]$Snapshot.Id)}else{$null}
    if(-not $current){return}
    $comparison=Compare-DevProcessSnapshot -Current $current -Snapshot $Snapshot
  }
  if(-not $comparison.Match) {
    $fields=$comparison.Differences -join ','
    Write-RestartLog "STOP REFUSED service=$label pid=$($comparison.Pid) differingFields=$fields"
    throw "PID $($comparison.Pid) identity changed for $label (fields: $fields); refusing to stop it."
  }
  Stop-Process -Id $comparison.Pid -ErrorAction Stop
  try { Wait-Process -Id $comparison.Pid -Timeout 8 -ErrorAction Stop; return } catch {}
  $current=Get-Proc $comparison.Pid
  if(-not $current){return}
  $comparison=Compare-DevProcessSnapshot -Current $current -Snapshot $Snapshot
  if(-not $comparison.Match) {
    $fields=$comparison.Differences -join ','
    Write-RestartLog "FORCE STOP REFUSED service=$label pid=$($comparison.Pid) differingFields=$fields"
    throw "PID $($comparison.Pid) identity changed before force-stop for $label (fields: $fields); refusing."
  }
  Stop-Process -Id $comparison.Pid -Force -ErrorAction Stop
  Wait-Process -Id $comparison.Pid -Timeout 8 -ErrorAction Stop
}

function Stop-Sequence($Snapshots) {
  $seen=@{}
  foreach($snapshot in $Snapshots) {
    if(-not $snapshot -or $seen.ContainsKey([string]$snapshot.Id)){continue}
    $seen[[string]$snapshot.Id]=$true
    Stop-Verified $snapshot
  }
}

function Stop-Release([string]$Sha,[string]$Root) {
  $api=Get-Listener $paths.BackendPort; $front=Get-Listener $paths.FrontendPort
  $list=@((Get-ApiProcesses $api $Root $Sha)+(Get-FrontendProcesses $front $Sha $Root))
  Stop-Sequence ($list)
}

function Assert-PortsFree {
  foreach($port in @($paths.BackendPort,$paths.FrontendPort)) {
    if(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue){throw "DEV port $port remains occupied."}
  }
}

function Read-Manifest([string]$Path) {
  if(-not (Test-Path -LiteralPath $Path -PathType Leaf)){throw "Manifest missing: $Path"}
  Get-Content -LiteralPath $Path -Raw -Encoding UTF8|ConvertFrom-Json
}

function Wait-Release([string]$Sha) {
  $limit=(Get-Date).AddSeconds(75)
  do {
    try {
      $api=Invoke-RestMethod "http://127.0.0.1:$($paths.BackendPort)/api/health" -TimeoutSec 4
      $ready=Invoke-RestMethod "http://127.0.0.1:$($paths.BackendPort)/api/ready" -TimeoutSec 4
      $front=Invoke-WebRequest "http://127.0.0.1:$($paths.FrontendPort)/" -TimeoutSec 4 -UseBasicParsing
      if($api.releaseSha -eq $Sha -and $ready.status -eq 'ready' -and $ready.checks.database.ok -and $front.StatusCode -eq 200){return}
    } catch {}
    Start-Sleep -Seconds 2
  } while((Get-Date) -lt $limit)
  throw "Release $Sha failed API health/readiness or local frontend check."
}

function Check-Bundle([string]$Sha,[string]$Candidate) {
  $local=(Invoke-WebRequest "http://127.0.0.1:$($paths.FrontendPort)/" -TimeoutSec 10 -UseBasicParsing).Content
  $public=(Invoke-WebRequest 'https://tapdev.quivercloud.com.br/' -TimeoutSec 15 -UseBasicParsing).Content
  $publicHealth=Invoke-RestMethod 'https://tapdev.quivercloud.com.br/api/health' -TimeoutSec 15
  $publicReady=Invoke-RestMethod 'https://tapdev.quivercloud.com.br/api/ready' -TimeoutSec 15
  if($publicHealth.releaseSha -ne $Sha -or $publicReady.status -ne 'ready' -or -not $publicReady.checks.database.ok){
    throw 'Public API health/readiness does not match the activated release.'
  }
  $a=[regex]::Match($local,'assets/[^""''\s]+\.js'); $b=[regex]::Match($public,'assets/[^""''\s]+\.js')
  if(-not $a.Success -or -not $b.Success -or $a.Value -ne $b.Value){throw 'Local/public bundle paths differ or public DEV is unavailable.'}
  $manifest=Get-Content (Get-CandidateManifestPath $Candidate) -Raw -Encoding UTF8|ConvertFrom-Json
  $relative=$a.Value.Replace('/','\')
  $expected=$manifest.files|Where-Object {$_.path -ieq "frontend/$($a.Value)"}|Select-Object -First 1
  $active=Join-Path (Join-Path $paths.ProjectRoot 'deploy\dev-artifacts\frontend') $relative
  if(-not $expected -or (Get-FileHash -LiteralPath $active -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected.sha256){throw 'Active bundle differs from the immutable candidate.'}
  $client=New-Object Net.WebClient
  try {
    foreach($uri in @("http://127.0.0.1:$($paths.FrontendPort)/$($a.Value)","https://tapdev.quivercloud.com.br/$($b.Value)")) {
      $bytes=$client.DownloadData($uri); $sha256=[Security.Cryptography.SHA256]::Create()
      try {$hash=[BitConverter]::ToString($sha256.ComputeHash($bytes)).Replace('-','').ToLowerInvariant()} finally {$sha256.Dispose()}
      if($hash -ne $expected.sha256){throw "Served bundle hash mismatch: $uri"}
    }
  } finally {$client.Dispose()}
}

function Invoke-SyntheticQaSmoke([string]$Sha,[string]$DependencyRoot) {
  $names=@('DEV_QA_RELEASE_SHA','DEV_QA_DEPENDENCY_ROOT','DEV_QA_BASE_URL','DEV_QA_SMOKE_INSPECT_ONLY','NODE_NO_WARNINGS')
  $previous=@{}
  foreach($name in $names){$previous[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
  try {
    [Environment]::SetEnvironmentVariable('DEV_QA_RELEASE_SHA',$Sha,'Process')
    [Environment]::SetEnvironmentVariable('DEV_QA_DEPENDENCY_ROOT',$DependencyRoot,'Process')
    [Environment]::SetEnvironmentVariable('DEV_QA_BASE_URL','https://tapdev.quivercloud.com.br','Process')
    [Environment]::SetEnvironmentVariable('DEV_QA_SMOKE_INSPECT_ONLY','0','Process')
    [Environment]::SetEnvironmentVariable('NODE_NO_WARNINGS','1','Process')
    $runner=Join-Path $paths.ProjectRoot 'backend\scripts\run-with-env.mjs'
    $helper=Join-Path $paths.ProjectRoot 'scripts\dev\dev-qa-auth-smoke.mjs'
    $output=@(& $paths.NodeExe $runner 'development' 'node' $helper 2>&1)
    $exitCode=$LASTEXITCODE
    $record=$output|ForEach-Object {[string]$_}|Where-Object {$_ -like 'DEV_QA_SMOKE_RESULT=*'}|Select-Object -Last 1
    if(-not $record){
      $code=if($exitCode -eq 0){'HARNESS_NO_RESULT'}else{'DEV_ENV_RUNNER_FAILED'}
      return [pscustomobject]@{status='FIXTURE_SETUP_FAILURE';ownerLogin='NOT_RUN';staffLogin='NOT_RUN';fixture='NOT_CREATED';cleanup='NOT_NEEDED';failureCode=$code}
    }
    try {$parsed=($record.Substring('DEV_QA_SMOKE_RESULT='.Length)|ConvertFrom-Json)} catch {
      return [pscustomobject]@{status='FIXTURE_SETUP_FAILURE';ownerLogin='UNKNOWN';staffLogin='UNKNOWN';fixture='UNKNOWN';cleanup='UNKNOWN';failureCode='INVALID_HARNESS_RESULT'}
    }
    return $parsed
  } catch {
    return [pscustomobject]@{status='FIXTURE_SETUP_FAILURE';ownerLogin='NOT_RUN';staffLogin='NOT_RUN';fixture='UNKNOWN';cleanup='UNKNOWN';failureCode='HARNESS_LAUNCH_FAILED'}
  } finally {
    foreach($name in $names){[Environment]::SetEnvironmentVariable($name,$previous[$name],'Process')}
  }
}

if($targetSha -notmatch '^[a-f0-9]{40}$'){throw 'Target SHA must be a full lowercase Git SHA.'}
$pathNode=Get-Command 'node.exe' -ErrorAction SilentlyContinue|Select-Object -First 1
if(-not $pathNode -or -not (Same-Path $pathNode.Source $paths.NodeExe)){throw 'PATH node.exe does not match configured DEV Node executable; runtime was not stopped.'}
$oldManifest=Read-Manifest $activeManifestPath
$oldSha=[string]$oldManifest.releaseSha; $oldRoot=[IO.Path]::GetFullPath($activeRoot)
$candidate=Join-Path $paths.ProjectRoot "deploy\release-candidates\$targetSha"
$deps=Join-Path $paths.ProjectRoot "deploy\dev-runtime-dependencies\$targetSha"
$depManifest=Read-Manifest (Join-Path $deps 'dependency-manifest.json')

# Fail before stopping anything if credentials, immutable inputs, or schema checks are missing.
# Require the non-interactive DEV database guard before any service stop.
if(-not (Test-Path -LiteralPath (Join-Path $paths.ProjectRoot 'backend\scripts\run-with-env.mjs') -PathType Leaf) -or
   -not (Test-Path -LiteralPath (Join-Path $paths.ProjectRoot 'backend\.env.development') -PathType Leaf)){
  throw 'DEV-only QA environment runner/config is missing; runtime was not stopped.'
}Test-ReleaseCandidate -CandidatePath $candidate -ExpectedReleaseSha $targetSha -ThrowOnError|Out-Null
if($depManifest.releaseSha -ne $targetSha -or
   -not (Test-Path (Join-Path $deps 'backend\node_modules\@prisma\client')) -or
   -not (Test-Path (Join-Path $deps 'backend\node_modules\bcryptjs\package.json')) -or
   -not (Test-Path (Join-Path $deps 'frontend\node_modules\vite\bin\vite.js'))){throw 'Target pinned dependencies are incomplete/mismatched.'}
$backendLock=(Get-FileHash (Join-Path $candidate 'backend\package-lock.json') -Algorithm SHA256).Hash.ToLowerInvariant()
$frontendLock=(Get-FileHash (Join-Path $deps 'frontend\package-lock.json') -Algorithm SHA256).Hash.ToLowerInvariant()
if($backendLock -ne $depManifest.backendPackageLockSha256 -or $frontendLock -ne $depManifest.frontendPackageLockSha256){throw 'Pinned dependency lockfile checksum mismatch.'}
& git -C $paths.ProjectRoot diff --quiet $oldSha $targetSha -- backend/prisma/schema.prisma backend/prisma/migrations
if($LASTEXITCODE -ne 0){throw 'Candidate changes schema/migrations; no migration will be applied and no service was stopped.'}
$health=Invoke-RestMethod "http://127.0.0.1:$($paths.BackendPort)/api/health" -TimeoutSec 8
$ready=Invoke-RestMethod "http://127.0.0.1:$($paths.BackendPort)/api/ready" -TimeoutSec 8
if($health.releaseSha -ne $oldSha -or $ready.status -ne 'ready' -or -not $ready.checks.database.ok){throw 'Current API does not match active release or is not ready.'}
$apiProcesses=@(Get-ApiProcesses (Get-Listener $paths.BackendPort) $oldRoot $oldSha)
$frontProcesses=@(Get-FrontendProcesses (Get-Listener $paths.FrontendPort) $oldSha $oldRoot)
$supervisors=@(Get-Supervisors)
$priorFolders=@(Get-ChildItem -LiteralPath (Join-Path $paths.ProjectRoot 'deploy') -Directory -Filter 'dev-artifacts.previous-*' -ErrorAction SilentlyContinue|ForEach-Object FullName)
$transactionStarted=$false
try {
  Write-RestartLog "Preflight PASS; from=$oldSha to=$targetSha; API and frontend processes identified; supervisors=$($supervisors.Count); schema/migrations unchanged."
  foreach($p in $supervisors){Stop-Verified $p}
  Start-Sleep -Seconds 2
  if(@(Get-Supervisors).Count){throw 'A DEV supervisor remains active.'}
  $transactionStarted=$true
  Stop-Sequence (@($frontProcesses)+@($apiProcesses))
  Assert-PortsFree
  & (Join-Path $PSScriptRoot 'publish-dev-release.ps1') -ExpectedReleaseSha $targetSha
  & (Join-Path $PSScriptRoot 'start-dev-artifacts.ps1')
  Wait-Release $targetSha
  Check-Bundle $targetSha $candidate
  $smoke=Invoke-SyntheticQaSmoke $targetSha $deps
  # Authentication is reported separately; the service checks run regardless of login outcome.
  Wait-Release $targetSha
  Check-Bundle $targetSha $candidate
  if($smoke.status -ne 'PASS'){
    Write-RestartLog "Service health/SHA/public checks PASS for $targetSha; synthetic QA smoke=$($smoke.status); owner=$($smoke.ownerLogin); staff=$($smoke.staffLogin); cleanup=$($smoke.cleanup); tag=$($smoke.fixtureTag); code=$($smoke.failureCode). No rollback for an auth/fixture failure while services are healthy."
    Write-Output "DEV_RUNTIME_READY=$targetSha"
    Write-Output 'DEV_SERVICE_CHECK=PASS; health/readiness, local frontend, public API/frontend and bundle SHA verified independently of login'
    Write-Output "DEV_QA_SMOKE=$($smoke.status); owner=$($smoke.ownerLogin); staff=$($smoke.staffLogin); cleanup=$($smoke.cleanup); tag=$($smoke.fixtureTag); code=$($smoke.failureCode)"
    return
  }
  Write-RestartLog "SUCCESS: $targetSha; API health/readiness, local/public frontend bundle and synthetic QA owner/staff login smoke PASS; cleanup=$($smoke.cleanup)."
  Write-Output "DEV_RUNTIME_READY=$targetSha"
  Write-Output 'DEV_SERVICE_CHECK=PASS; health/readiness, local frontend, public API/frontend and bundle SHA verified independently of login'
  Write-Output "DEV_QA_SMOKE=PASS; owner=$($smoke.ownerLogin); staff=$($smoke.staffLogin); cleanup=$($smoke.cleanup)"
} catch {
  $failure=$_.Exception.Message; Write-RestartLog "Restart failed: $failure"
  Write-Output "DEV_SERVICE_CHECK=FAIL; $failure"
  if(-not $transactionStarted){throw}
  try {
    $manifestNow=Read-Manifest $activeManifestPath; $rootNow=[IO.Path]::GetFullPath($activeRoot)
    $apiNow=Get-Listener $paths.BackendPort; $frontNow=Get-Listener $paths.FrontendPort
    Stop-Sequence (@(Get-FrontendProcesses $frontNow $manifestNow.releaseSha $rootNow)+@(Get-ApiProcesses $apiNow $rootNow $manifestNow.releaseSha))
    Assert-PortsFree
    $rollback=@(Get-ChildItem -LiteralPath (Join-Path $paths.ProjectRoot 'deploy') -Directory -Filter 'dev-artifacts.previous-*' -ErrorAction SilentlyContinue|Where-Object {$_.FullName -notin $priorFolders}|Select-Object -ExpandProperty FullName)
    if($rollback.Count -gt 1){throw 'Multiple new rollback folders found; preserved for manual review.'}
    if($rollback.Count -eq 1 -and (Test-Path -LiteralPath $activeRoot)){
      $failed=Join-Path $paths.ProjectRoot "deploy\dev-artifacts.failed-$([DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'))"
      Move-Item -LiteralPath $activeRoot -Destination $failed
      Move-Item -LiteralPath $rollback[0] -Destination $activeRoot
    }
    if(-not (Test-Path -LiteralPath $activeManifestPath)){throw 'No complete active or rollback runtime manifest remains.'}
    $restore=Read-Manifest $activeManifestPath
    & (Join-Path $PSScriptRoot 'start-dev-artifacts.ps1')
    Wait-Release $restore.releaseSha
    $null=Invoke-WebRequest 'https://tapdev.quivercloud.com.br/' -TimeoutSec 15 -UseBasicParsing
    Write-RestartLog "ROLLBACK PASS: prior release $($restore.releaseSha) restored after $failure"
    Write-Output "DEV_ROLLED_BACK=$($restore.releaseSha)"
  } catch {
    Write-RestartLog "ROLLBACK FAILED: $($_.Exception.Message); preserve all release folders and inspect logs."
    throw "Target failed ($failure); prior-release recovery failed ($($_.Exception.Message))."
  }
  throw "Target failed and prior DEV release $($restore.releaseSha) was restored: $failure"
}

