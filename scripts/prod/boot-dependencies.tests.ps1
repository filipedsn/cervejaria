. "$PSScriptRoot\boot-dependencies.ps1"
function Write-WatchdogLog { param($Paths,$Message) }
Describe 'Recuperacao segura do banco no boot' {
  It 'aguarda Docker indisponivel sem criar ou iniciar container' {
    Mock Invoke-ProdDocker { return $null }
    (Ensure-ProdDatabaseContainer -Paths @{}) | Should Be $false
    Assert-MockCalled Invoke-ProdDocker -Scope It -Times 1 -Exactly
  }
  It 'aguarda health starting sem reiniciar banco' {
    Mock Invoke-ProdDocker { if ($DockerArgs -contains '{{.State.Status}}') { 'running' } else { 'starting' } }
    (Ensure-ProdDatabaseContainer -Paths @{}) | Should Be $false
    Assert-MockCalled Invoke-ProdDocker -Scope It -Times 0 -Exactly -ParameterFilter { $DockerArgs -contains 'start' }
  }
  It 'inicia somente o container existente parado e aguarda health' {
    Mock Invoke-ProdDocker { if ($DockerArgs -contains '{{.State.Status}}') { 'exited' } elseif ($DockerArgs -contains 'start') { 'cervejaria-db' } else { 'healthy' } }
    (Ensure-ProdDatabaseContainer -Paths @{}) | Should Be $true
    Assert-MockCalled Invoke-ProdDocker -Scope It -Times 1 -Exactly -ParameterFilter { $DockerArgs[0] -eq 'start' -and $DockerArgs[1] -eq 'cervejaria-db' }
  }
  It 'nao força restart de container unhealthy ou pausado' {
    Mock Invoke-ProdDocker { 'paused' }
    (Ensure-ProdDatabaseContainer -Paths @{}) | Should Be $false
    Assert-MockCalled Invoke-ProdDocker -Scope It -Times 0 -Exactly -ParameterFilter { $DockerArgs -contains 'start' }
  }
}

Describe 'Guardas da recuperacao unica do Docker no login' {
  It 'permite recuperar somente com motor e producao indisponiveis' {
    (Test-DockerStartupRecoveryAllowed) | Should Be $true
  }
  It 'preserva motor responsivo' { (Test-DockerStartupRecoveryAllowed -EngineReady $true) | Should Be $false }
  It 'preserva API viva mesmo sem readiness' { (Test-DockerStartupRecoveryAllowed -ApiAlive $true) | Should Be $false }
  It 'preserva banco acessivel mesmo sem API' { (Test-DockerStartupRecoveryAllowed -DatabaseListening $true) | Should Be $false }
  It 'respeita pausa operacional' { (Test-DockerStartupRecoveryAllowed -Paused $true) | Should Be $false }
  It 'nao repete reset no mesmo boot' { (Test-DockerStartupRecoveryAllowed -AlreadyAttempted $true) | Should Be $false }
  It 'identifica motor pronto sem acionar recuperacao' {
    Mock Invoke-ProdDocker { '29.6.1' }
    (Wait-ProdDockerEngine -TimeoutSeconds 0) | Should Be $true
  }
  It 'encerra espera limitada quando motor nao responde' {
    Mock Invoke-ProdDocker { $null }
    (Wait-ProdDockerEngine -TimeoutSeconds 0) | Should Be $false
  }
}

