@echo off
rem Benchmark in YOUR browser and GPU. Results appear in the page; use the save button to keep the JSON.
cd /d "%~dp0"
if not exist node_modules (
  echo Installing packages, please wait...
  call npm install
)
echo Opening http://localhost:5173/?bench=1 - keep the window in front until the result table appears.
call npx vite --open "/?bench=1"
pause
