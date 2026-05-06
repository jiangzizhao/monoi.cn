# HeyGem 数字人部署指南（Windows + Docker）

最终效果：上传一张你的照片 + 一段音频 → 生成对口型口播视频。

总时长：约 30-60 分钟（看下载速度）

---

## 第 1 步：装 Docker Desktop

### 下载

打开 https://www.docker.com/products/docker-desktop/

点 **Download for Windows - AMD64** 下载安装包（约 600MB）。

### 安装

1. 双击 `Docker Desktop Installer.exe`
2. 安装界面默认选项**全部勾上**：
   - ✅ Use WSL 2 instead of Hyper-V
   - ✅ Add shortcut to desktop
3. 点 OK 等几分钟
4. 安装完会提示 **Restart**，点重启电脑

### 启动 + 配置

重启后：

1. 双击桌面 **Docker Desktop** 图标
2. 弹出 "Accept terms" → 点 Accept
3. 跳过登录（点 "Continue without signing in"）
4. 跳过调查问卷
5. **右下角任务栏**应该出现一个**鲸鱼图标**，绿色就是成功

### 启用 GPU

1. Docker Desktop → 右上角 **齿轮 ⚙️** → Settings
2. 左侧 **Resources → WSL Integration**
3. 把 **Ubuntu**（如果有）那行**打勾**
4. 点 **Apply & restart**

### 验证 Docker 可以用 GPU

打开 **新 CMD**，跑：

```cmd
docker --version
```

应该输出 `Docker version 27.x.x` 之类。

```cmd
docker run --rm --gpus all nvidia/cuda:12.4.0-base-ubuntu22.04 nvidia-smi
```

应该输出一个表格，里面有 **NVIDIA GeForce RTX 5060 Ti**。

⚠️ 第一次跑会下载 cuda 镜像（约 200MB），等几分钟。

---

## 第 2 步：拉 HeyGem 镜像

打开 CMD：

```cmd
docker pull guijiai/heygem-gen-video:latest
docker pull guijiai/heygem-tts:latest
docker pull guijiai/heygem-asr:latest
```

⚠️ 三个镜像加起来约 **15-25GB**，看网速可能要 30-60 分钟。

---

## 第 3 步：运行 HeyGem

新建文件 `D:\monoi-server\heygem\docker-compose.yml`：

```cmd
mkdir D:\monoi-server\heygem
notepad D:\monoi-server\heygem\docker-compose.yml
```

粘贴下面内容（**完整版我等会儿确认正确性后给你**）：

```yaml
version: '3.8'
services:
  heygem-gen-video:
    image: guijiai/heygem-gen-video:latest
    container_name: heygem-gen-video
    restart: unless-stopped
    ports:
      - "8383:8383"
    volumes:
      - D:/monoi-server/heygem/data:/code/data
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    runtime: nvidia
```

启动：
```cmd
cd /d D:\monoi-server\heygem
docker compose up -d
```

查看日志：
```cmd
docker compose logs -f heygem-gen-video
```

看到类似 `Uvicorn running on 0.0.0.0:8383` 就 OK。

---

## 第 4 步：测试

新 CMD：

```cmd
curl http://127.0.0.1:8383/health
```

应该返回 `{"status": "ok"}` 或类似。

---

## 第 5 步：整合（我做）

完成上面 4 步后告诉我：
1. `docker compose up -d` 没报错
2. `curl http://127.0.0.1:8383/health` 有响应

我会：
- 写 main.py 路由：`/api/digital-human/lipsync`
- 写前端模块"数字人 → 上传形象 + 音频 → 生成视频"
- 加进一键启动 / 一键停止

---

## 后续（你不用管）

- HeyGem 容器跟其他服务一起跑（不冲突）
- 通过 NATAPP 暴露给 Vercel 前端
- 数字人合成耗时：1 分钟视频约 2-3 分钟

---

## 卡住时

- Docker Desktop 鲸鱼图标变红 → Settings → Reset to factory defaults
- `docker pull` 慢或失败 → 配置阿里云镜像加速：Docker Desktop → Settings → Docker Engine → 加 `"registry-mirrors": ["https://registry.cn-hangzhou.aliyuncs.com"]`
- GPU 不可用 → 重装 NVIDIA 驱动 + WSL2 内核

哪步报错截图发我，对症下药。
