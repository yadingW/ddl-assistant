@echo off
setlocal
cd /d "%~dp0"

set "APP_URL=http://127.0.0.1:8000/"

powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -Uri '%APP_URL%' -TimeoutSec 2 ^| Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 (
  start "" "%APP_URL%"
  exit /b 0
)

set "PYTHON_EXE="
set "PYTHON_ARGS="

py -3 --version >nul 2>nul
if not errorlevel 1 (
  set "PYTHON_EXE=py"
  set "PYTHON_ARGS=-3"
) else (
  python --version >nul 2>nul
  if not errorlevel 1 (
    set "PYTHON_EXE=python"
  )
)

if not defined PYTHON_EXE (
  echo 未找到 Python，无法启动本地服务。
  echo 请安装 Python，并在安装时勾选“Add Python to PATH”。
  pause
  exit /b 1
)

start "DDL Assistant Server" /min cmd.exe /c "%PYTHON_EXE% %PYTHON_ARGS% -m http.server 8000 --bind 127.0.0.1"
timeout /t 2 /nobreak >nul
start "" "%APP_URL%"

endlocal
