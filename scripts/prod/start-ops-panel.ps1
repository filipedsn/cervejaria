# Inicia o ops-panel na porta configurada (padrao 3099). Sem fallback silencioso.

param(
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"
. "$PSScriptRoot\ops-panel-lib.ps1"

$settings = Get-QuiverTapSettings
$paths = Resolve-QuiverTapPaths -Settings $settings

$opsPanelDir = Join-Path $paths.ProjectRoot 'ops-panel'
$opsPidFile = Join-Path $paths.RuntimeDir 'ops-panel.pid'
$metaFile = Join-Path $paths.RuntimeDir 'ops-panel.meta.json'
$envFile = Join-Path $opsPanelDir '.env'
$envExample = Join-Path $opsPanelDir '.env.example'

if (-not (Test-Path $opsPanelDir)) {
  if (-not $Quiet) { Write-Host 'ops-panel/ nao encontrado.' -ForegroundColor Red }
  exit 1
}

$port = Get-OpsPanelConfiguredPort -EnvFile $envFile
$live = Get-OpsPanelLiveStatus -Port $port -MetaFile $metaFile

if ($live.state -eq 'current') {
  # Health e a evidencia principal. Regrava somente com o PID que realmente
  # esta escutando, eliminando eventual referencia persistida de boot anterior.
  $listenerPid = Get-PortListenerPid -Port $port
  if ($listenerPid) { Set-Content -Path $opsPidFile -Value $listenerPid -Encoding ASCII }
  if (-not $Quiet) {
    Write-Host "Ops panel ja ativo: $($live.url) (PID $($live.pid))" -ForegroundColor Green
  }
  exit 0
}

if ($live.state -eq 'legacy') {
  if (-not $Quiet) {
    Write-Host "Instancia LEGADA na porta $port (PID $($live.pid))." -ForegroundColor Red
    Write-Host 'Tentando encerrar...' -ForegroundColor Yellow
  }
  if (-not (Stop-PortListener -Port $port -Quiet:$Quiet)) {
    if (-not $Quiet) {
      Write-Host ''
      Write-Host "Nao foi possivel liberar a porta $port." -ForegroundColor Red
      Write-Host 'Abra o PowerShell como Administrador e rode:' -ForegroundColor Yellow
      Write-Host "  taskkill /F /PID $($live.pid)" -ForegroundColor Gray
      Write-Host '  npm run ops:start' -ForegroundColor Gray
      Write-Host ''
      Write-Host 'O ops-panel usa SEMPRE a porta configurada em ops-panel/.env (padrao 3099).' -ForegroundColor Yellow
      Write-Host 'Nao ha porta alternativa automatica - isso evita abrir o painel errado.' -ForegroundColor Yellow
    }
    exit 1
  }
} elseif ($live.state -eq 'blocked') {
  if (-not $Quiet) {
    Write-Host "Porta $port ocupada pelo PID $($live.pid), mas nao e o ops-panel." -ForegroundColor Red
    Write-Host "Encerre o processo ou mude OPS_PANEL_PORT em ops-panel/.env" -ForegroundColor Yellow
  }
  exit 1
}

if (Test-Path $opsPidFile) {
  Remove-Item $opsPidFile -Force -ErrorAction SilentlyContinue
}
Remove-Item $metaFile -Force -ErrorAction SilentlyContinue

if (-not (Test-Path $envFile) -and (Test-Path $envExample)) {
  Copy-Item $envExample $envFile
  Write-WatchdogLog -Paths $paths -Message 'ops-panel/.env criado a partir de .env.example.'
}

$nodeModules = Join-Path $opsPanelDir 'node_modules'
if (-not (Test-Path $nodeModules)) {
  if (-not $Quiet) { Write-Host 'Instalando dependencias do ops-panel...' -ForegroundColor Cyan }
  $npmCmd = $paths.NpmCmd
  if ($npmCmd) {
    if (Test-Path (Join-Path $opsPanelDir 'package-lock.json')) {
      & $npmCmd ci --prefix $opsPanelDir
    } else {
      & $npmCmd install --prefix $opsPanelDir
    }
  } else {
    if (Test-Path (Join-Path $opsPanelDir 'package-lock.json')) {
      npm ci --prefix $opsPanelDir
    } else {
      npm install --prefix $opsPanelDir
    }
  }
  if ($LASTEXITCODE -ne 0) { exit 1 }
}

$nodeDir = Split-Path $paths.NodeExe -Parent
$env:Path = "$nodeDir;$env:Path"

$serverEntry = Join-Path $opsPanelDir 'src\server.mjs'
$opsLog = Join-Path $paths.LogDir 'ops-panel-stdout.log'
$opsErrLog = Join-Path $paths.LogDir 'ops-panel-error.log'

# Porta vem do .env; nao sobrescrever com fallback.
if ($env:OPS_PANEL_PORT -and [int]$env:OPS_PANEL_PORT -ne $port) {
  $env:OPS_PANEL_PORT = "$port"
}

$proc = Start-Process `
  -FilePath $paths.NodeExe `
  -ArgumentList @($serverEntry) `
  -WorkingDirectory $opsPanelDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput $opsLog `
  -RedirectStandardError $opsErrLog `
  -PassThru

Start-Sleep -Seconds 2

if (-not (Test-OpsPanelCurrent -Port $port)) {
  $errTail = ''
  if (Test-Path $opsErrLog) {
    $errTail = (Get-Content $opsErrLog -Tail 5 -ErrorAction SilentlyContinue) -join ' '
  }
  if (-not $Quiet) {
    Write-Host "Ops panel nao subiu em http://127.0.0.1:$port" -ForegroundColor Red
    if ($errTail) { Write-Host $errTail -ForegroundColor Gray }
    Write-Host 'Rode npm run ops:status para diagnostico.' -ForegroundColor Yellow
  }
  exit 1
}

if (Test-Path $opsPidFile) {
  $panelPid = [int](Get-Content $opsPidFile -ErrorAction SilentlyContinue)
} else {
  $panelPid = $proc.Id
  Set-Content -Path $opsPidFile -Value $proc.Id -Encoding ASCII
}

Write-WatchdogLog -Paths $paths -Message "Ops panel iniciado PID $panelPid porta $port."
if (-not $Quiet) {
  Write-Host "Ops panel: http://127.0.0.1:$port (PID $panelPid)" -ForegroundColor Green
  Write-Host 'Status: npm run ops:status' -ForegroundColor Gray
}

exit 0
