@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ===========================================================
echo   monoi 桌面版 - 一键发布到所有用户 (直传 OSS)
echo ===========================================================
echo.

REM === 1) 读发布密钥 (本文件夹 publish-key.txt, 一行) ===
if not exist "publish-key.txt" (
  echo [缺少发布密钥] 本文件夹里没有 publish-key.txt
  echo   请新建 publish-key.txt, 把 Claude 给的发布密钥粘进去就一行.
  echo.
  pause & exit /b 1
)
set /p PUBKEY=<publish-key.txt
if "%PUBKEY%"=="" ( echo [发布密钥为空] 检查 publish-key.txt. & pause & exit /b 1 )

REM === 2) 找打包产物 ===
set "EXE="
set "EXE_NAME="
for %%f in (release\monoi-Setup-*.exe) do ( set "EXE=%%f" & set "EXE_NAME=%%~nxf" )
if not defined EXE (
  echo [找不到安装包] release 里没有 monoi-Setup-*.exe, 请先双击 build-desktop.bat 打包.
  echo.
  pause & exit /b 1
)
if not exist "release\latest.yml" (
  echo [缺少 latest.yml] 打包没成功? 请重跑 build-desktop.bat.
  echo.
  pause & exit /b 1
)
echo 安装包: %EXE%
echo.
set "NOTES="
set /p NOTES=请输入本次更新说明(可直接回车跳过):
echo.

REM === 3) 逐个文件: 签 OSS 直传 URL  ->  curl -T 直传 OSS (不经过服务器, 稳) ===
echo 正在上传安装包(约 90MB)直传 OSS, 家里上行慢的话要几分钟, 别关窗口...
call :upload "%EXE%" "%EXE_NAME%" || goto :fail
call :upload "release\latest.yml" "latest.yml" || goto :fail
if exist "%EXE%.blockmap" ( call :upload "%EXE%.blockmap" "%EXE_NAME%.blockmap" || goto :fail )

REM === 4) 确认发布 (小请求, 更新版本记录让新版生效) ===
echo.
echo 正在确认发布...
curl -sS -X POST "https://monoi.cn/api/desktop/publish-finalize" -F "publish_key=%PUBKEY%" -F "exe_name=%EXE_NAME%" -F "notes=%NOTES%"
echo.
echo.
echo ===========================================================
echo   看上面那行: 出现  "success":true  = 发布成功!
echo   用户下次打开桌面版会自动收到更新.
echo ===========================================================
echo.
pause
exit /b 0

REM ---------- 子程序: 上传单个文件 ----------
:upload
REM %~1 = 本地路径, %~2 = OSS 上的文件名
echo   - 处理 %~2 ...
set "PUTURL="
for /f "usebackq delims=" %%u in (`curl -sS -X POST "https://monoi.cn/api/desktop/publish-sign" -F "publish_key=%PUBKEY%" -F "filename=%~2"`) do set "PUTURL=%%u"
if not defined PUTURL ( echo     签名请求没返回, 检查网络. & exit /b 1 )
if not "%PUTURL:~0,4%"=="http" ( echo     签名失败: %PUTURL% & exit /b 1 )
curl -sS -f -T "%~1" -H "Content-Type: application/octet-stream" "%PUTURL%"
if errorlevel 1 ( echo     上传失败: %~2 & exit /b 1 )
echo     %~2 上传完成
exit /b 0

:fail
echo.
echo ===========================================================
echo   上传失败了. 把上面的报错截图发给 Claude.
echo ===========================================================
echo.
pause
exit /b 1
