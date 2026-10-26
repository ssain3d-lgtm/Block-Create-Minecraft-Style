@echo off
rem AI Voxel Architecture Studio - studio + AI API on http://127.0.0.1:7878
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install Node.js 20 or newer from https://nodejs.org and run this again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing packages, please wait...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)
echo Starting the studio. The browser opens in a few seconds: http://127.0.0.1:7878
start "" cmd /c "timeout /t 5 >nul && start http://127.0.0.1:7878"
call npx tsx src\server\main.ts
pause
