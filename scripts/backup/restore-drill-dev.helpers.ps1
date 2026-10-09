function Invoke-DevMigrationLedgerValidation {
  param(
    [Parameter(Mandatory=$true)][string]$RepositoryPath,
    [Parameter(Mandatory=$true)][string]$Revision,
    [Parameter(Mandatory=$true)][object[]]$LedgerRows
  )

  $ledgerFile = Join-Path ([IO.Path]::GetTempPath()) ("tap76-ledger-{0}.json" -f [guid]::NewGuid().ToString('N'))
  try {
    [IO.File]::WriteAllText($ledgerFile, (ConvertTo-Json -InputObject $LedgerRows -Depth 5), [Text.UTF8Encoding]::new($false))
    $validator = Join-Path $RepositoryPath 'backend\scripts\pdv-unico-dev-cutover-ledger.mjs'
    $output = & node $validator "--ledger-file=$ledgerFile" "--revision=$Revision"
    $exitCode = $LASTEXITCODE
    $line = @($output | ForEach-Object { $_.ToString() } | Where-Object { $_.Trim() } | Select-Object -Last 1)
    if (-not $line) { throw "Ledger validator produced no JSON result (exit $exitCode)." }
    $result = $line[0] | ConvertFrom-Json
    if ($exitCode -ne 0 -or $result.status -ne 'VALID') {
      $details = $result.divergences | ConvertTo-Json -Depth 8 -Compress
      throw "Migration ledger validation blocked: $details"
    }
    return $result
  } finally {
    if (Test-Path -LiteralPath $ledgerFile) { Remove-Item -LiteralPath $ledgerFile -Force }
  }
}
