@echo off
chcp 65001 >nul
echo ===================================
echo 同步 4 个文件 + 重启 main.py
echo ===================================

cd /d D:\monoi-server
taskkill /F /IM python.exe 2>nul

echo [1/4] main.py (uvicorn 主服务)
python -c "import urllib.request; urllib.request.urlretrieve('https://raw.githubusercontent.com/jiangzizhao/monoi.cn/main/windows-server/main.py', r'D:\monoi-server\main.py'); print('  ok')"

echo [2/4] oss_helper.py (main.py 同目录)
python -c "import urllib.request; urllib.request.urlretrieve('https://raw.githubusercontent.com/jiangzizhao/monoi.cn/main/windows-server/oss_helper.py', r'D:\monoi-server\oss_helper.py'); print('  ok')"

echo [3/4] voice-server.py (cosyvoice 目录)
python -c "import urllib.request; urllib.request.urlretrieve('https://raw.githubusercontent.com/jiangzizhao/monoi.cn/main/windows-server/voice-server.py', r'D:\monoi-server\models\cosyvoice\voice-server.py'); print('  ok')"

echo [4/4] oss_helper.py (cosyvoice 目录, voice-server 用)
python -c "import urllib.request; urllib.request.urlretrieve('https://raw.githubusercontent.com/jiangzizhao/monoi.cn/main/windows-server/oss_helper.py', r'D:\monoi-server\models\cosyvoice\oss_helper.py'); print('  ok')"

echo.
echo ===================================
echo 文件同步完成. 启动 main.py...
echo ===================================
uvicorn main:app --host 0.0.0.0 --port 18765
pause
