@echo off
chcp 65001 >nul
echo ===================================
echo 下载封面字体到 D:\monoi-server\fonts\
echo (10 个免费可商用字体, 总 ~51MB)
echo ===================================
echo.

if not exist "D:\monoi-server\fonts" mkdir "D:\monoi-server\fonts"
cd /d D:\monoi-server\fonts

call :dl "SourceHanSansCN-Heavy.otf"  "https://raw.githubusercontent.com/wordshub/free-font/master/assets/font/%%E4%%B8%%AD%%E6%%96%%87/%%E6%%80%%9D%%E6%%BA%%90%%E5%%AD%%97%%E4%%BD%%93%%E7%%B3%%BB%%E5%%88%%97/%%E6%%80%%9D%%E6%%BA%%90%%E9%%BB%%91%%E4%%BD%%93/SourceHanSansCN-Heavy.otf"
call :dl "zcool-xiaowei-logo.otf"     "https://raw.githubusercontent.com/wordshub/free-font/master/assets/font/%%E4%%B8%%AD%%E6%%96%%87/%%E7%%AB%%99%%E9%%85%%B7%%E5%%AD%%97%%E4%%BD%%93%%E7%%B3%%BB%%E5%%88%%97/%%E7%%AB%%99%%E9%%85%%B7%%E5%%B0%%8F%%E8%%96%%87LOGO%%E4%%BD%%93.otf"
call :dl "zcool-qingke-huangyou.ttf"  "https://raw.githubusercontent.com/wordshub/free-font/master/assets/font/%%E4%%B8%%AD%%E6%%96%%87/%%E7%%AB%%99%%E9%%85%%B7%%E5%%AD%%97%%E4%%BD%%93%%E7%%B3%%BB%%E5%%88%%97/%%E7%%AB%%99%%E9%%85%%B7%%E5%%BA%%86%%E7%%A7%%91%%E9%%BB%%84%%E6%%B2%%B9%%E4%%BD%%93.ttf"
call :dl "zcool-kuaile.ttf"           "https://raw.githubusercontent.com/wordshub/free-font/master/assets/font/%%E4%%B8%%AD%%E6%%96%%87/%%E7%%AB%%99%%E9%%85%%B7%%E5%%AD%%97%%E4%%BD%%93%%E7%%B3%%BB%%E5%%88%%97/%%E7%%AB%%99%%E9%%85%%B7%%E5%%BF%%AB%%E4%%B9%%90%%E4%%BD%%93.ttf"
call :dl "shetu-modern-xiaofang.ttf"  "https://raw.githubusercontent.com/wordshub/free-font/master/assets/font/%%E4%%B8%%AD%%E6%%96%%87/%%E5%%85%%B6%%E4%%BB%%96%%E5%%AD%%97%%E4%%BD%%93/%%E6%%91%%84%%E5%%9B%%BE%%E6%%91%%A9%%E7%%99%%BB%%E5%%B0%%8F%%E6%%96%%B9%%E4%%BD%%93.ttf"
call :dl "baotu-xiaobai.ttf"          "https://raw.githubusercontent.com/wordshub/free-font/master/assets/font/%%E4%%B8%%AD%%E6%%96%%87/%%E5%%85%%B6%%E4%%BB%%96%%E5%%AD%%97%%E4%%BD%%93/%%E5%%8C%%85%%E5%%9B%%BE%%E5%%B0%%8F%%E7%%99%%BD%%E4%%BD%%93.ttf"
call :dl "jiangxi-zhuokai.ttf"        "https://raw.githubusercontent.com/wordshub/free-font/master/assets/font/%%E4%%B8%%AD%%E6%%96%%87/%%E5%%85%%B6%%E4%%BB%%96%%E5%%AD%%97%%E4%%BD%%93/%%E6%%B1%%9F%%E8%%A5%%BF%%E6%%8B%%99%%E6%%A5%%B7.ttf"
call :dl "youshe-biaoti-hei.ttf"      "https://raw.githubusercontent.com/wordshub/free-font/master/assets/font/%%E4%%B8%%AD%%E6%%96%%87/%%E5%%85%%B6%%E4%%BB%%96%%E5%%AD%%97%%E4%%BD%%93/%%E4%%BC%%98%%E8%%AE%%BE%%E6%%A0%%87%%E9%%A2%%98%%E9%%BB%%91.ttf"
call :dl "zhuangjia-mincho.ttf"       "https://raw.githubusercontent.com/wordshub/free-font/master/assets/font/%%E6%%97%%A5%%E6%%96%%87/%%E8%%A3%%85%%E7%%94%%B2%%E6%%98%%8E%%E6%%9C%%9D%%E4%%BD%%93.ttf"
call :dl "marker-shouhui.ttf"         "https://raw.githubusercontent.com/wordshub/free-font/master/assets/font/%%E6%%97%%A5%%E6%%96%%87/%%E9%%BA%%A6%%E5%%85%%8B%%E7%%AC%%94%%E6%%89%%8B%%E7%%BB%%98%%E4%%BD%%93.ttf"

echo.
echo ===================================
echo 当前 D:\monoi-server\fonts\ 列表:
echo ===================================
dir /b D:\monoi-server\fonts\
echo.
echo 完成! 重启 voice-server 即可看到字体选择.
pause
goto :eof

:dl
if exist "D:\monoi-server\fonts\%~1" (
    echo [跳过] %~1 已存在
    goto :eof
)
echo [下载] %~1 ...
curl -sL --fail --max-time 180 -o "D:\monoi-server\fonts\%~1" "%~2"
if errorlevel 1 (
    echo   X 失败 ^(网络问题或链接失效^)
    if exist "D:\monoi-server\fonts\%~1" del "D:\monoi-server\fonts\%~1"
) else (
    echo   OK
)
goto :eof
