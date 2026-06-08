@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ===========================================================
echo   monoi 桌面版 - 一键发布到所有用户
echo ===========================================================
echo.

REM === 1) 读发布密钥 (放在本文件夹的 publish-key.txt, 一行) ===
if not exist "publish-key.txt" (
  echo [缺少发布密钥] 本文件夹里没有 publish-key.txt
  echo   请新建 publish-key.txt, 把 Claude 给你的发布密钥粘贴进去就一行.
  echo.
  pause & exit /b 1
)
set /p PUBKEY=<publish-key.txt
if "%PUBKEY%"=="" ( echo [发布密钥为空] 请检查 publish-key.txt 内容. & pause & exit /b 1 )

REM === 2) 找打包产物 ===
set "EXE="
for %%f in (release\monoi-Setup-*.exe) do set "EXE=%%f"
if not defined EXE (
  echo [找不到安装包] release 文件夹里没有 monoi-Setup-*.exe
  echo   请先双击 build-desktop.bat 打包, 再来发布.
  echo.
  pause & exit /b 1
)
if not exist "release\latest.yml" (
  echo [缺少 latest.yml] 打包可能没成功, 请重跑 build-desktop.bat.
  echo.
  pause & exit /b 1
)
echo 安装包: %EXE%
echo.

REM === 3) 更新说明 (给用户看, 可留空) ===
set "NOTES="
set /p NOTES=请输入本次更新说明(可直接回车跳过):

echo.
echo 正在上传发布... 安装包约 90MB, 请耐心等 1-3 分钟, 不要关窗口.
echo.

REM === 4) 上传 (有 blockmap 就一起传, 没有就不传) ===
if exist "%EXE%.blockmap" (
  curl -sS -X POST "https://monoi.cn/api/desktop/publish" ^
    -F "publish_key=%PUBKEY%" ^
    -F "notes=%NOTES%" ^
    -F "exe=@%EXE%" ^
    -F "latest_yml=@release\latest.yml" ^
    -F "blockmap=@%EXE%.blockmap"
) else (
  curl -sS -X POST "https://monoi.cn/api/desktop/publish" ^
    -F "publish_key=%PUBKEY%" ^
    -F "notes=%NOTES%" ^
    -F "exe=@%EXE%" ^
    -F "latest_yml=@release\latest.yml"
)

echo.
echo.
echo ===========================================================
echo   看上面那行: 出现  "success":true  = 发布成功!
echo   用户下次打开桌面版会自动收到更新.
echo   如果是红字 / 403 / 400 / 报错, 截图发给 Claude.
echo ===========================================================
echo.
pause
