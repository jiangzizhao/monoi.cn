@echo off
chcp 65001 >nul
echo 正在停止所有服务...
taskkill /F /IM python.exe 2>nul
taskkill /F /IM natapp.exe 2>nul
echo 全部停止完成
pause
