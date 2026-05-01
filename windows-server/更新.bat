cd /d D:\monoi-server
taskkill /F /IM python.exe
python -c "import urllib.request; urllib.request.urlretrieve('https://raw.githubusercontent.com/jiangzizhao/monoi.cn/main/windows-server/main.py', r'D:\monoi-server\main.py'); print('updated')"
uvicorn main:app --host 0.0.0.0 --port 18765
pause
