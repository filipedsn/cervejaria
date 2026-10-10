$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\dev-runtime-identity.ps1"
function Same-Path([string]$A,[string]$B) {
  if (-not $A -or -not $B) { return $false }
  [IO.Path]::GetFullPath($A).TrimEnd('\') -ieq [IO.Path]::GetFullPath($B).TrimEnd('\')
}
function Assert([bool]$Condition,[string]$Name) { if (-not $Condition) { throw "FAIL: $Name" }; Write-Output "PASS: $Name" }
$root='C:\DEV Work\Cervejaria'
$sha='4555adf8bcf36a6b0055c67bf1cb97b951a52bb9'
$exe='C:\Program Files\nodejs\node.exe'
$backend=[pscustomobject]@{Name='node.exe';Exe=$exe;Cmd='node --import @elastic/opentelemetry-node dist/index.js'}
$base=@{Process=$backend;ExpectedExe=$exe;RuntimeRoot=$root;ReleaseSha=$sha;HealthSha=$sha;ManifestFileSha=('a'*64);ArtifactFileSha=('a'*64)}
Assert (Test-DevBackendProcessIdentity @base) 'compiled backend artifact and release health match'
$noParentArgs=$base.Clone(); $noParentArgs.Lineage=@()
Assert (Test-DevBackendProcessIdentity @noParentArgs) 'missing parent is accepted with artifact proof'
$launcher=[pscustomobject]@{Name='powershell.exe';Cmd="Set-Location -LiteralPath '$root\backend'; & 'C:\Program Files\nodejs\npm.cmd' run start"}
 $launcherArgs=$base.Clone(); $launcherArgs.Lineage=@($launcher)
Assert (Test-DevBackendProcessIdentity @launcherArgs) 'launcher path with spaces is recognized'
$nestedLineage=[System.Array]::CreateInstance([object],1); $nestedLineage.SetValue(@($launcher),0)
$nestedArgs=$base.Clone(); $nestedArgs.Lineage=$nestedLineage
Assert (Test-DevBackendProcessIdentity @nestedArgs) 'nested ancestry is flattened before command path matching'
$flatLineage=@(ConvertTo-FlatProcessLineage $nestedLineage)
Assert ($flatLineage.Count -eq 1 -and $flatLineage[0].Cmd -is [string]) 'production lineage normalization returns process records, not nested arrays'
Assert (Test-CommandLineContainsPath -CommandLine $launcher.Cmd -ExpectedPath (Join-Path $root 'backend')) 'command/path/comparison values normalize in Windows PowerShell'
Assert (-not (Test-CommandLineContainsPath -CommandLine $null -ExpectedPath (Join-Path $root 'backend'))) 'missing command line is rejected safely'
Assert (-not (Test-CommandLineContainsPath -CommandLine $launcher.Cmd -ExpectedPath $null)) 'missing expected path is rejected safely'
$wrongBackend=$backend.PSObject.Copy(); $wrongBackend.Cmd='node server.js'
$wrongBackendArgs=$base.Clone(); $wrongBackendArgs.Process=$wrongBackend
Assert (-not (Test-DevBackendProcessIdentity @wrongBackendArgs)) 'incompatible backend command is refused'
$wrongExeBackend=$backend.PSObject.Copy(); $wrongExeBackend.Exe='C:\Other Runtime\node.exe'
$wrongExeArgs=$base.Clone(); $wrongExeArgs.Process=$wrongExeBackend
Assert (-not (Test-DevBackendProcessIdentity @wrongExeArgs)) 'incompatible Node executable is refused'
$foreignLauncher=[pscustomobject]@{Name='powershell.exe';Cmd="Set-Location -LiteralPath 'C:\Other Runtime\backend'; npm.cmd run start"}
$foreignLineageArgs=$base.Clone(); $foreignLineageArgs.Lineage=@($foreignLauncher)
Assert (-not (Test-DevBackendProcessIdentity @foreignLineageArgs)) 'launcher ancestry pointing elsewhere is refused'
$wrongHealthArgs=$base.Clone(); $wrongHealthArgs.HealthSha='b'*40
Assert (-not (Test-DevBackendProcessIdentity @wrongHealthArgs)) 'backend health SHA mismatch is refused'
$vite=Join-Path $root "deploy\dev-runtime-dependencies\$sha\frontend\node_modules\vite\bin\vite.js"
$out=Join-Path $root 'deploy\dev-artifacts\frontend'
$frontend=[pscustomobject]@{Name='node.exe';Exe=$exe;Cmd="node `"$vite`" preview --outDir `"$out`" --host 127.0.0.1 --port 5202 --strictPort --configLoader runner"}
$frontArgs=@{Process=$frontend;Address='127.0.0.1';ExpectedExe=$exe;ReleaseSha=$sha;VitePath=$vite;OutputPath=$out;Port=5202}
Assert (Test-DevFrontendProcessIdentity @frontArgs) 'Vite preview with paths containing spaces is recognized'
$viteAlias=Join-Path $root "deploy\dev-runtime-dependencies\$sha\frontend\node_modules\.bin\\..\vite\bin\vite.js"
$frontendAlias=$frontend.PSObject.Copy(); $frontendAlias.Cmd="node `"$viteAlias`" preview --outDir `"$out`" --host 0.0.0.0 --port 5202 --strictPort --configLoader runner"
$aliasArgs=$frontArgs.Clone(); $aliasArgs.Process=$frontendAlias; $aliasArgs.Address='0.0.0.0'
Assert (Test-DevFrontendProcessIdentity @aliasArgs) 'Vite .bin parent path alias and all-interface listener are recognized'
$badFrontend=$frontend.PSObject.Copy(); $badFrontend.Cmd=$badFrontend.Cmd.Replace('--port 5202','--port 5173')
$badFrontendArgs=$frontArgs.Clone(); $badFrontendArgs.Process=$badFrontend
Assert (-not (Test-DevFrontendProcessIdentity @badFrontendArgs)) 'incompatible frontend port is refused'
$wrongExeFrontend=$frontend.PSObject.Copy(); $wrongExeFrontend.Exe='C:\Other Runtime\node.exe'
$wrongExeFrontendArgs=$frontArgs.Clone(); $wrongExeFrontendArgs.Process=$wrongExeFrontend
Assert (-not (Test-DevFrontendProcessIdentity @wrongExeFrontendArgs)) 'incompatible frontend executable is refused'

$identitySnapshot=[pscustomobject]@{Id=77331;Name='powershell.exe';Exe='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe';Cmd="powershell.exe -File `"$root\scripts\dev\supervisor.ps1`"";CreatedTicks=638956800000000000;Service='DEV supervisor'}
$identityCurrent=$identitySnapshot.PSObject.Copy()
Assert (Compare-DevProcessSnapshot -Current $identityCurrent -Snapshot $identitySnapshot).Match 'unchanged process snapshot matches'
$changedCommand=$identityCurrent.PSObject.Copy(); $changedCommand.Cmd+=' -different'
$commandDiff=Compare-DevProcessSnapshot -Current $changedCommand -Snapshot $identitySnapshot
Assert (-not $commandDiff.Match -and $commandDiff.Differences -contains 'Cmd') 'changed command line is reported and refused'
$reusedPid=$identityCurrent.PSObject.Copy(); $reusedPid.CreatedTicks++
$reuseDiff=Compare-DevProcessSnapshot -Current $reusedPid -Snapshot $identitySnapshot
Assert (-not $reuseDiff.Match -and $reuseDiff.Differences -contains 'CreatedTicks') 'PID reuse is reported and refused'
$wrappedSnapshot=[System.Array]::CreateInstance([object],1); $wrappedSnapshot.SetValue($identitySnapshot,0)
$shapeDiff=Compare-DevProcessSnapshot -Current $identityCurrent -Snapshot $wrappedSnapshot
Assert (-not $shapeDiff.Match -and $shapeDiff.Differences -contains 'SnapshotShape' -and $shapeDiff.Pid -eq $identitySnapshot.Id) 'array-wrapped process snapshot is refused with shape evidence and reported PID'
