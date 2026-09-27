@echo off
set "APPDIR=%~dp0"
wscript.exe "%APPDIR%launch.vbs"
timeout /t 2 >nul
if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
  start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --app=http://127.0.0.1:8733 --window-size=400,600
) else (
  start "" http://127.0.0.1:8733
)
