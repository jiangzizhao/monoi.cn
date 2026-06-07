@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ===========================================================
echo   monoi desktop - pull latest + build Windows installer
echo ===========================================================
echo.
echo [1/3] git pull (get latest desktop fixes)...
git pull
if errorlevel 1 ( echo. & echo git pull FAILED - check network / git. & pause & exit /b 1 )
echo.
echo [2/3] npm install (sync deps)...
call npm install
if errorlevel 1 ( echo. & echo npm install FAILED - see errors above. & pause & exit /b 1 )
echo.
echo [3/3] building app (npm run pack:win) - takes a few minutes...
call npm run pack:win
if errorlevel 1 ( echo. & echo BUILD FAILED - see errors above. & pause & exit /b 1 )
echo.
echo ===========================================================
echo   DONE!  Installer is in the  release  folder:
echo     release\monoi-Setup-0.1.2.exe
echo   Double-click it to install, then open monoi from desktop.
echo ===========================================================
echo.
pause
