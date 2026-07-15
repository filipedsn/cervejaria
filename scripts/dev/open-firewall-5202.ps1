# Libera a porta 5202 (Vite dev) no Windows Firewall para testes no celular na mesma Wi-Fi.
# Execute como Administrador: clique direito -> "Executar com PowerShell" ou "Executar como administrador"

#Requires -RunAsAdministrator

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"

$ruleName = "Quiver Tap Dev ($($script:DevFrontendPort))"
$port = $script:DevFrontendPort

$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Regra ja existe: $ruleName" -ForegroundColor Yellow
} else {
  New-NetFirewallRule `
    -DisplayName $ruleName `
    -Direction Inbound `
    -Protocol TCP `
    -LocalPort $port `
    -Action Allow | Out-Null
  Write-Host "Regra criada: $ruleName (TCP $port inbound)" -ForegroundColor Green
}

Get-NetFirewallRule -DisplayName $ruleName | Get-NetFirewallPortFilter | Format-Table -AutoSize

$lanIp = Get-DevLanIPv4
if ($lanIp) {
  Write-Host ""
  Write-Host "Teste no celular (mesma Wi-Fi): http://${lanIp}:$port" -ForegroundColor Cyan
} else {
  Write-Host ""
  Write-Host "Teste no celular: http://SEU_IP_LOCAL:$port" -ForegroundColor Cyan
}

$profile = Get-NetConnectionProfile | Select-Object -First 1
if ($profile -and $profile.NetworkCategory -eq 'Public') {
  Write-Host ""
  Write-Host "Sua rede esta como Public — o firewall e mais restritivo." -ForegroundColor Yellow
  Write-Host "Se o celular nao conectar, mude para Private em Configuracoes -> Rede e Internet -> Wi-Fi -> propriedades da rede." -ForegroundColor DarkGray
}
