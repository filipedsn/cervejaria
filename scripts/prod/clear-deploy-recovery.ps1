# Libera explicitamente o bloqueio deixado por falha apos o inicio de migration.
# Nao restaura banco, nao troca artefatos e nao inicia processos.

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"

$settings = Get-QuiverTapSettings
$paths = Resolve-QuiverTapPaths -Settings $settings
$recoveryFile = Get-DeployRecoveryFile -Paths $paths
$pauseFile = Get-DeployPauseFile -Paths $paths

if (-not (Test-Path $recoveryFile)) {
  Write-Host 'Nao ha estado de recovery manual ativo.' -ForegroundColor Yellow
  exit 1
}

try {
  $recovery = Get-Content $recoveryFile -Raw -Encoding UTF8 | ConvertFrom-Json
} catch {
  Write-Host "Recovery ilegivel: $recoveryFile" -ForegroundColor Red
  Write-Host 'Nao remova o deploy.pause sem validar manualmente banco e artefatos.' -ForegroundColor Yellow
  exit 1
}

Write-Host ''
Write-Host 'Quiver Tap - Liberar recovery manual' -ForegroundColor Yellow
Write-Host '====================================' -ForegroundColor Yellow
Write-Host "Fase da falha: $($recovery.failurePhase)"
Write-Host "Falhou em:     $($recovery.failedAt)"
Write-Host "Candidato:     $($recovery.candidateRelease.gitSha)"
Write-Host ''
Write-Host 'ATENCAO: esta acao nao restaura banco nem artefatos.' -ForegroundColor Red
Write-Host 'Ela apenas remove o bloqueio. O watchdog podera tentar iniciar a release presente no disco.' -ForegroundColor Red

$answer = Read-Host 'Digite LIBERAR-WATCHDOG-APOS-VALIDACAO para continuar'
if ($answer -ne 'LIBERAR-WATCHDOG-APOS-VALIDACAO') {
  Write-Host 'Liberacao cancelada. Recovery permanece ativo.' -ForegroundColor Yellow
  exit 1
}

Remove-Item $recoveryFile -Force
Remove-Item $pauseFile -Force -ErrorAction SilentlyContinue
Write-WatchdogLog -Paths $paths -Message 'Recovery manual liberado explicitamente pelo operador.'

Write-Host 'Recovery e deploy.pause removidos. Nenhuma API foi iniciada por este script.' -ForegroundColor Green
Write-Host 'Acompanhe npm run prod:status antes de retomar a operacao.' -ForegroundColor Yellow
exit 0
