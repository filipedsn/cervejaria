@echo off
net session >nul 2>&1
if %errorLevel% neq 0 (
  echo.
  echo Execute este arquivo como Administrador:
  echo   Clique direito em install-autostart.cmd -^> Executar como administrador
  echo.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-autostart.ps1" %*
if %errorLevel% neq 0 pause
