@echo off
set "APPDIR=%~dp0"
wscript.exe "%APPDIR%launch.vbs"
timeout /t 2 >nul
if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$f = Join-Path $env:LOCALAPPDATA 'CampusAutoAuth\window.json'; $size = '--window-size=400,600'; if (Test-Path $f) { try { $j = Get-Content $f -Raw -ErrorAction Stop | ConvertFrom-Json; if ($j.width -ge 380) { $size = '--window-size=' + $j.width + ',' + $j.height } } catch {} }; Start-Process 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' -ArgumentList ('--app=http://127.0.0.1:8733', $size, '--disable-extensions', '--disable-features=Translate')"
) else (
  start "" http://127.0.0.1:8733
)
