@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ===========================================================
echo   monoi 桌面版 - 一键发布到所有用户 (直传 OSS)
echo ===========================================================
echo.

if not exist "publish-key.txt" ( echo [缺少发布密钥] 本文件夹没有 publish-key.txt, 找 Claude 要密钥放进去. & pause & exit /b 1 )
set /p PUBKEY=<publish-key.txt
if "%PUBKEY%"=="" ( echo [发布密钥为空] 检查 publish-key.txt. & pause & exit /b 1 )

set "EXE="
set "EXE_NAME="
for %%f in (release\monoi-Setup-*.exe) do ( set "EXE=%%f" & set "EXE_NAME=%%~nxf" )
if not defined EXE ( echo [找不到安装包] release 里没有 monoi-Setup-*.exe, 先跑 build-desktop.bat. & pause & exit /b 1 )
if not exist "release\latest.yml" ( echo [缺少 latest.yml] 重跑 build-desktop.bat. & pause & exit /b 1 )
echo 安装包: %EXE%
echo.
set "NOTES="
set /p NOTES=请输入本次更新说明(可直接回车跳过):
echo.

echo [1/3] 上传安装包 (约 90MB 直传 OSS, 慢上行要几分钟, 别关窗口)...
set "U1="
for /f "usebackq delims=" %%u in (`curl -sS -X POST "https://monoi.cn/api/desktop/publish-sign" -F "publish_key=%PUBKEY%" -F "filename=%EXE_NAME%"`) do set "U1=%%u"
if not "%U1:~0,4%"=="http" ( echo   签名失败: %U1% & pause & exit /b 1 )
curl -sS -f -T "%EXE%" -H "Content-Type: application/octet-stream" "%U1%"
if errorlevel 1 ( echo   安装包上传失败, 截图发 Claude. & pause & exit /b 1 )
echo   安装包 上传完成

echo [2/3] 上传 latest.yml ...
set "U2="
for /f "usebackq delims=" %%u in (`curl -sS -X POST "https://monoi.cn/api/desktop/publish-sign" -F "publish_key=%PUBKEY%" -F "filename=latest.yml"`) do set "U2=%%u"
if not "%U2:~0,4%"=="http" ( echo   签名失败: %U2% & pause & exit /b 1 )
curl -sS -f -T "release\latest.yml" -H "Content-Type: application/octet-stream" "%U2%"
if errorlevel 1 ( echo   latest.yml 上传失败, 截图发 Claude. & pause & exit /b 1 )
echo   latest.yml 上传完成

echo [3/3] 上传 blockmap (差分更新用, 没有也不影响)...
set "U3="
for /f "usebackq delims=" %%u in (`curl -sS -X POST "https://monoi.cn/api/desktop/publish-sign" -F "publish_key=%PUBKEY%" -F "filename=%EXE_NAME%.blockmap"`) do set "U3=%%u"
if "%U3:~0,4%"=="http" if exist "%EXE%.blockmap" curl -sS -f -T "%EXE%.blockmap" -H "Content-Type: application/octet-stream" "%U3%"
echo   blockmap 处理完毕

echo.
echo 正在确认发布...
curl -sS -X POST "https://monoi.cn/api/desktop/publish-finalize" -F "publish_key=%PUBKEY%" -F "exe_name=%EXE_NAME%" -F "notes=%NOTES%"
echo.
echo.
echo ===========================================================
echo   看上面那行: 出现  "success":true  = 发布成功!
echo   用户下次打开桌面版会自动收到更新.
echo   如果是红字 / 403 / 报错, 截图发给 Claude.
echo ===========================================================
echo.
pause
