# Gera o Prisma client exclusivamente para DEV. Este script nunca pode tocar
# serviços de produção: é usado também por migrations e certification locais.

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $root

Write-Host 'Parando somente DEV...' -ForegroundColor Cyan
npm run dev:stop
Start-Sleep -Seconds 2

foreach ($port in @(3002)) {
  $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  foreach ($c in $conns) {
    if ($c.OwningProcess) {
      Write-Host "Encerrando PID $($c.OwningProcess) na porta $port..." -ForegroundColor Yellow
      Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
    }
  }
}
Start-Sleep -Seconds 2

Set-Location (Join-Path $root 'backend')
Write-Host 'prisma generate...' -ForegroundColor Cyan
npx prisma generate
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Falhou. Encerre node.exe no Gerenciador de Tarefas e rode de novo.' -ForegroundColor Red
  exit 1
}

Set-Location $root
Write-Host 'Subindo somente DEV...' -ForegroundColor Cyan
npm run dev:start
Write-Host 'Concluido.' -ForegroundColor Green
