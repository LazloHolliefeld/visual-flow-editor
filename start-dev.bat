@echo off
setlocal

:: Add Node.js to PATH if not present
set PATH=C:\Program Files\nodejs;%PATH%

:: Change to project directory
cd /d "%~dp0visual-flow-editor"

:: Run the dev server (both frontend and backend)
echo Starting Visual Flow Editor (Frontend + Backend)...
echo.
npm run dev
