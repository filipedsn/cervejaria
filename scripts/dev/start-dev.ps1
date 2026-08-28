# Sobe backend (3002) e frontend (5202) em segundo plano.

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"

$paths = Get-DevPaths

if (-not $paths.NpmCmd -or -not (Test-Path $paths.NpmCmd)) {
  Write-Host 'npm.cmd nao encontrado. Instale Node.js 20.' -ForegroundColor Red
  exit 1
}

$nodeDir = Split-Path $paths.NpmCmd -Parent
$env:Path = "$nodeDir;$env:Path"
$env:NODE_ENV = 'development'

. (Join-Path $PSScriptRoot '..\prod\_config.ps1')
Import-BackendEnvFile -BackendDir $paths.BackendDir -Environment development

# OTel só no backend — frontend (Vite) não tem @elastic/opentelemetry-node.
$otelImport = '--import @elastic/opentelemetry-node'
$savedNodeOptions = $env:NODE_OPTIONS
$backendNodeOptions = $otelImport
if ($savedNodeOptions) {
  if ($savedNodeOptions -notlike '*opentelemetry-node*') {
    $backendNodeOptions = "$savedNodeOptions $otelImport"
  } else {
    $backendNodeOptions = $savedNodeOptions
  }
}

function Start-DevService {
  param(
    [string]$Label,
    [string]$WorkingDir,
    [string]$PidFile,
    [int]$Port,
    [string]$StdoutLog,
    [string]$StderrLog
  )

  if (Test-DevPortListening -Port $Port) {
    Write-DevLog -Paths $paths -Message "$Label ja esta na porta $Port."
    return $true
  }

  if (Test-Path $PidFile) {
    # O PID pode ser de boot anterior/reutilizado. Nao encerre por numero: a
    # porta e a evidencia operacional; o arquivo antigo e apenas descartado.
    $identity = Test-ManagedPidFile -PidFile $PidFile -ExpectedProcessNames @('node.exe')
    if ($identity.State -eq 'REUSED') {
      Write-DevLog -Paths $paths -Message "$Label PID $($identity.ProcessId) reutilizado; referencia descartada sem encerrar processo alheio."
    }
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
  }

  $proc = Start-HiddenNpm `
    -NpmCmd $paths.NpmCmd `
    -WorkingDirectory $WorkingDir `
    -NpmArgs @('run', 'dev') `
    -StdoutLog $StdoutLog `
    -StderrLog $StderrLog

  Set-Content -Path $PidFile -Value $proc.Id -Encoding ASCII
  Write-DevLog -Paths $paths -Message "$Label iniciado PID $($proc.Id) porta $Port."

  Start-Sleep -Seconds 2

  $deadline = (Get-Date).AddSeconds(90)
  do {
    if (Test-DevPortListening -Port $Port) {
      $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty OwningProcess
      if ($listener) {
        Set-Content -Path $PidFile -Value $listener -Encoding ASCII
      }
      return $true
    }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)

  Write-DevLog -Paths $paths -Message "$Label falhou ao abrir porta $Port."
  return $false
}

Push-Location $paths.BackendDir
$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'SilentlyContinue'
if (-not (Test-DevPortListening -Port $paths.BackendPort)) {
  & $paths.NpmCmd exec prisma generate *> $null
  if ($LASTEXITCODE -ne 0) {
    Write-DevLog -Paths $paths -Message 'prisma generate falhou (API parada) — reinicie dev apos fechar processos node.'
  }
} else {
  Write-DevLog -Paths $paths -Message 'prisma generate ignorado — API dev ativa na porta (evita EPERM no query engine).'
}
$ErrorActionPreference = $prevEap
Pop-Location

$env:NODE_OPTIONS = $backendNodeOptions
$backendOk = Start-DevService `
  -Label 'API dev' `
  -WorkingDir $paths.BackendDir `
  -PidFile $paths.BackendPidFile `
  -Port $paths.BackendPort `
  -StdoutLog $paths.BackendLog `
  -StderrLog $paths.BackendErrLog

# Vite não deve herdar NODE_OPTIONS do backend.
$env:NODE_OPTIONS = ''

$frontendOk = Start-DevService `
  -Label 'Frontend dev' `
  -WorkingDir $paths.FrontendDir `
  -PidFile $paths.FrontendPidFile `
  -Port $paths.FrontendPort `
  -StdoutLog $paths.FrontendLog `
  -StderrLog $paths.FrontendErrLog

if ($backendOk -or $frontendOk) {
  $backendOk = Test-DevPortListening -Port $paths.BackendPort
  $frontendOk = Test-DevPortListening -Port $paths.FrontendPort
}

if ($backendOk -and $frontendOk) {
  Write-Host "Dev no ar: http://localhost:$($paths.FrontendPort) (API :$($paths.BackendPort))" -ForegroundColor Green
  Write-Host "Internet (Cloudflare): https://tapdev.quivercloud.com.br" -ForegroundColor Cyan
  $lanIp = Get-DevLanIPv4
  if ($lanIp) {
    Write-Host "Celular (mesma Wi-Fi): http://${lanIp}:$($paths.FrontendPort)" -ForegroundColor Cyan
    Write-Host "QR codes usam esse IP automaticamente quando o painel esta em localhost." -ForegroundColor DarkGray
  }
  exit 0
}

Write-Host 'Falha ao subir ambiente de desenvolvimento. Veja deploy/logs/dev-*.log' -ForegroundColor Red
exit 1
