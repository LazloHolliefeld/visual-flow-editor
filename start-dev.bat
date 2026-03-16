@echo off
setlocal

:: Add Node.js to PATH if not present
set PATH=C:\Program Files\nodejs;%PATH%

:: Enable PowerShell script execution if needed
powershell -Command "Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force" 2>nul

:: Change to project directory
cd /d "%~dp0visual-flow-editor"

:: Kill any existing Node processes using ports 3001 and 5173
echo Cleaning up ports...
tasklist /FI "IMAGENAME eq node.exe" /FO CSV | for /f "skip=1" %%i in ('more ^+2') do (
  for /f "tokens=2 delims=","" %%j in ("%%i") do taskkill /PID %%j /F 2>nul
)

:: Run the dev server (both frontend and backend)
echo.
echo Starting Visual Flow Editor (Frontend + Backend)...
echo Frontend will be available at http://localhost:5173 or http://localhost:5174
echo Backend API will be available at http://localhost:3001
echo.
npm run dev
