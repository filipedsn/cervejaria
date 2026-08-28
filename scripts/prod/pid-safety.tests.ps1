# Testes controlados para a protecao contra PID stale/reutilizado.
# Nao usa processos de producao, banco, rede externa ou reboot.
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"

$testDir = Join-Path ([IO.Path]::GetTempPath()) ("quiver-pid-test-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testDir | Out-Null
try {
  $pidFile = Join-Path $testDir 'service.pid'
  $marker = 'quiver-pid-safety-marker'
  $child = Start-Process -FilePath powershell.exe -ArgumentList @('-NoProfile','-Command', "`$null = '$marker'; Start-Sleep -Seconds 60") -WindowStyle Hidden -PassThru
  Set-Content -LiteralPath $pidFile -Value $child.Id -Encoding ASCII
  Start-Sleep -Milliseconds 250

  $valid = Test-ManagedPidFile -PidFile $pidFile -ExpectedProcessNames @('powershell.exe') -CommandLinePatterns @($marker)
  if ($valid.State -ne 'VALID') { throw "PID correto deveria ser VALID; obtido $($valid.State)" }

  $reused = Test-ManagedPidFile -PidFile $pidFile -ExpectedProcessNames @('powershell.exe') -CommandLinePatterns @('watchdog-daemon.ps1')
  if ($reused.State -ne 'REUSED') { throw "Outro powershell deveria ser REUSED; obtido $($reused.State)" }
  Clear-InvalidManagedPidFile -Identity $reused -PidFile $pidFile | Out-Null
  if (-not (Get-Process -Id $child.Id -ErrorAction SilentlyContinue)) { throw 'Teste REUSED encerrou o processo controlado.' }

  Set-Content -LiteralPath $pidFile -Value 999999 -Encoding ASCII
  if ((Test-ManagedPidFile -PidFile $pidFile).State -ne 'STALE') { throw 'PID inexistente deveria ser STALE.' }
  Set-Content -LiteralPath $pidFile -Value 'nao-e-pid' -Encoding ASCII
  if ((Test-ManagedPidFile -PidFile $pidFile).State -ne 'INVALID') { throw 'PID corrompido deveria ser INVALID.' }
  if ((Test-ManagedPidFile -PidFile (Join-Path $testDir 'ausente.pid')).State -ne 'MISSING') { throw 'Arquivo ausente deveria ser MISSING.' }

  Stop-Process -Id $child.Id -Force -ErrorAction SilentlyContinue
  Write-Host 'PASS: PID correto, inexistente, corrompido e reutilizado foram tratados com seguranca.' -ForegroundColor Green
} finally {
  if ($child) { Stop-Process -Id $child.Id -Force -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath $testDir -Recurse -Force -ErrorAction SilentlyContinue
}
