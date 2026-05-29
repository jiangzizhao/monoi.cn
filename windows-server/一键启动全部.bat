@echo off
chcp 65001 >nul
echo ===================================
echo monoi 一键启动 (代码同步 + 5 个服务)
echo ===================================
echo.

echo [0/5] 同步最新代码 from GitHub...

curl -s --fail --max-time 30 -o "D:\monoi-server\main.py.tmp" https://raw.githubusercontent.com/jiangzizhao/monoi.cn/main/windows-server/main.py
if errorlevel 1 (
    echo   X main.py 下载失败, 保留旧版
    if exist "D:\monoi-server\main.py.tmp" del "D:\monoi-server\main.py.tmp"
) else (
    move /y "D:\monoi-server\main.py.tmp" "D:\monoi-server\main.py" >nul
    echo   OK main.py
)

curl -s --fail --max-time 30 -o "D:\monoi-server\models\cosyvoice\voice-server.py.tmp" https://raw.githubusercontent.com/jiangzizhao/monoi.cn/main/windows-server/voice-server.py
if errorlevel 1 (
    echo   X voice-server.py 下载失败, 保留旧版
    if exist "D:\monoi-server\models\cosyvoice\voice-server.py.tmp" del "D:\monoi-server\models\cosyvoice\voice-server.py.tmp"
) else (
    move /y "D:\monoi-server\models\cosyvoice\voice-server.py.tmp" "D:\monoi-server\models\cosyvoice\voice-server.py" >nul
    echo   OK voice-server.py
)

curl -s --fail --max-time 30 -o "D:\monoi-server\models\cosyvoice\cover_compositor.py.tmp" https://raw.githubusercontent.com/jiangzizhao/monoi.cn/main/windows-server/cover_compositor.py
if errorlevel 1 (
    echo   X cover_compositor.py 下载失败, 保留旧版
    if exist "D:\monoi-server\models\cosyvoice\cover_compositor.py.tmp" del "D:\monoi-server\models\cosyvoice\cover_compositor.py.tmp"
) else (
    move /y "D:\monoi-server\models\cosyvoice\cover_compositor.py.tmp" "D:\monoi-server\models\cosyvoice\cover_compositor.py" >nul
    echo   OK cover_compositor.py
)

curl -s --fail --max-time 30 -o "D:\monoi-server\models\index-tts\index-server.py.tmp" https://raw.githubusercontent.com/jiangzizhao/monoi.cn/main/windows-server/index-server.py
if errorlevel 1 (
    echo   X index-server.py 下载失败, 保留旧版
    if exist "D:\monoi-server\models\index-tts\index-server.py.tmp" del "D:\monoi-server\models\index-tts\index-server.py.tmp"
) else (
    move /y "D:\monoi-server\models\index-tts\index-server.py.tmp" "D:\monoi-server\models\index-tts\index-server.py" >nul
    echo   OK index-server.py
)

curl -s --fail --max-time 30 -o "D:\monoi-server\oss_helper.py.tmp" https://raw.githubusercontent.com/jiangzizhao/monoi.cn/main/windows-server/oss_helper.py
if errorlevel 1 (
    echo   X oss_helper.py [main] 下载失败, 保留旧版
    if exist "D:\monoi-server\oss_helper.py.tmp" del "D:\monoi-server\oss_helper.py.tmp"
) else (
    move /y "D:\monoi-server\oss_helper.py.tmp" "D:\monoi-server\oss_helper.py" >nul
    echo   OK oss_helper.py [main]
)

curl -s --fail --max-time 30 -o "D:\monoi-server\models\cosyvoice\oss_helper.py.tmp" https://raw.githubusercontent.com/jiangzizhao/monoi.cn/main/windows-server/oss_helper.py
if errorlevel 1 (
    echo   X oss_helper.py [cosyvoice] 下载失败, 保留旧版
    if exist "D:\monoi-server\models\cosyvoice\oss_helper.py.tmp" del "D:\monoi-server\models\cosyvoice\oss_helper.py.tmp"
) else (
    move /y "D:\monoi-server\models\cosyvoice\oss_helper.py.tmp" "D:\monoi-server\models\cosyvoice\oss_helper.py" >nul
    echo   OK oss_helper.py [cosyvoice]
)

echo.
echo [封面字体] 检查 D:\monoi-server\fonts\ (首次下载约 51MB, 已存在跳过)
if not exist "D:\monoi-server\fonts" mkdir "D:\monoi-server\fonts"

call :dlfont "SourceHanSansCN-Heavy.otf"  "https://raw.githubusercontent.com/wordshub/free-font/master/assets/font/%%E4%%B8%%AD%%E6%%96%%87/%%E6%%80%%9D%%E6%%BA%%90%%E5%%AD%%97%%E4%%BD%%93%%E7%%B3%%BB%%E5%%88%%97/%%E6%%80%%9D%%E6%%BA%%90%%E9%%BB%%91%%E4%%BD%%93/SourceHanSansCN-Heavy.otf"
call :dlfont "zcool-xiaowei-logo.otf"     "https://raw.githubusercontent.com/wordshub/free-font/master/assets/font/%%E4%%B8%%AD%%E6%%96%%87/%%E7%%AB%%99%%E9%%85%%B7%%E5%%AD%%97%%E4%%BD%%93%%E7%%B3%%BB%%E5%%88%%97/%%E7%%AB%%99%%E9%%85%%B7%%E5%%B0%%8F%%E8%%96%%87LOGO%%E4%%BD%%93.otf"
call :dlfont "zcool-qingke-huangyou.ttf"  "https://raw.githubusercontent.com/wordshub/free-font/master/assets/font/%%E4%%B8%%AD%%E6%%96%%87/%%E7%%AB%%99%%E9%%85%%B7%%E5%%AD%%97%%E4%%BD%%93%%E7%%B3%%BB%%E5%%88%%97/%%E7%%AB%%99%%E9%%85%%B7%%E5%%BA%%86%%E7%%A7%%91%%E9%%BB%%84%%E6%%B2%%B9%%E4%%BD%%93.ttf"
call :dlfont "zcool-kuaile.ttf"           "https://raw.githubusercontent.com/wordshub/free-font/master/assets/font/%%E4%%B8%%AD%%E6%%96%%87/%%E7%%AB%%99%%E9%%85%%B7%%E5%%AD%%97%%E4%%BD%%93%%E7%%B3%%BB%%E5%%88%%97/%%E7%%AB%%99%%E9%%85%%B7%%E5%%BF%%AB%%E4%%B9%%90%%E4%%BD%%93.ttf"
call :dlfont "shetu-modern-xiaofang.ttf"  "https://raw.githubusercontent.com/wordshub/free-font/master/assets/font/%%E4%%B8%%AD%%E6%%96%%87/%%E5%%85%%B6%%E4%%BB%%96%%E5%%AD%%97%%E4%%BD%%93/%%E6%%91%%84%%E5%%9B%%BE%%E6%%91%%A9%%E7%%99%%BB%%E5%%B0%%8F%%E6%%96%%B9%%E4%%BD%%93.ttf"
call :dlfont "baotu-xiaobai.ttf"          "https://raw.githubusercontent.com/wordshub/free-font/master/assets/font/%%E4%%B8%%AD%%E6%%96%%87/%%E5%%85%%B6%%E4%%BB%%96%%E5%%AD%%97%%E4%%BD%%93/%%E5%%8C%%85%%E5%%9B%%BE%%E5%%B0%%8F%%E7%%99%%BD%%E4%%BD%%93.ttf"
call :dlfont "jiangxi-zhuokai.ttf"        "https://raw.githubusercontent.com/wordshub/free-font/master/assets/font/%%E4%%B8%%AD%%E6%%96%%87/%%E5%%85%%B6%%E4%%BB%%96%%E5%%AD%%97%%E4%%BD%%93/%%E6%%B1%%9F%%E8%%A5%%BF%%E6%%8B%%99%%E6%%A5%%B7.ttf"
call :dlfont "youshe-biaoti-hei.ttf"      "https://raw.githubusercontent.com/wordshub/free-font/master/assets/font/%%E4%%B8%%AD%%E6%%96%%87/%%E5%%85%%B6%%E4%%BB%%96%%E5%%AD%%97%%E4%%BD%%93/%%E4%%BC%%98%%E8%%AE%%BE%%E6%%A0%%87%%E9%%A2%%98%%E9%%BB%%91.ttf"
call :dlfont "zhuangjia-mincho.ttf"       "https://raw.githubusercontent.com/wordshub/free-font/master/assets/font/%%E6%%97%%A5%%E6%%96%%87/%%E8%%A3%%85%%E7%%94%%B2%%E6%%98%%8E%%E6%%9C%%9D%%E4%%BD%%93.ttf"
call :dlfont "marker-shouhui.ttf"         "https://raw.githubusercontent.com/wordshub/free-font/master/assets/font/%%E6%%97%%A5%%E6%%96%%87/%%E9%%BA%%A6%%E5%%85%%8B%%E7%%AC%%94%%E6%%89%%8B%%E7%%BB%%98%%E4%%BD%%93.ttf"

goto :after_fonts

:dlfont
if exist "D:\monoi-server\fonts\%~1" (
    echo   = %~1 已存在
    exit /b 0
)
echo   ↓ 下载 %~1...
curl -sL --fail --max-time 120 -o "D:\monoi-server\fonts\%~1.tmp" "%~2"
if errorlevel 1 (
    echo     X 失败 (网络问题, 启动会用兜底字体)
    if exist "D:\monoi-server\fonts\%~1.tmp" del "D:\monoi-server\fonts\%~1.tmp"
    exit /b 0
)
move /y "D:\monoi-server\fonts\%~1.tmp" "D:\monoi-server\fonts\%~1" >nul
echo     OK
exit /b 0

:after_fonts

echo.
echo [1/5] 启动 voice-server (CosyVoice2)...
start "voice-server" cmd /k "cd /d D:\monoi-server\models\cosyvoice && venv\Scripts\activate && python voice-server.py"
timeout /t 3 /nobreak >nul

echo [2/5] 启动 main.py (uvicorn)...
start "main-uvicorn" cmd /k "cd /d D:\monoi-server && uvicorn main:app --host 0.0.0.0 --port 18765"
timeout /t 3 /nobreak >nul

echo [3/5] 启动 NATAPP 隧道...
start "natapp" cmd /k "D:\natapp.cn\新建文件夹\natapp.exe -authtoken=8d8bbb41963fd593"
timeout /t 3 /nobreak >nul

echo [4/5] 启动 index-server (IndexTTS-2)...
start "index-server" cmd /k "D:\monoi-server\index-server-watchdog.bat"
timeout /t 3 /nobreak >nul

echo [5/5] 启动 HeyGem 数字人容器...
docker info >nul 2>&1
if errorlevel 1 (
    echo   Docker 未启动, 跳过 HeyGem
    echo   请打开 Docker Desktop 后手动跑:
    echo     docker compose -f D:\monoi-server\heygem.docker-compose.yml up -d
) else (
    docker compose -f D:\monoi-server\heygem.docker-compose.yml up -d
    echo   HeyGem 容器已启动
)

echo.
echo ===================================
echo 启动完成 (5 个服务)
echo  - voice-server : 9001
echo  - main.py      : 18765
echo  - natapp       : monoi.nat100.top
echo  - index-server : 9002
echo  - HeyGem       : 8383
echo ===================================
echo.
pause
