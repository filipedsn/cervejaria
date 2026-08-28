# Para apenas o ambiente de desenvolvimento (portas 3002 / 5202).

$ErrorActionPreference = 'SilentlyContinue'
. "$PSScriptRoot\_config.ps1"

$paths = Get-DevPaths

Stop-ManagedPidFile -PidFile $paths.BackendPidFile -ExpectedProcessNames @('node.exe') -CommandLinePatterns @('backend') -Label 'API dev' | Out-Null
Stop-ManagedPidFile -PidFile $paths.FrontendPidFile -ExpectedProcessNames @('node.exe') -CommandLinePatterns @('vite') -Label 'Frontend dev' | Out-Null
Stop-ManagedPidFile -PidFile $paths.SupervisorPidFile -ExpectedProcessNames @('powershell.exe','pwsh.exe') -CommandLinePatterns @('supervisor.ps1','Detached') -Label 'Supervisor dev' | Out-Null


Write-Host 'Ambiente de desenvolvimento encerrado.' -ForegroundColor Green
