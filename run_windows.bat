@echo off
setlocal
cd /d "%~dp0"
echo.
echo    RELAY v13 - LIVE APRON
if not defined RELAY_PORT set "RELAY_PORT=8766"
set "RELAY_BROWSER_ARG=--open"
if "%RELAY_NO_BROWSER%"=="1" set "RELAY_BROWSER_ARG="
py -3 v13/server.py --port "%RELAY_PORT%" %RELAY_BROWSER_ARG%
if errorlevel 1 (
  echo.
  echo Startup failed. Ensure Python 3.10 or newer is installed.
  pause
)
endlocal
