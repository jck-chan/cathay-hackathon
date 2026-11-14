@echo off
setlocal
cd /d "%~dp0"
echo.
echo    RELAY FUSION v11 - THREE TWINS / MATHEMATICAL EVIDENCE / LOCAL SYNTHETIC SHADOW
if not exist ".venv\Scripts\python.exe" (
  echo [1/3] Creating isolated Python environment...
  py -m venv .venv
  if errorlevel 1 goto fail
)
echo [2/3] Checking installed packages...
".venv\Scripts\python.exe" -c "import fastapi,scipy,numpy,pandas,uvicorn,pydantic,httpx; from mcp.server.fastmcp import FastMCP" >nul 2>&1
if errorlevel 1 (
  echo Installing dependencies - internet connection required on first run...
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
  if errorlevel 1 goto fail
)
echo [3/3] Starting Fusion...
".venv\Scripts\python.exe" launch.py
if errorlevel 1 goto fail
goto done
:fail
echo.
echo Startup failed. Copy this Terminal traceback to ChatGPT.
pause
:done
endlocal
