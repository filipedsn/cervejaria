param([string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path)

$ErrorActionPreference = 'Stop'
function Same-Path([string]$A,[string]$B) {
  if ([string]::IsNullOrWhiteSpace($A) -or [string]::IsNullOrWhiteSpace($B)) { return $false }
  try { [IO.Path]::GetFullPath($A).TrimEnd([char[]]@('\','/')) -ieq [IO.Path]::GetFullPath($B).TrimEnd([char[]]@('\','/')) } catch { return $false }
}
. (Join-Path $PSScriptRoot 'dev-runtime-identity.ps1')

$nodeExe = Join-Path $env:ProgramFiles 'nodejs\node.exe'
$runtimeRoot = Join-Path $ProjectRoot 'deploy\dev-artifacts'
$manifest = Get-Content -LiteralPath (Join-Path $runtimeRoot 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$candidateManifest = Get-Content -LiteralPath (Join-Path $runtimeRoot 'candidate-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json

function Get-Record([int]$Id) {
  $p=Get-CimInstance Win32_Process -Filter "ProcessId=$Id" -ErrorAction SilentlyContinue
  if (-not $p) { return $null }
  [pscustomobject]@{Id=[int]$p.ProcessId;Parent=[int]$p.ParentProcessId;Name=[string]$p.Name;Exe=[string]$p.ExecutablePath;Cmd=[string]$p.CommandLine;CreatedTicks=([DateTime]$p.CreationDate).ToUniversalTime().Ticks}
}
function Get-FlatLineage([int]$Id) {
  $items=@(); $next=$Id
  for($n=0;$n -lt 10 -and $next -gt 0;$n++) { $p=Get-Record $next; if(-not $p){break}; $items += $p; $next=$p.Parent }
  return $items
}
function Get-PortListener([int]$Port) {
  $connections=@(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  if($connections.Count -gt 1) { return [pscustomobject]@{Port=$Port;Identity='REFUSED_MULTIPLE_LISTENERS';Count=$connections.Count} }
  if($connections.Count -eq 0) { return [pscustomobject]@{Port=$Port;Identity='NO_LISTENER';Count=0} }
  $c=$connections[0]; $p=Get-Record ([int]$c.OwningProcess)
  [pscustomobject]@{Port=$Port;Address=[string]$c.LocalAddress;Process=$p;Lineage=@(Get-FlatLineage $p.Id)}
}

$apiListener=Get-PortListener 3002
$apiIdentity=$false; $apiHealth=$null; $apiReady=$null; $apiArtifactHashMatch=$false; $apiSnapshot=$null
if($apiListener.Process) {
  $apiHealth=Invoke-RestMethod 'http://127.0.0.1:3002/api/health' -TimeoutSec 6
  $apiReady=Invoke-RestMethod 'http://127.0.0.1:3002/api/ready' -TimeoutSec 6
  $entry=@($candidateManifest.files|Where-Object {$_.path -ieq 'backend/dist/index.js'}|Select-Object -First 1)
  $artifact=Join-Path $runtimeRoot 'backend\dist\index.js'
  if($entry.Count -eq 1 -and (Test-Path -LiteralPath $artifact -PathType Leaf)) {
    $hash=(Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash.ToLowerInvariant()
    $apiArtifactHashMatch=$hash -eq [string]$entry[0].sha256
    $apiIdentity=($candidateManifest.releaseSha -eq $manifest.releaseSha) -and (Test-DevBackendProcessIdentity -Process $apiListener.Process -ExpectedExe $nodeExe -RuntimeRoot $runtimeRoot -ReleaseSha ([string]$manifest.releaseSha) -HealthSha ([string]$apiHealth.releaseSha) -ManifestFileSha ([string]$entry[0].sha256) -ArtifactFileSha $hash -Lineage $apiListener.Lineage)
    $apiSnapshot=Compare-DevProcessSnapshot -Current (Get-Record $apiListener.Process.Id) -Snapshot $apiListener.Process
  }
}

$frontListener=Get-PortListener 5202
$frontIdentity=$false; $frontStatus=$null; $frontSnapshot=$null
if($frontListener.Process) {
  $depsRoot=Join-Path $ProjectRoot "deploy\dev-runtime-dependencies\$($manifest.releaseSha)\frontend"
  $vite=Join-Path $depsRoot 'node_modules\vite\bin\vite.js'
  $frontOut=Join-Path $runtimeRoot 'frontend'
  $frontIdentity=Test-DevFrontendProcessIdentity -Process $frontListener.Process -Address $frontListener.Address -ExpectedExe $nodeExe -ReleaseSha ([string]$manifest.releaseSha) -VitePath $vite -OutputPath $frontOut -Port 5202
  $frontStatus=(Invoke-WebRequest 'http://127.0.0.1:5202/' -TimeoutSec 6 -UseBasicParsing).StatusCode
  $frontSnapshot=Compare-DevProcessSnapshot -Current (Get-Record $frontListener.Process.Id) -Snapshot $frontListener.Process
}

$publicHealth=Invoke-RestMethod 'https://tapdev.quivercloud.com.br/api/health' -TimeoutSec 12
$publicReady=Invoke-RestMethod 'https://tapdev.quivercloud.com.br/api/ready' -TimeoutSec 12
$publicFrontend=(Invoke-WebRequest 'https://tapdev.quivercloud.com.br/' -TimeoutSec 12 -UseBasicParsing).StatusCode
$supervisorPath=[IO.Path]::GetFullPath((Join-Path $ProjectRoot 'scripts\dev\supervisor.ps1'))
$supervisors=@(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -in @('powershell.exe','pwsh.exe') -and $_.CommandLine -and ([string]$_.CommandLine).IndexOf($supervisorPath,[System.StringComparison]::OrdinalIgnoreCase) -ge 0 } | ForEach-Object { [int]$_.ProcessId })

[pscustomobject]@{
  runtimeSha=[string]$manifest.releaseSha
  api=[pscustomobject]@{port=3002;pid=$apiListener.Process.Id;executable=$apiListener.Process.Exe;identity=$apiIdentity;artifactHashMatchesManifest=$apiArtifactHashMatch;healthSha=$apiHealth.releaseSha;readiness=$apiReady.status;database=$apiReady.checks.database.ok;snapshotStable=$apiSnapshot.Match;changedFields=$apiSnapshot.Differences}
  frontend=[pscustomobject]@{port=5202;pid=$frontListener.Process.Id;executable=$frontListener.Process.Exe;identity=$frontIdentity;localStatus=$frontStatus;snapshotStable=$frontSnapshot.Match;changedFields=$frontSnapshot.Differences}
  public=[pscustomobject]@{apiSha=$publicHealth.releaseSha;readiness=$publicReady.status;database=$publicReady.checks.database.ok;frontendStatus=$publicFrontend}
  supervisors=@{count=$supervisors.Count;pids=$supervisors}
  noMutation=$true
} | ConvertTo-Json -Depth 6 -Compress
