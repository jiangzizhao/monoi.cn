@echo off
chcp 65001 >nul
echo ===================================
echo monoi 一键启动 (3 个服务)
echo ===================================
echo.

echo [1/3] 启动 voice-server (CosyVoice GPU 推理)...
start "voice-server" cmd /k "cd /d D:\monoi-server\models\cosyvoice && venv\Scripts\activate && python voice-server.py"

timeout /t 3 /nobreak >nul

echo [2/3] 启动 main.py (uvicorn 主服务)...
start "main-uvicorn" cmd /k "cd /d D:\monoi-server && uvicorn main:app --host 0.0.0.0 --port 18765"

timeout /t 3 /nobreak >nul

echo [3/3] 启动 NATAPP 隧道...
start "natapp" cmd /k "D:\natapp.cn\新建文件夹\natapp.exe -authtoken=8d8bbb41963fd593"

echo.
echo ===================================
echo 3 个窗口已启动
echo  - voice-server: 9001
echo  - main.py: 18765
echo  - natapp: monoi.nat100.top
echo ===================================
echo.
echo 等 30 秒后所有服务就绪，可以开始测试
pause
