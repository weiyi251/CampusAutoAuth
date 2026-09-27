@echo off
powershell.exe -ExecutionPolicy Bypass -File "%~dp0..\connect_xcu.ps1" -Force
echo Done. Log: %TEMP%\xcu_connect.log
timeout /t 6 >nul
