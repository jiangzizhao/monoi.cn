@echo off
echo ===================================
echo Download cover fonts via monoi.cn Vercel proxy
echo (Vercel Edge fetches GitHub, you fetch Vercel)
echo ===================================
echo.

if not exist "D:\monoi-server\fonts" mkdir "D:\monoi-server\fonts"

call :dl "SourceHanSansCN-Heavy.otf"
call :dl "zcool-xiaowei-logo.otf"
call :dl "zcool-qingke-huangyou.ttf"
call :dl "zcool-kuaile.ttf"
call :dl "shetu-modern-xiaofang.ttf"
call :dl "baotu-xiaobai.ttf"
call :dl "jiangxi-zhuokai.ttf"
call :dl "youshe-biaoti-hei.ttf"
call :dl "zhuangjia-mincho.ttf"
call :dl "marker-shouhui.ttf"

echo.
echo ===================================
echo Files in D:\monoi-server\fonts\
echo ===================================
dir /b D:\monoi-server\fonts\
echo.
echo Done. Restart voice-server.
pause
goto :eof

:dl
if exist "D:\monoi-server\fonts\%~1" (
    echo [SKIP] %~1
    goto :eof
)
echo [DOWN] %~1 ...
curl -sL --fail --max-time 180 -o "D:\monoi-server\fonts\%~1" "https://monoi.cn/api/font?name=%~1"
if errorlevel 1 (
    echo   X failed
    if exist "D:\monoi-server\fonts\%~1" del "D:\monoi-server\fonts\%~1"
) else (
    echo   OK
)
goto :eof
