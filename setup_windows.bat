@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 24 LTS from https://nodejs.org/
  pause
  exit /b 1
)
node scripts\setup.mjs
set "CHAT_SETUP_EXIT=%errorlevel%"
if not "%CHAT_SETUP_EXIT%"=="0" echo Setup failed. Read the error above and try again.
pause
exit /b %CHAT_SETUP_EXIT%
