@echo off
cd /d D:\monoi-server\models\cosyvoice
call venv\Scripts\activate
echo === 升级 pip / setuptools / wheel ===
python -m pip install --upgrade pip setuptools wheel
echo.
echo === 装依赖（耐心等 5-10 分钟，torch 会下载 2-3GB） ===
pip install -r requirements.txt
echo.
echo === 完成。如有 ERROR 请截图 ===
pause
