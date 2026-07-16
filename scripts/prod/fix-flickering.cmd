@echo off
cd /d "%~dp0..\.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0fix-flickering.ps1"
exit /b %ERRORLEVEL%
