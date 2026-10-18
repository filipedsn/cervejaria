function Test-CommandLineContainsPath {
  param(
    [AllowNull()][object]$CommandLine,
    [AllowNull()][object]$ExpectedPath
  )
  [string]$commandText = if ($null -eq $CommandLine) { '' } else { [string]$CommandLine }
  [string]$pathText = if ($null -eq $ExpectedPath) { '' } else { [string]$ExpectedPath }
  if ([string]::IsNullOrWhiteSpace($commandText) -or [string]::IsNullOrWhiteSpace($pathText)) { return $false }
  try { $pathText = [string][IO.Path]::GetFullPath($pathText) } catch { return $false }
  [System.StringComparison]$comparison = [System.StringComparison]::OrdinalIgnoreCase
  $expected = $pathText.TrimEnd([char[]]@([char]92,[char]47))
  foreach ($match in [regex]::Matches($commandText, '"([^"]+)"|''([^'']+)''|([^\s"'']+)')) {
    if ($match.Groups[1].Success) { $candidate = $match.Groups[1].Value }
    elseif ($match.Groups[2].Success) { $candidate = $match.Groups[2].Value }
    else { $candidate = $match.Groups[3].Value }
    try { $candidate = [string][IO.Path]::GetFullPath($candidate).TrimEnd([char[]]@([char]92,[char]47)) } catch { continue }
    if ([string]::Equals($candidate, $expected, $comparison)) { return $true }
  }
  return $false
}

function ConvertTo-FlatProcessLineage {
  param([AllowNull()][object[]]$Lineage = @())
  $flat = New-Object 'System.Collections.Generic.List[object]'
  foreach ($item in $Lineage) {
    if ($null -eq $item) { continue }
    if ($item -is [System.Array]) {
      foreach ($nestedItem in $item) { if ($null -ne $nestedItem) { $flat.Add($nestedItem) } }
    } else { $flat.Add($item) }
  }
  return $flat.ToArray()
}

function Compare-DevProcessSnapshot {
  param([AllowNull()][object]$Current,[AllowNull()][object]$Snapshot)
  $differences = New-Object 'System.Collections.Generic.List[string]'
  if ($null -eq $Current) { $differences.Add('ProcessMissing') }
  if ($null -eq $Snapshot) { $differences.Add('SnapshotMissing') }
  if ($null -ne $Current -and $Current -is [System.Array]) { $differences.Add('CurrentShape') }
  $wrappedPid=$null
  if ($null -ne $Snapshot -and $Snapshot -is [System.Array]) {
    $differences.Add('SnapshotShape')
    $wrappedItems=@(ConvertTo-FlatProcessLineage $Snapshot)
    if ($wrappedItems.Count -eq 1 -and $null -ne $wrappedItems[0].PSObject.Properties['Id'] -and $null -ne $wrappedItems[0].Id) { $wrappedPid=[int]$wrappedItems[0].Id }
  }
  if ($differences.Count -gt 0) { return [pscustomobject]@{ Match=$false; Pid=$wrappedPid; Differences=$differences.ToArray() } }

  $properties = @('Id','Name','Exe','Cmd','CreatedTicks')
  foreach ($name in $properties) {
    $currentProperty = $Current.PSObject.Properties[$name]
    $snapshotProperty = $Snapshot.PSObject.Properties[$name]
    if ($null -eq $currentProperty -or $null -eq $snapshotProperty) { $differences.Add($name); continue }
    $a = $currentProperty.Value
    $b = $snapshotProperty.Value
    if ($null -eq $a -or $null -eq $b) { $differences.Add($name); continue }
    switch ($name) {
      'Id' { if ([int]$a -ne [int]$b) { $differences.Add($name) } }
      'Name' { if (-not [string]::Equals([string]$a,[string]$b,[System.StringComparison]::OrdinalIgnoreCase)) { $differences.Add($name) } }
      'Exe' {
        try { $left=[IO.Path]::GetFullPath([string]$a).TrimEnd([char[]]@('\','/')); $right=[IO.Path]::GetFullPath([string]$b).TrimEnd([char[]]@('\','/')) }
        catch { $differences.Add($name); continue }
        if (-not [string]::Equals($left,$right,[System.StringComparison]::OrdinalIgnoreCase)) { $differences.Add($name) }
      }
      'Cmd' { if (-not [string]::Equals([string]$a,[string]$b,[System.StringComparison]::Ordinal)) { $differences.Add($name) } }
      'CreatedTicks' { if ([long]$a -ne [long]$b) { $differences.Add($name) } }
    }
  }
  $pidValue = $null
  if ($null -ne $Snapshot.PSObject.Properties['Id'] -and $null -ne $Snapshot.Id) { $pidValue=[int]$Snapshot.Id }
  return [pscustomobject]@{ Match=($differences.Count -eq 0); Pid=$pidValue; Differences=$differences.ToArray() }
}

function Test-DevBackendProcessIdentity {
  param(
    [Parameter(Mandatory)]$Process,
    [Parameter(Mandatory)][string]$ExpectedExe,
    [Parameter(Mandatory)][string]$RuntimeRoot,
    [Parameter(Mandatory)][string]$ReleaseSha,
    [Parameter(Mandatory)][string]$HealthSha,
    [Parameter(Mandatory)][string]$ManifestFileSha,
    [Parameter(Mandatory)][string]$ArtifactFileSha,
    [object[]]$Lineage = @()
  )
  if ($Process.Name -ine 'node.exe' -or -not (Same-Path ([string]$Process.Exe) $ExpectedExe)) { return $false }
  [string]$processCommand = if ($null -eq $Process.Cmd) { '' } else { [string]$Process.Cmd }
  if ($processCommand -notmatch '(?i)(^|\s)node(?:\.exe)?\s+(?:--import\s+@elastic/opentelemetry-node\s+)?dist/index\.js(?:\s|$)') { return $false }
  if ($ReleaseSha -notmatch '^[a-f0-9]{40}$' -or $HealthSha -ine $ReleaseSha -or $ManifestFileSha -notmatch '^[a-f0-9]{64}$' -or $ArtifactFileSha -ine $ManifestFileSha) { return $false }
  $root = [IO.Path]::GetFullPath($RuntimeRoot)
  $lineageItems = @(ConvertTo-FlatProcessLineage $Lineage)
  $launchers = @($lineageItems | Where-Object {
    $nameValue = if ($null -eq $_.Name) { '' } else { [string]$_.Name }
    $commandValue = if ($null -eq $_.Cmd) { '' } else { [string]$_.Cmd }
    [string]$name = $nameValue
    [string]$command = $commandValue
    $name -match '(?i)^powershell(?:\.exe)?$' -and $command -match '(?i)run\s+start'
  })
  if ($launchers.Count -gt 0) {
    [string]$backendPath = [IO.Path]::GetFullPath((Join-Path $root 'backend'))
    $matchingLauncher = $false
    foreach ($launcher in $launchers) {
      if (Test-CommandLineContainsPath -CommandLine $launcher.Cmd -ExpectedPath $backendPath) { $matchingLauncher = $true; break }
    }
    if (-not $matchingLauncher) { return $false }
  }
  return $true
}

function Test-DevFrontendProcessIdentity {
  param(
    [Parameter(Mandatory)]$Process,
    [Parameter(Mandatory)][string]$Address,
    [Parameter(Mandatory)][string]$ExpectedExe,
    [Parameter(Mandatory)][string]$ReleaseSha,
    [Parameter(Mandatory)][string]$VitePath,
    [Parameter(Mandatory)][string]$OutputPath,
    [Parameter(Mandatory)][int]$Port
  )
  [string]$cmd = if ($null -eq $Process.Cmd) { '' } else { [string]$Process.Cmd }
  if ($Process.Name -ine 'node.exe' -or -not (Same-Path ([string]$Process.Exe) $ExpectedExe)) { return $false }
  if ($Address -notin @('127.0.0.1','0.0.0.0','::','::1') -or $ReleaseSha -notmatch '^[a-f0-9]{40}$') { return $false }
  if (-not (Test-CommandLineContainsPath -CommandLine $cmd -ExpectedPath $VitePath) -or
      $cmd -notmatch '(?i)(^|\s)preview(\s|$)' -or
      -not (Test-CommandLineContainsPath -CommandLine $cmd -ExpectedPath $OutputPath) -or
      $cmd -notmatch ('(?i)--port\s+' + $Port + '(\s|$)') -or
      $cmd -notmatch '(?i)--strictPort' -or
      $cmd -notmatch '(?i)--host\s+(127\.0\.0\.1|0\.0\.0\.0)') { return $false }
  if ($cmd -notmatch [regex]::Escape($ReleaseSha)) { return $false }
  return $true
}
