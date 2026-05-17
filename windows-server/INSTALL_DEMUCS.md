# 音乐去人声 (Demucs)

> 用户上传任意音乐 → Meta 开源 demucs (htdemucs 模型) 自动去人声 → 导出纯 BGM (mp3).
> 集成在一键合成弹窗的 BGM 上传区, 也可独立调用.

## 1. 装 SDK + 模型

在 `D:\monoi-server` 跑:

```bat
pip install demucs
```

依赖比较大 (~150MB 含 PyTorch 等), 首次跑还会**自动下载 htdemucs 模型 (~80MB)**.

> ℹ Demucs 内部依赖 PyTorch. 你 voice-server 之前应该已经装过 PyTorch (whisper 用),
> 这里不会重新装, 共用现有环境.

## 2. GPU 加速 (可选, 强烈推荐)

Demucs 检测到 CUDA 自动用. 你机器**已经有 GPU** (whisper 已经在用), 应该自动启用:

```bat
python -c "import torch; print('CUDA:', torch.cuda.is_available())"
```

输出 `CUDA: True` 就 OK, 后端 cmd 启动会打:
```
[demucs] 开始分离: xxx.mp3 (GPU=True)
```

CPU 模式也能跑, 只是慢 5-10x. 一首 3 分钟歌:
- GPU: 10-30 秒
- CPU: 2-5 分钟

## 3. 拉新版后端代码

```bat
cd /d D:\monoi-server
curl -L -O https://raw.githubusercontent.com/jiangzizhao/monoi.cn/main/windows-server/audio_separation.py
curl -L -O https://raw.githubusercontent.com/jiangzizhao/monoi.cn/main/windows-server/voice-server.py
:: 重启 voice-server.py (不是 main.py, 端点加在 voice-server)
```

不需要新 env. 启动后 endpoint `/remove-vocals` 立即可用.

## 4. 验证

1. 网页 monoi.cn → 走完文案/配音/口播/素材/合成流程
2. 在"一键合成"弹窗的 BGM 区域, 点 "**或者: 上传有人声的歌, AI 自动去人声做 BGM**"
3. 弹出去人声弹窗, 上传一首 mp3 (任意带人声的歌)
4. 等 10s-5min (看 GPU/CPU)
5. 显示 "去人声完成" + 显示时长/大小/GPU 标记
6. 点 "**直接用作合成 BGM**" → 弹窗关 + 上层 BGM 自动设上去
7. 或者点 "**下载 BGM mp3**" → 浏览器下载 mp3

后端 cmd 应该看到:
```
[demucs] 开始分离: input.mp3 (GPU=True)
[demucs] 分离完成: vocals=15234KB, bgm=14876KB
```

## 5. 排错

### `demucs 未安装`
- 跑 `pip install demucs` 没装上, 或装在不同 Python 环境
- 解法: `python -m pip install demucs` (用 voice-server.py 同一个 Python)

### 报 `CUDA out of memory`
- 模型加载时 GPU 显存不足 (一般 demucs 要 2-3GB)
- 解法: 临时禁用 GPU 强制 CPU
  ```bat
  set CUDA_VISIBLE_DEVICES=
  python voice-server.py
  ```

### 卡 5 分钟超时 (10 分钟硬上限)
- 一般是超长歌曲 (>10 分钟) + CPU 模式
- 解法: 装 GPU 或让用户裁剪歌曲到 5 分钟内

### 输出 BGM 仍能听到模糊人声
- 这是 demucs 模型上限. htdemucs 已经是业界最好的开源模型
- 解法: 商业级用 UVR5 GUI 工具人工调参. monoi 暂时只到 htdemucs

## 6. 成本估算

| 模式 | 一首歌耗时 | 服务器成本 |
|---|---|---|
| GPU (你机器) | 10-30s | ¥0 (自己机器) |
| CPU | 2-5min | ¥0 |

跟其他 AI 功能比, 去人声成本最低 (一次性, 不调外部 API).

## 7. 商业化建议 (V2)

- **免费用户**: 一周 1 次 (作为吸引功能)
- **Pro+**: 不限次数
- 后续可以加 stems 4 轨道分离 (vocals/drums/bass/other) 给高级用户

V1 暂未限制, 所有用户都能用.
