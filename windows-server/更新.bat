cd /d D:\monoi-server
taskkill /F /IM python.exe
git pull
uvicorn main:app --host 0.0.0.0 --port 18765
pause
