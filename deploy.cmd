@echo off
REM Entrada unica do deploy de producao do Quiver Tap.
REM Usa cmd (nao npm) para nao depender da execution policy do PowerShell,
REM que costuma bloquear npm.ps1 e derrubar o comando antes de comecar.
REM
REM   deploy.cmd                -> mostra plano e pede confirmacao
REM   deploy.cmd -Confirmed     -> deploy direto
REM   deploy.cmd -DryRun        -> so o plano + preflight, sem alterar nada
REM   deploy.cmd -PreflightOnly -> so as verificacoes

setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\prod\deploy.ps1" %*
exit /b %ERRORLEVEL%
