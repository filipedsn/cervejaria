# Para apenas o ambiente de desenvolvimento (portas 3002 / 5202).

$ErrorActionPreference = 'SilentlyContinue'
. "$PSScriptRoot\_config.ps1"

$paths = Get-DevPaths

Stop-ManagedPidFile -PidFile $paths.SupervisorPidFile -ExpectedProcessNames @('powershell.exe','pwsh.exe') -CommandLinePatterns @('supervisor.ps1','Detached') -Label 'Supervisor dev' | Out-Null
Stop-ManagedPidFile -PidFile $paths.BackendPidFile -ExpectedProcessNames @('node.exe') -CommandLinePatterns @('backend') -Label 'API dev' | Out-Null
Stop-ManagedPidFile -PidFile $paths.FrontendPidFile -ExpectedProcessNames @('node.exe') -CommandLinePatterns @('vite') -Label 'Frontend dev' | Out-Null

# API/Vite iniciados fora dos pid files (terminal, editor) continuam escutando nas portas.
# So encerra node.exe deste repositorio; sobe pelos pais node do mesmo repo (tsx watch) para nao renascer.
$root = $paths.ProjectRoot
$nodes = @{}
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ForEach-Object { $nodes[[int]$_.ProcessId] = $_ }

foreach ($port in @($paths.BackendPort, $paths.FrontendPort)) {
  # Sem listener a porta livre não é erro — Get-NetTCPConnection sem match vira CIM terminating
  # no wrapper do Ops Panel (try/catch) e aborta "Testar o PR" / stop-dev.
  $owners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique)
  foreach ($owner in $owners) {
    $proc = $nodes[[int]$owner]
    if (-not $proc -or $proc.CommandLine -notlike "*$root*") {
      Write-Host "Porta ${port}: PID $owner nao e um node deste repositorio; nao encerrado." -ForegroundColor Yellow
      continue
    }
    while ($nodes[[int]$proc.ParentProcessId] -and $nodes[[int]$proc.ParentProcessId].CommandLine -like "*$root*") {
      $proc = $nodes[[int]$proc.ParentProcessId]
    }
    & taskkill.exe /PID $proc.ProcessId /T /F | Out-Null
    Write-Host "Porta ${port}: encerrado PID $($proc.ProcessId) (fora do pid file)." -ForegroundColor DarkGray
  }
}

$deadline = (Get-Date).AddSeconds(10)
while ((Test-DevPortListening -Port $paths.BackendPort) -or (Test-DevPortListening -Port $paths.FrontendPort)) {
  if ((Get-Date) -gt $deadline) {
    [Console]::Error.WriteLine("Ainda ha processo escutando em $($paths.BackendPort) ou $($paths.FrontendPort).")
    exit 1
  }
  Start-Sleep -Milliseconds 500
}

Write-Host 'Ambiente de desenvolvimento encerrado.' -ForegroundColor Green
