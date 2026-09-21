param(
  [ValidateSet('development','production')]
  [string]$Environment = 'development',
  [string]$DestinationDir = '',
  [string]$OffHostDir = '',
  [int]$DailyRetention = 7,
  [int]$WeeklyRetention = 4
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$profile = if ($Environment -eq 'development') {
  @{ Container='cervejaria-db-dev'; Database='cervejaria_dev'; Prefix='backup-dev' }
} else {
  @{ Container='cervejaria-db'; Database='cervejaria'; Prefix='backup-prod' }
}
$local = if ($DestinationDir) { [IO.Path]::GetFullPath($DestinationDir) } else { Join-Path $root "deploy\backups-$Environment" }
New-Item -ItemType Directory -Force -Path $local | Out-Null
$stamp = Get-Date -Format 'yyyy-MM-dd-HHmmss'
$name = "$($profile.Prefix)-$stamp.sql"
$file = Join-Path $local $name
$containerFile = "/tmp/$name"

function Apply-Retention {
  param([string]$Directory)
  $dumps = @(Get-ChildItem -LiteralPath $Directory -Filter "$($profile.Prefix)-*.sql" -File | Sort-Object LastWriteTime -Descending)
  $keep = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $dumps | Select-Object -First $DailyRetention | ForEach-Object { [void]$keep.Add($_.Name) }
  $weekly = @{}
  foreach ($dump in $dumps) {
    $week = '{0}-{1:00}' -f $dump.LastWriteTime.Year, [Globalization.CultureInfo]::InvariantCulture.Calendar.GetWeekOfYear($dump.LastWriteTime, [Globalization.CalendarWeekRule]::FirstFourDayWeek, [DayOfWeek]::Monday)
    if (-not $weekly.ContainsKey($week)) { $weekly[$week] = $dump }
  }
  $weekly.Values | Sort-Object LastWriteTime -Descending | Select-Object -First $WeeklyRetention | ForEach-Object { [void]$keep.Add($_.Name) }
  foreach ($dump in $dumps) {
    if (-not $keep.Contains($dump.Name)) {
      Remove-Item $dump.FullName -Force
      Remove-Item "$($dump.FullName).sha256" -Force -ErrorAction SilentlyContinue
    }
  }
}

try {
  $running = docker ps --filter "name=^/$($profile.Container)$" --format '{{.Names}}'
  if ($LASTEXITCODE -ne 0 -or $running -ne $profile.Container) { throw "Container $($profile.Container) nao esta rodando." }
  docker exec $profile.Container pg_dump -U cervejaria -d $profile.Database --no-owner --no-acl -f $containerFile
  if ($LASTEXITCODE -ne 0) { throw 'pg_dump falhou.' }
  docker cp "$($profile.Container):$containerFile" $file
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao copiar o dump local.' }
  docker exec $profile.Container rm -f $containerFile 2>$null | Out-Null
  $item = Get-Item -LiteralPath $file
  if ($item.Length -le 0) { throw 'Backup local vazio.' }
  $header = Get-Content -LiteralPath $file -TotalCount 8 -Encoding UTF8 | Out-String
  if ($header -notmatch 'PostgreSQL database dump') { throw 'Formato inesperado de pg_dump.' }
  $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
  "$hash  $name" | Set-Content -LiteralPath "$file.sha256" -Encoding ASCII

  if ($OffHostDir) {
    $remote = [IO.Path]::GetFullPath($OffHostDir)
    New-Item -ItemType Directory -Force -Path $remote | Out-Null
    Copy-Item -LiteralPath $file -Destination (Join-Path $remote $name) -Force
    Copy-Item -LiteralPath "$file.sha256" -Destination (Join-Path $remote "$name.sha256") -Force
    $remoteItem = Get-Item (Join-Path $remote $name)
    $remoteHash = (Get-FileHash -LiteralPath $remoteItem.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($remoteItem.Length -ne $item.Length -or $remoteHash -ne $hash) { throw 'Checksum off-host divergente.' }
    Apply-Retention -Directory $remote
  }
  Apply-Retention -Directory $local
  [pscustomobject]@{ result='PASS'; environment=$Environment; file=$file; bytes=$item.Length; sha256=$hash; offHost=[bool]$OffHostDir; retention='PASS' } | ConvertTo-Json -Compress
} catch {
  Write-Error $_
  exit 1
} finally {
  docker exec $profile.Container rm -f $containerFile 2>$null | Out-Null
}
