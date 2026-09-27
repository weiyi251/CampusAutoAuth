@echo off
REM 安装方法：把本文件复制到
REM %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\
REM 登录 Windows 时即自动触发下面的脚本
powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File "D:\workspace\CampusAutoAuth\connect_xcu.ps1"
