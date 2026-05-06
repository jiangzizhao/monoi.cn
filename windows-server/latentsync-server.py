"""
LatentSync 数字人对口型推理服务
端口: 9003
启动: 在 latentsync venv 中跑 `python latentsync-server.py`
"""
import os
import sys
import time
import uuid
import shutil
import subprocess
from typing import Optional

LATENTSYNC_DIR = r"D:\monoi-server\models\LatentSync"
sys.path.insert(0, LATENTSYNC_DIR)

import torch
import soundfile as sf
import numpy as np
import torchaudio
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel


# Monkey-patch torchaudio.save/load for Windows (避免 torchcodec 依赖)
def _patched_save(uri, src, sample_rate, *args, **kwargs):
    arr = src.detach().cpu().numpy() if hasattr(src, "detach") else (src.cpu().numpy() if hasattr(src, "cpu") else src)
    if hasattr(arr, "ndim") and arr.ndim > 1:
        if arr.shape[0] == 1:
            arr = arr.squeeze(0)
        elif arr.shape[0] == 2:
            arr = arr.T
        else:
            arr = arr.squeeze()
    sf.write(str(uri), arr, sample_rate)


def _patched_load(uri, *args, **kwargs):
    audio, sr = sf.read(str(uri), dtype="float32")
    if audio.ndim == 1:
        audio = audio[np.newaxis, :]
    else:
        audio = audio.T
    return torch.from_numpy(audio), sr


torchaudio.save = _patched_save
torchaudio.load = _patched_load


OUTPUT_DIR = os.path.join(LATENTSYNC_DIR, "outputs")
INPUT_DIR = os.path.join(LATENTSYNC_DIR, "inputs")
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(INPUT_DIR, exist_ok=True)


app = FastAPI()


@app.get("/health")
def health():
    return {"status": "ok", "engine": "latentsync"}


@app.post("/lipsync")
async def lipsync(
    image: UploadFile = File(...),     # 形象（图或视频）
    audio: UploadFile = File(...),     # 音频
    inference_steps: int = Form(20),
    guidance_scale: float = Form(1.0),
):
    """形象 + 音频 → 对口型视频"""
    job_id = f"lipsync_{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}"
    img_path = os.path.join(INPUT_DIR, f"{job_id}_input.{image.filename.split('.')[-1]}")
    aud_path = os.path.join(INPUT_DIR, f"{job_id}_input.{audio.filename.split('.')[-1]}")
    out_path = os.path.join(OUTPUT_DIR, f"{job_id}.mp4")

    # 保存上传文件
    with open(img_path, "wb") as f:
        shutil.copyfileobj(image.file, f)
    with open(aud_path, "wb") as f:
        shutil.copyfileobj(audio.file, f)

    # 调用 LatentSync 推理（用官方 inference 脚本）
    cmd = [
        sys.executable,
        os.path.join(LATENTSYNC_DIR, "scripts", "inference.py"),
        "--unet_config_path", os.path.join(LATENTSYNC_DIR, "configs/unet/stage2.yaml"),
        "--inference_ckpt_path", os.path.join(LATENTSYNC_DIR, "checkpoints/latentsync_unet.pt"),
        "--video_path", img_path,
        "--audio_path", aud_path,
        "--video_out_path", out_path,
        "--inference_steps", str(inference_steps),
        "--guidance_scale", str(guidance_scale),
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, timeout=600, cwd=LATENTSYNC_DIR)
    except subprocess.TimeoutExpired:
        raise HTTPException(504, "推理超时（>10 分钟）")
    if result.returncode != 0:
        err = result.stderr.decode("utf-8", errors="ignore")[-500:]
        raise HTTPException(500, f"LatentSync 推理失败: {err}")

    if not os.path.exists(out_path):
        raise HTTPException(500, "推理完成但找不到输出文件")

    return {
        "success": True,
        "file": os.path.basename(out_path),
        "path": out_path,
        "video_url_path": f"/lipsync-output/{os.path.basename(out_path)}",
    }


@app.get("/lipsync-output/{name}")
def get_output(name: str):
    safe = os.path.basename(name)
    path = os.path.join(OUTPUT_DIR, safe)
    if not os.path.exists(path):
        raise HTTPException(404, "video not found")
    return FileResponse(path, media_type="video/mp4", filename=safe)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=9003)
