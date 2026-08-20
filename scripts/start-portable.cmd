@echo off
setlocal
cd /d "%~dp0"

if not exist "runtime\node.exe" (
  echo The bundled Node.js runtime is missing: runtime\node.exe
  pause
  exit /b 1
)

set "NODE_ENV=production"
set "LOADCHAT_DATA_DIR=%CD%\data"
echo Starting LoadChat. Press Ctrl+C to stop.
"%CD%\runtime\node.exe" "%CD%\dist-server\index.js"
if errorlevel 1 pause
