@echo off
REM Tankkollen local launcher (Windows)
REM -----------------------------------------------------
REM Double-clicking index.html or dator.html does NOT
REM work because modern browsers block some file://
REM operations (fetching live_prices.json, service
REM workers, etc.).
REM
REM Double-click this .bat file instead -- it starts a
REM tiny local web server and opens the app in your
REM default browser.

cd /d "%~dp0\.."

set PORT=8765
set URL=http://localhost:%PORT%/tankkollen/index.html

echo ============================================
echo  Tankkollen local server
echo   ^> %URL%
echo   ^> Pro Dashboard: http://localhost:%PORT%/tankkollen/dator.html
echo.
echo  Close this window to stop the server.
echo ============================================

REM Open the browser after a short delay
start "" /B cmd /c "timeout /t 1 /nobreak >nul & start %URL%"

REM Try python3 first, then python
where python3 >nul 2>nul
if %errorlevel%==0 (
  python3 -m http.server %PORT%
  goto :end
)

where python >nul 2>nul
if %errorlevel%==0 (
  python -m http.server %PORT%
  goto :end
)

echo.
echo ERROR: Python is not installed.
echo Download it from https://www.python.org/downloads/ and tick
echo "Add Python to PATH" during installation, then run this file again.
pause

:end
