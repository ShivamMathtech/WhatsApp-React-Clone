@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 LTS from https://nodejs.org/ first.
  pause
  exit /b 1
)
node scripts\check-node.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
if not exist "node_modules\express\package.json" (
  echo Run setup_windows.bat before starting the app.
  pause
  exit /b 1
)
if not exist "dist\index.html" (
  echo Frontend build missing. Run setup_windows.bat again.
  pause
  exit /b 1
)
echo Open http://localhost:3001 in your browser.
echo Keep this window open while using the app. Press Ctrl+C to stop.
call npm start
pause
