@echo off
chcp 65001 >nul
echo ===================================
echo monoi 一键启动 (先同步代码再启动 3 个服务)
echo ===================================
echo.

echo [同步 1/4] main.py
python -c "import urllib.request; urllib.request.urlretrieve('https://raw.githubusercontent.com/jiangzizhao/monoi.cn/main/windows-server/main.py', r'D:\monoi-server\main.py'); print('  ok')" 2>nul || echo   失败 (网络问题, 用本地老版本)

echo [同步 2/4] oss_helper.py (main 目录)
python -c "import urllib.request; urllib.request.urlretrieve('https://raw.githubusercontent.com/jiangzizhao/monoi.cn/main/windows-server/oss_helper.py', r'D:\monoi-server\oss_helper.py'); print('  ok')" 2>nul || echo   失败

echo [同步 3/4] voice-server.py
python -c "import urllib.request; urllib.request.urlretrieve('https://raw.githubusercontent.com/jiangzizhao/monoi.cn/main/windows-server/voice-server.py', r'D:\monoi-server\models\cosyvoice\voice-server.py'); print('  ok')" 2>nul || echo   失败

echo [同步 4/4] oss_helper.py (cosyvoice 目录)
python -c "import urllib.request; urllib.request.urlretrieve('https://raw.githubusercontent.com/jiangzizhao/monoi.cn/main/windows-server/oss_helper.py', r'D:\monoi-server\models\cosyvoice\oss_helper.py'); print('  ok')" 2>nul || echo   失败

echo.
echo ===================================
echo 启动服务...
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
