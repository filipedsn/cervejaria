# Para API e tunnel iniciados pelos scripts de produção.

. "$PSScriptRoot\_config.ps1"

$settings = Get-QuiverTapSettings
$paths = Resolve-QuiverTapPaths -Settings $settings

Stop-ManagedPidFile -PidFile $paths.ApiPidFile -ExpectedProcessNames @('node.exe') -CommandLinePatterns @('index.js') -Label 'API' | Out-Null
Stop-ManagedPidFile -PidFile $paths.AlertPollerPidFile -ExpectedProcessNames @('node.exe') -CommandLinePatterns @('alert-poller') -Label 'Alert poller' | Out-Null
Stop-ManagedPidFile -PidFile (Join-Path $paths.RuntimeDir 'watchdog.pid') -ExpectedProcessNames @('powershell.exe','pwsh.exe') -CommandLinePatterns @('watchdog-daemon.ps1') -Label 'Watchdog daemon' | Out-Null
Stop-ManagedPidFile -PidFile (Join-Path $paths.RuntimeDir 'ops-panel.pid') -ExpectedProcessNames @('node.exe') -CommandLinePatterns @('server.mjs') -Label 'Ops panel' | Out-Null
Stop-ManagedPidFile -PidFile $paths.FrontendPidFile -ExpectedProcessNames @('node.exe') -CommandLinePatterns @('vite') -Label 'Frontend' | Out-Null
Stop-ManagedPidFile -PidFile $paths.TunnelPidFile -ExpectedProcessNames @('cloudflared.exe') -CommandLinePatterns @('tunnel', $paths.TunnelName) -Label 'Tunnel' | Out-Null

# Não para o serviço Cloudflared instalado via `cloudflared service install`
# Processos sem PID file (inclusive listeners de porta) nao sao encerrados: podem
# pertencer a outro usuario ou aplicacao. O status aponta o bloqueio para acao manual.

Write-Host 'Concluído.' -ForegroundColor Green
