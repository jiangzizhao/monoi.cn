"""
家里 Win 上的数字人 agent —— 让云端用家里那台 N 卡跑 HeyGem。

背景: 数字人 HeyGem 在家里 Win(5060Ti), 云上 main.py 通过 frp 隧道访问。
现有 main.py 的提交逻辑是"把文件写到本地 DUIX_DATA_DIR 再让 HeyGem 按文件名读"——
但 HeyGem 在家里, 云上写的文件家里读不到。所以这个 agent 跑在家里, 负责:
  云上把 音频 + 形象视频 发来 → agent 本地落盘 + ffmpeg 转码 → 调本地 HeyGem
  /easy/submit → 回 code; 云上轮询 → agent 代理 /easy/query; 完成后取结果视频。

部署: 跑在家里 Win, 端口 8385; frpc 把 8385 映射到云上 18385, main.py 连 127.0.0.1:18385。
依赖: fastapi uvicorn requests + ffmpeg (家里原后端环境都有)。
启动: python heygem_agent.py   (或 uvicorn heygem_agent:app --host 127.0.0.1 --port 8385)
"""
import os
import uuid
import subprocess

import requests
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse

# 本地 HeyGem (duix.avatar) 容器 API
HEYGEM_API = os.environ.get("HEYGEM_API", "http://127.0.0.1:8383/easy")
# HeyGem 容器挂载的 temp 目录 (音频/形象/结果都在这, 跟 main.py 的 DUIX_DATA_DIR 一致)
DATA_DIR = os.environ.get(
    "DUIX_DATA_DIR",
    r"D:\monoi-server\heygem-data\face2face\temp" if os.name == "nt"
    else "/data/monoi-server/heygem-data/face2face/temp"
)
AGENT_PORT = int(os.environ.get("HEYGEM_AGENT_PORT", "8385"))

os.makedirs(DATA_DIR, exist_ok=True)
app = FastAPI(title="HeyGem Agent")


@app.get("/health")
def health():
    """探活: agent 在 + 本地 HeyGem 能连。云上看门狗/排队前先 check 这个。"""
    try:
        requests.get(f"{HEYGEM_API}/query", params={"code": "_health_"}, timeout=5)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(503, f"HeyGem 不可达: {e}")


@app.post("/generate")
def generate(audio: UploadFile = File(...), avatar: UploadFile = File(...)):
    """收云上发来的 音频 + 形象视频 → 本地落盘 + 转码 → 提交本地 HeyGem。返 {code}。
    跟 main.py 原 submit_digital_human 的文件准备逻辑一致, 只是改成接收上传的文件。"""
    code = uuid.uuid4().hex[:16]
    audio_name = f"{code}_audio.wav"
    video_name = f"{code}_video.mp4"
    audio_path = os.path.join(DATA_DIR, audio_name)
    video_path = os.path.join(DATA_DIR, video_name)

    # 1. 音频: 先存原始, ffmpeg 统一转 16kHz 单声道 16bit PCM wav
    #    (HeyGem 的 ffprobe 只认标准 PCM, IndexTTS 的 24kHz 它读不出 → "三次获取音频时长失败")
    raw = audio_path + ".raw"
    try:
        with open(raw, "wb") as f:
            f.write(audio.file.read())
        conv = subprocess.run(
            ["ffmpeg", "-y", "-i", raw, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", audio_path],
            capture_output=True, timeout=120,
        )
        try:
            os.remove(raw)
        except Exception:
            pass
        if conv.returncode != 0 or not os.path.exists(audio_path) or os.path.getsize(audio_path) == 0:
            err = conv.stderr.decode("utf-8", errors="ignore")[-300:]
            _cleanup(audio_path, video_path)
            raise HTTPException(400, f"音频转码失败: {err}")
        # 2. 形象视频直接落到 temp 目录 (HeyGem 按文件名读)
        with open(video_path, "wb") as f:
            f.write(avatar.file.read())
    except HTTPException:
        raise
    except Exception as e:
        _cleanup(audio_path, video_path)
        raise HTTPException(500, f"准备文件失败: {e}")

    # 3. 提交本地 HeyGem
    payload = {
        "audio_url": audio_name,
        "video_url": video_name,
        "code": code,
        "chaofen": 0,
        "watermark_switch": 0,
        "pn": 1,
    }
    try:
        r = requests.post(f"{HEYGEM_API}/submit", json=payload, timeout=30)
    except requests.exceptions.ConnectionError:
        _cleanup(audio_path, video_path)
        raise HTTPException(503, "本地 HeyGem (8383) 未启动")
    if r.status_code != 200:
        _cleanup(audio_path, video_path)
        raise HTTPException(502, f"HeyGem submit 错误: {r.text[:200]}")
    data = r.json()
    if not data.get("success"):
        _cleanup(audio_path, video_path)
        raise HTTPException(502, data.get("msg") or "HeyGem 提交失败")
    return {"success": True, "code": code}


@app.get("/query")
def query(code: str):
    """代理本地 HeyGem /easy/query, 原样返回 (status 1处理/2完成/3失败)。"""
    try:
        r = requests.get(f"{HEYGEM_API}/query", params={"code": code}, timeout=10)
    except requests.exceptions.ConnectionError:
        raise HTTPException(503, "本地 HeyGem (8383) 未启动")
    return r.json()


@app.post("/restart")
def restart_heygem():
    """重启本地 HeyGem 容器 —— 云端 worker 在任务卡死(GPU 0% 但 HTTP 还活, 看门狗抓不到)
    超时时调这个, 解开卡死、不让后续任务全堵住。"""
    container = os.environ.get("HEYGEM_CONTAINER", "duix-avatar-gen-video")
    try:
        subprocess.run(["docker", "restart", container], capture_output=True, timeout=90)
        return {"ok": True, "restarted": container}
    except Exception as e:
        raise HTTPException(500, f"重启容器失败: {e}")


@app.get("/video")
def video(path: str):
    """把结果视频回传给云端 (云端再上 OSS 发给用户)。path = HeyGem 返回的 result 路径。"""
    safe = (path or "").replace("\\", "/").lstrip("/")
    # 安全: 只允许读 DATA_DIR 内的文件, 规范化后校验前缀, 阻断 ../ 目录穿越
    base = os.path.realpath(DATA_DIR)
    base_prefix = base + os.sep
    escaped = False
    # 结果一般在 DATA_DIR 下; 先按相对路径找, 再按文件名兜底
    for cand in (os.path.join(DATA_DIR, safe), os.path.join(DATA_DIR, os.path.basename(safe))):
        real = os.path.realpath(cand)
        if real != base and not real.startswith(base_prefix):
            escaped = True
            continue
        if os.path.isfile(real):
            return FileResponse(real, media_type="video/mp4")
    if escaped:
        raise HTTPException(403, "非法路径")
    raise HTTPException(404, "结果视频未找到")


def _cleanup(*paths: str) -> None:
    for p in paths:
        try:
            if p and os.path.exists(p):
                os.remove(p)
        except Exception:
            pass


if __name__ == "__main__":
    import uvicorn
    print(f"[heygem-agent] 启动 :{AGENT_PORT}, HeyGem={HEYGEM_API}, DATA_DIR={DATA_DIR}", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=AGENT_PORT)
