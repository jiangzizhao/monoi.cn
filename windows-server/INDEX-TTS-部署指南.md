# IndexTTS-2 部署指南（用户克隆专用）

完成后效果：用户在网页"克隆声音"上传一段录音 → 系统用 IndexTTS-2 克隆 → 自然度接近真人。

---

## 步骤 1：克隆 IndexTTS 代码

CMD 运行（**普通 CMD，不进 venv**）：

```cmd
cd /d D:\monoi-server\models
git clone https://github.com/index-tts/index-tts.git index-tts
cd index-tts
```

如果 git 没装，先 `winget install git.git` 装上。

---

## 步骤 2：创建 Python 3.11 venv

```cmd
cd /d D:\monoi-server\models\index-tts
py -3.11 -m venv venv
venv\Scripts\activate
```

激活后命令行变成 `(venv) D:\monoi-server\models\index-tts>`。

---

## 步骤 3：装 PyTorch（支持你的 RTX 5060 Ti）

```cmd
pip install --upgrade pip setuptools wheel
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
```

约 2-3GB，等 5-10 分钟。

---

## 步骤 4：装 IndexTTS 依赖 + FastAPI

```cmd
pip install -r requirements.txt
pip install fastapi uvicorn soundfile
```

如果某些包报错（如 `pynini`），告诉我，单独跳过。

---

## 步骤 5：下载 IndexTTS-2 模型权重（约 5GB）

```cmd
pip install modelscope
mkdir checkpoints
python -c "from modelscope import snapshot_download; snapshot_download('IndexTeam/IndexTTS-2', local_dir='checkpoints')"
```

如果 IndexTTS-2 不存在，回退用 1.5：

```cmd
python -c "from modelscope import snapshot_download; snapshot_download('IndexTeam/IndexTTS-1.5', local_dir='checkpoints')"
```

---

## 步骤 6：验证模型加载

```cmd
python -c "import sys; sys.path.insert(0, '.'); from indextts.infer_v2 import IndexTTS2; m = IndexTTS2(model_dir='checkpoints', cfg_path='checkpoints/config.yaml'); print('OK')"
```

如果 v2 不行，试 v1：
```cmd
python -c "import sys; sys.path.insert(0, '.'); from indextts.infer import IndexTTS; m = IndexTTS(model_dir='checkpoints', cfg_path='checkpoints/config.yaml'); print('OK')"
```

输出 `OK` 就成功。报错告诉我具体内容。

---

## 步骤 7：下载 index-server.py

```cmd
python -c "import urllib.request,time; urllib.request.urlretrieve('https://raw.githubusercontent.com/jiangzizhao/monoi.cn/main/windows-server/index-server.py?t='+str(int(time.time())), r'D:\monoi-server\models\index-tts\index-server.py'); print('done')"
```

---

## 步骤 8：测试启动

在 IndexTTS venv 里：

```cmd
python index-server.py
```

加载模型 1-2 分钟，看到 `Uvicorn running on http://127.0.0.1:9002` 即成功。

---

## 步骤 9：把 index-server 加进一键启动

打开 `D:\monoi-server\一键启动.bat`，在启动 voice-server 之后加一段：

```bat
echo === 启动 IndexTTS 克隆服务 ===
start "index-server" cmd /k "cd /d D:\monoi-server\models\index-tts && venv\Scripts\activate && python index-server.py"
timeout /t 3 /nobreak >nul
```

完整 `一键启动.bat` 应该有 4 个 start 命令：voice-server / **index-server** / main-uvicorn / natapp。

---

## 完成！

之后流程：
- 用户在网页上传克隆 → main.py 路由到 9002 IndexTTS → 用户的声音读文案 → 自然度大跨步。

如果某步报错，把错误贴给我对症下药。
