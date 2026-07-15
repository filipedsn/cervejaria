# Reinicia backend (3002) e frontend (5202) em primeiro plano (logs no terminal).
# O Cursor sobe/desmonta dev automaticamente via scripts/dev/supervisor.ps1.

$ErrorActionPreference = "SilentlyContinue"
$BackendPort = 3002
$FrontendPort = 5202
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

# Garante Node.js no PATH
$NodePath = "C:\Program Files\nodejs"
if (Test-Path $NodePath) {
  $env:Path = "$NodePath;$env:Path"
}

function Stop-ProcessOnPort {
  param([int]$Port)

  $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  foreach ($conn in $connections) {
    $pid = $conn.OwningProcess
    if ($pid -and $pid -ne 0) {
      Write-Host "Encerrando processo na porta $Port (PID $pid)..." -ForegroundColor Yellow
      Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
    }
  }
}

Write-Host ""
Write-Host "Quiver Tap - Reiniciando servidores" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Stop-ProcessOnPort -Port $BackendPort
Stop-ProcessOnPort -Port $FrontendPort

Start-Sleep -Seconds 1

Write-Host "Gerando Prisma Client..." -ForegroundColor Gray
Push-Location (Join-Path $ProjectRoot "backend")
$env:NODE_ENV = 'development'
. (Join-Path $ProjectRoot "scripts\prod\_config.ps1")
Import-BackendEnvFile -BackendDir (Join-Path $ProjectRoot "backend") -Environment development
npm exec prisma generate 2>$null
Pop-Location

Write-Host "Iniciando backend + frontend (ambiente: desenvolvimento)..." -ForegroundColor Green
Write-Host "  Backend:  http://localhost:$BackendPort" -ForegroundColor Gray
Write-Host "  Frontend: http://localhost:$FrontendPort" -ForegroundColor Gray

$lanIp = (
  Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object {
    $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and
    $_.InterfaceAlias -notmatch 'Loopback|vEthernet|WSL|Hyper-V'
  } |
  Select-Object -First 1 -ExpandProperty IPAddress
)

if ($lanIp) {
  Write-Host "  Celular:  http://${lanIp}:$FrontendPort  (mesma rede Wi-Fi)" -ForegroundColor Yellow
} else {
  Write-Host "  Celular:  use o IP local do PC na porta $FrontendPort" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "Pressione Ctrl+C para parar ambos." -ForegroundColor DarkGray
Write-Host ""

$env:NODE_ENV = 'development'
npm run dev
