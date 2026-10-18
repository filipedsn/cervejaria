# DEV-only swap: 9d5e615 -> 2f03c3a (fiado quitado depois). Never touches port 3001 / prod-artifacts.
$ErrorActionPreference = 'Stop'
$root = 'C:\Users\Papai\Documents\Desenvolvimento\Cervejaria'
$fromSha = '9d5e615ce785c83164c8e8ce4f716288284c4c86'
$toSha = '2f03c3a23a0f0f090f0097087d2ff853f67b9ca1'
$log = Join-Path $root ("deploy\logs\dev-swap-fiado-{0}.log" -f [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'))
Start-Transcript -Path $log -Force | Out-Null

function Get-Listener([int]$Port) {
  $c = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  if ($c.Count -eq 0) { return $null }
  if ($c.Count -gt 1 -and @($c | Select-Object -ExpandProperty OwningProcess -Unique).Count -gt 1) { throw "Port $Port has multiple owners." }
  Get-CimInstance Win32_Process -Filter "ProcessId=$($c[0].OwningProcess)"
}

function Assert-DevIdentity($Proc, [string]$Kind, [string]$Sha) {
  if (-not $Proc) { return }
  $cmd = [string]$Proc.CommandLine
  if ($Proc.Name -ne 'node.exe') { throw "$Kind listener is not node.exe (PID $($Proc.ProcessId))." }
  if ($cmd -match '(?i)prod-artifacts') { throw "$Kind listener references prod-artifacts; refusing." }
  if ($Kind -eq 'api' -and $cmd -notmatch '(?i)dist[\\/]index\.js') { throw "API listener is not a compiled DEV backend: $cmd" }
  if ($Kind -eq 'front' -and ($cmd -notmatch '(?i)vite' -or $cmd -notmatch [regex]::Escape("dev-runtime-dependencies\$Sha"))) { throw "Frontend listener is not the DEV vite preview of ${Sha}: $cmd" }
  $cwdOk = $true
  if ($Kind -eq 'api') {
    $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($Proc.ParentProcessId)" -ErrorAction SilentlyContinue
    Write-Output "API parent: $($parent.Name) $($parent.CommandLine)"
  }
  Write-Output "$Kind identity OK: PID $($Proc.ProcessId) $cmd"
}

function Stop-Listener([int]$Port) {
  $p = Get-Listener $Port
  if (-not $p) { return }
  Stop-Process -Id $p.ProcessId -Force
  Wait-Process -Id $p.ProcessId -Timeout 15 -ErrorAction SilentlyContinue
}

function Wait-PortsFree {
  $deadline = (Get-Date).AddSeconds(30)
  do {
    if (-not (Get-Listener 3002) -and -not (Get-Listener 5202)) { return }
    Start-Sleep -Seconds 1
  } while ((Get-Date) -lt $deadline)
  throw 'DEV ports did not free up.'
}

function Wait-Release([string]$Sha) {
  $deadline = (Get-Date).AddSeconds(90)
  do {
    try {
      $h = Invoke-RestMethod 'http://127.0.0.1:3002/api/health' -TimeoutSec 4
      $r = Invoke-RestMethod 'http://127.0.0.1:3002/api/ready' -TimeoutSec 4
      $f = Invoke-WebRequest 'http://127.0.0.1:5202/' -TimeoutSec 4 -UseBasicParsing
      if ($h.releaseSha -eq $Sha -and $r.status -eq 'ready' -and $f.StatusCode -eq 200) { return }
    } catch {}
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  throw "Release $Sha did not become healthy."
}

$prodBefore = Get-Listener 3001
$stopped = $false
try {
  $manifest = Get-Content (Join-Path $root 'deploy\dev-artifacts\manifest.json') -Raw | ConvertFrom-Json
  if ($manifest.releaseSha -ne $fromSha) { throw "Active DEV is $($manifest.releaseSha), expected $fromSha." }
  $health = Invoke-RestMethod 'http://127.0.0.1:3002/api/health' -TimeoutSec 8
  if ($health.releaseSha -ne $fromSha) { throw "DEV API reports $($health.releaseSha), expected $fromSha." }
  Assert-DevIdentity (Get-Listener 3002) 'api' $fromSha
  Assert-DevIdentity (Get-Listener 5202) 'front' $fromSha

  $stopped = $true
  Stop-Listener 5202
  Stop-Listener 3002
  Wait-PortsFree
  Start-Sleep -Seconds 3
  Write-Output 'DEV stopped.'

  $attempt = 0
  while ($true) {
    try { & (Join-Path $root 'scripts\dev\publish-dev-release.ps1') -ExpectedReleaseSha $toSha; break }
    catch { $attempt++; if ($attempt -ge 3) { throw }; Write-Output "publish retry $attempt after: $($_.Exception.Message)"; Start-Sleep -Seconds 5 }
  }
  & (Join-Path $root 'scripts\dev\start-dev-artifacts.ps1')
  Wait-Release $toSha
  Write-Output "DEV_SWAP_OK=$toSha"
} catch {
  Write-Output "DEV_SWAP_FAILED: $($_.Exception.Message)"
  if ($stopped) {
    try {
      Stop-Listener 5202; Stop-Listener 3002; Wait-PortsFree; Start-Sleep -Seconds 3
      $active = Join-Path $root 'deploy\dev-artifacts'
      $current = if (Test-Path "$active\manifest.json") { (Get-Content "$active\manifest.json" -Raw | ConvertFrom-Json).releaseSha } else { '' }
      if ($current -ne $fromSha) {
        $previous = Get-ChildItem (Join-Path $root 'deploy') -Directory -Filter 'dev-artifacts.previous-*' | Sort-Object Name -Descending |
          Where-Object { (Test-Path "$($_.FullName)\manifest.json") -and ((Get-Content "$($_.FullName)\manifest.json" -Raw | ConvertFrom-Json).releaseSha -eq $fromSha) } | Select-Object -First 1
        if (-not $previous) { throw 'No previous 9d5e615 runtime folder found.' }
        if (Test-Path $active) { Move-Item $active (Join-Path $root ("deploy\dev-artifacts.failed-{0}-fiado" -f [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'))) }
        Move-Item $previous.FullName $active
      }
      & (Join-Path $root 'scripts\dev\start-dev-artifacts.ps1')
      Wait-Release $fromSha
      Write-Output "DEV_ROLLED_BACK=$fromSha"
    } catch {
      Write-Output "DEV_ROLLBACK_FAILED: $($_.Exception.Message)"
    }
  }
} finally {
  $prodAfter = Get-Listener 3001
  Write-Output ("PROD listener before={0} after={1}" -f $prodBefore.ProcessId, $prodAfter.ProcessId)
  Stop-Transcript | Out-Null
}
