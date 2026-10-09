function Get-GitBlobSha256 {
  param(
    [Parameter(Mandatory=$true)][string]$RepositoryPath,
    [Parameter(Mandatory=$true)][string]$BlobObjectId
  )

  if ($BlobObjectId -notmatch '^[0-9a-f]{40,64}$') { throw 'Invalid Git blob object ID.' }
  $quotedRepositoryPath = '"{0}"' -f $RepositoryPath.Replace('"', '\"')
  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo.FileName = 'git'
  $process.StartInfo.Arguments = "-C $quotedRepositoryPath cat-file blob $BlobObjectId"
  $process.StartInfo.UseShellExecute = $false
  $process.StartInfo.RedirectStandardOutput = $true
  if (-not $process.Start()) { throw 'Could not start git cat-file.' }

  $buffer = [System.IO.MemoryStream]::new()
  try {
    $process.StandardOutput.BaseStream.CopyTo($buffer)
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw "git cat-file failed for blob $BlobObjectId." }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
      $digest = $sha.ComputeHash($buffer.ToArray())
      return ([System.BitConverter]::ToString($digest).Replace('-', '').ToLowerInvariant())
    } finally {
      $sha.Dispose()
    }
  } finally {
    $buffer.Dispose()
    $process.Dispose()
  }
}

function Assert-GitWorkingFileMatchesBlob {
  param(
    [Parameter(Mandatory=$true)][string]$RepositoryPath,
    [Parameter(Mandatory=$true)][string]$GitPath,
    [Parameter(Mandatory=$true)][string]$WorkingFile,
    [Parameter(Mandatory=$true)][string]$BlobObjectId
  )

  $workingBlob = git -C $RepositoryPath hash-object "--path=$GitPath" -- $WorkingFile
  if ($LASTEXITCODE -ne 0 -or $workingBlob -ne $BlobObjectId) {
    throw "Migration file differs from the selected Git revision: $GitPath"
  }
}
