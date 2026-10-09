$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'restore-drill-dev.helpers.ps1')

$repo = Join-Path ([System.IO.Path]::GetTempPath()) ('restore-drill-test-' + [guid]::NewGuid().ToString('N'))
try {
  New-Item -ItemType Directory -Path $repo | Out-Null
  git -C $repo init --quiet
  if ($LASTEXITCODE -ne 0) { throw 'git init failed.' }
  git -C $repo config core.autocrlf true
  if ($LASTEXITCODE -ne 0) { throw 'git config failed.' }

  $relativePath = 'backend/prisma/migrations/20260101000000_fixture/migration.sql'
  $file = Join-Path $repo ($relativePath.Replace('/', '\'))
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $file) | Out-Null
  [System.IO.File]::WriteAllText((Join-Path $repo '.gitattributes'), '*.sql text eol=lf' + "`n", [System.Text.UTF8Encoding]::new($false))
  $lfBytes = [System.Text.Encoding]::UTF8.GetBytes("SELECT 1;`nSELECT 2;`n")
  [System.IO.File]::WriteAllBytes($file, $lfBytes)
  git -C $repo add .gitattributes $relativePath
  if ($LASTEXITCODE -ne 0) { throw 'git add failed.' }
  git -C $repo -c user.name=RestoreTest -c user.email=restore-test@example.invalid commit --quiet -m fixture
  if ($LASTEXITCODE -ne 0) { throw 'git commit failed.' }

  $blob = (git -C $repo rev-parse "HEAD:$relativePath").Trim()
  $localCrlf = [System.Text.Encoding]::UTF8.GetBytes("SELECT 1;`r`nSELECT 2;`r`n")
  [System.IO.File]::WriteAllBytes($file, $localCrlf)
  Assert-GitWorkingFileMatchesBlob -RepositoryPath $repo -GitPath $relativePath -WorkingFile $file -BlobObjectId $blob
  $blobSha = Get-GitBlobSha256 -RepositoryPath $repo -BlobObjectId $blob
  $expectedSha = [System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash($lfBytes)).Replace('-', '').ToLowerInvariant()
  if ($blobSha -ne $expectedSha) { throw "CRLF checkout produced wrong Git blob SHA: $blobSha" }

  $tampered = [System.Text.Encoding]::UTF8.GetBytes("SELECT 999;`r`nSELECT 2;`r`n")
  [System.IO.File]::WriteAllBytes($file, $tampered)
  $blocked = $false
  try { Assert-GitWorkingFileMatchesBlob -RepositoryPath $repo -GitPath $relativePath -WorkingFile $file -BlobObjectId $blob }
  catch { $blocked = $true }
  if (-not $blocked) { throw 'A real SQL content change was not blocked.' }

  'restore-drill-dev helpers: 2 focused cases PASS (CRLF blob checksum; modified SQL rejected)'
} finally {
  if (Test-Path -LiteralPath $repo) { Remove-Item -LiteralPath $repo -Recurse -Force }
}
