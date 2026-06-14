@echo off
setlocal
cd /d "%~dp0"

set "PYTHON=C:\Users\yadin\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"

if not exist "%PYTHON%" (
  where python >nul 2>nul
  if errorlevel 1 (
    echo Python was not found. Install Python or start another static web server on port 8000.
    pause
    exit /b 1
  )
  set "PYTHON=python"
)

start "Work Note Server" /min "%PYTHON%" -m http.server 8000 --bind 127.0.0.1
timeout /t 2 /nobreak >nul
start "" "http://localhost:8000/"

endlocal
