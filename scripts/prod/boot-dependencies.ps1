# Recupera somente o container PROD existente; nunca cria banco ou executa migrations.
function Invoke-ProdDocker {
  param([string[]]$DockerArgs, [int]$TimeoutSeconds = 15)
  $docker = Join-Path $env:ProgramFiles 'Docker\Docker\resources\bin\docker.exe'
  if (-not (Test-Path $docker)) { return $null }
  $out = [IO.Path]::GetTempFileName()
  $err = [IO.Path]::GetTempFileName()
  try {
    # Endpoint explicito: SYSTEM nao herda o contexto Docker do usuario.
    $process = Start-Process -FilePath $docker -ArgumentList (@('--host', 'npipe:////./pipe/dockerDesktopLinuxEngine') + $DockerArgs) -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
    # Windows PowerShell 5.1 precisa reter o handle antes da espera; sem isso
    # ExitCode pode ficar null mesmo quando docker conclui com sucesso.
    $null = $process.Handle
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      return $null
    }
    $process.Refresh()
    if ($process.ExitCode -ne 0) { return $null }
    return (Get-Content -LiteralPath $out -Raw).Trim()
  } finally {
    Remove-Item -LiteralPath $out,$err -Force -ErrorAction SilentlyContinue
  }
}

function Wait-ProdDockerEngine {
  param([int]$TimeoutSeconds = 300)
  $deadline=(Get-Date).AddSeconds($TimeoutSeconds)
  do {
    if(Invoke-ProdDocker -DockerArgs @('info','--format','{{.ServerVersion}}') -TimeoutSeconds 10){return $true}
    if((Get-Date) -ge $deadline){break}
    Start-Sleep -Seconds 10
  } while((Get-Date) -lt $deadline)
  return $false
}

function Test-DockerStartupRecoveryAllowed {
  param([bool]$EngineReady,[bool]$ApiAlive,[bool]$DatabaseListening,[bool]$Paused,[bool]$AlreadyAttempted)
  return -not ($EngineReady -or $ApiAlive -or $DatabaseListening -or $Paused -or $AlreadyAttempted)
}

function Start-ProdDockerDesktop {
  # Docker Desktop/WSL precisa de sessao do usuario; nao tentar abrir GUI como SYSTEM.
  if ([Security.Principal.WindowsIdentity]::GetCurrent().IsSystem) { return }
  if (Get-Process -Name 'Docker Desktop' -ErrorAction SilentlyContinue) { return }
  $exe = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  if (Test-Path $exe) { Start-Process -FilePath $exe -WindowStyle Hidden | Out-Null }
}

function Ensure-ProdDatabaseContainer {
  param([hashtable]$Paths)
  $state = Invoke-ProdDocker -DockerArgs @('inspect', '--format', '{{.State.Status}}', 'cervejaria-db')
  if (-not $state) {
    Write-WatchdogLog -Paths $Paths -Message 'Docker indisponivel ou container PROD ausente; aguardando Docker Desktop/login, sem recriar banco.'
    return $false
  }
  if ($state -in @('exited', 'created')) {
    Write-WatchdogLog -Paths $Paths -Message 'Iniciando container PROD existente cervejaria-db.'
    $started = Invoke-ProdDocker -DockerArgs @('start', 'cervejaria-db')
    if (-not $started) { return $false }
  } elseif ($state -ne 'running') {
    Write-WatchdogLog -Paths $Paths -Message "Container PROD em estado $state; aguardando sem forcar reinicio."
    return $false
  }
  $health = Invoke-ProdDocker -DockerArgs @('inspect', '--format', '{{.State.Health.Status}}', 'cervejaria-db')
  return $health -eq 'healthy'
}
