@echo off
cd /d "%~dp0"
set "PATH=%USERPROFILE%\.bun\bin;%PATH%"
if not exist .next\BUILD_ID call bun run build || goto :fail
start "" http://127.0.0.1:3939
bun start
:fail
pause
