@echo off
REM Double-click to (re)start Virtue Care Finder locally and open it in the browser.
REM Stops any copy already running on port 8501 first, so code changes are always picked up.
REM Settings and auth come from run_local.ps1 (Databricks CLI profile "care-finder"; no secrets here).

cd /d "%~dp0"
echo Stopping any running copy on port 8501...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8501 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force }"

echo Starting Virtue Care Finder at http://localhost:8501 ...
start "" /b cmd /c "timeout /t 6 /nobreak >nul && start http://localhost:8501"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run_local.ps1" --server.headless true --server.port 8501 --server.address localhost

echo.
echo The app has stopped. Press any key to close this window.
pause >nul
