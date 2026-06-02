@echo off
echo ============================================
echo   monoi digital-human backend (autostart)
echo   HeyGem container + frp tunnel + agent + watchdog
echo ============================================
echo.

REM 1. HeyGem container: set restart=always + start now
docker update --restart=always duix-avatar-gen-video >nul 2>&1
docker start duix-avatar-gen-video >nul 2>&1
echo  [1/4] HeyGem container: restart=always + started

REM 2. frp tunnel (to Aliyun)
start "monoi-frpc" /min D:\monoi-server\frp\frpc.exe -c D:\monoi-server\frp\frpc.toml
echo  [2/4] frp tunnel: started

REM 3. digital-human agent (cloud sends audio/avatar here -> local HeyGem)
start "monoi-agent" /min python D:\monoi-server\heygem_agent.py
echo  [3/4] heygem agent: started

REM 4. watchdog (HeyGem stuck -> restart container -> still stuck -> reboot PC)
start "monoi-watchdog" /min python D:\monoi-server\heygem_watchdog.py
echo  [4/4] watchdog: started

echo.
echo  All started. This window closes in 5s. Other 4 run minimized.
ping -n 6 127.0.0.1 >nul
