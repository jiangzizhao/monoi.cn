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
    echo   X oss_helper.py (cosyvoice) 下载失败, 保留旧版
    if exist "D:\monoi-server\models\cosyvoice\oss_helper.py.tmp" del "D:\monoi-server\models\cosyvoice\oss_helper.py.tmp"
) else (
    move /y "D:\monoi-server\models\cosyvoice\oss_helper.py.tmp" "D:\monoi-server\models\cosyvoice\oss_helper.py" >nul
    echo   OK oss_helper.py (cosyvoice)
)

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
