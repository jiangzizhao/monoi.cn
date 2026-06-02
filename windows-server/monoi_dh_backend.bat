@echo off
chcp 65001 >nul
title monoi 数字人后台启动器
echo ============================================
echo   monoi 数字人后台 (开机自动起)
echo   HeyGem 容器 + frp 隧道 + agent + 看门狗
echo ============================================
echo.

REM 1. HeyGem 容器: 设开机自启 + 现在拉起
docker update --restart=always duix-avatar-gen-video >nul 2>&1
docker start duix-avatar-gen-video >nul 2>&1
echo  [1/4] HeyGem 容器: 已设开机自启 + 启动

REM 2. frp 隧道 (连阿里云)
start "monoi-frpc" /min D:\monoi-server\frp\frpc.exe -c D:\monoi-server\frp\frpc.toml
echo  [2/4] frp 隧道: 已启动

REM 3. 数字人 agent (云端把音频/形象发到这, 调本地 HeyGem)
start "monoi-agent" /min python D:\monoi-server\heygem_agent.py
echo  [3/4] 数字人 agent: 已启动

REM 4. 看门狗 (HeyGem 卡死 → 重启容器 → 还卡 → 重启电脑)
start "monoi-watchdog" /min python D:\monoi-server\heygem_watchdog.py
echo  [4/4] 看门狗: 已启动

echo.
echo  全部启动完成。这个窗口 5 秒后自动关 (其余 4 个最小化在跑)。
ping -n 6 127.0.0.1 >nul
