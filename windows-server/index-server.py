"""
IndexTTS-2 独立推理服务（用户克隆专用）
端口: 9002
启动: 在 IndexTTS venv 里跑 `python index-server.py`
"""
import os
import sys
import time
import uuid
from typing import Optional

INDEX_DIR = r"D:\monoi-server\models\index-tts"
sys.path.insert(0, INDEX_DIR)

import torch
import soundfile as sf
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

# IndexTTS-2 推理类（按官方 README 调整）
try:
    from indextts.infer_v2 import IndexTTS2 as _Engine
    print("Using IndexTTS-2 (v2)", flush=True)
except ImportError:
    from indextts.infer import IndexTTS as _Engine
    print("Using IndexTTS (v1.5)", flush=True)


CHECKPOINTS_DIR = os.path.join(INDEX_DIR, "checkpoints")
OUTPUT_DIR = os.path.join(INDEX_DIR, "outputs")
PROMPTS_DIR = r"D:\monoi-server\models\cosyvoice\voice_prompts"  # 复用同一目录
os.makedirs(OUTPUT_DIR, exist_ok=True)

print("Loading IndexTTS model...", flush=True)
MODEL = _Engine(model_dir=CHECKPOINTS_DIR, cfg_path=os.path.join(CHECKPOINTS_DIR, "config.yaml"))
print("Model loaded.", flush=True)

app = FastAPI()


class SynthesizeRequest(BaseModel):
    text: str
    voice_id: Optional[str] = None
    prompt_audio_path: Optional[str] = None
    speed: float = 1.0


@app.get("/health")
def health():
    return {"status": "ok", "engine": "indextts"}


@app.post("/synthesize")
def synthesize(req: SynthesizeRequest):
    text = req.text.strip()
    if not text:
        raise HTTPException(400, "text 不能为空")

    # 找 prompt 音频
    prompt_path = req.prompt_audio_path
    if not prompt_path and req.voice_id:
        prompt_path = os.path.join(PROMPTS_DIR, f"{req.voice_id}.wav")
    if not prompt_path or not os.path.exists(prompt_path):
        raise HTTPException(400, f"找不到 prompt 音频: {prompt_path}")

    out_name = f"{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}.wav"
    out_path = os.path.join(OUTPUT_DIR, out_name)

    try:
        # IndexTTS API：infer(audio_prompt, text, output_path)
        MODEL.infer(prompt_path, text, out_path)
    except Exception as e:
        raise HTTPException(500, f"IndexTTS 合成失败: {e}")

    if not os.path.exists(out_path):
        raise HTTPException(500, "合成完成但找不到输出文件")

    # 读取时长
    try:
        info = sf.info(out_path)
        duration = info.duration
    except Exception:
        duration = 0

    return {"success": True, "file": out_name, "path": out_path, "duration_seconds": duration}


@app.get("/audio/{name}")
def get_audio(name: str):
    safe = os.path.basename(name)
    path = os.path.join(OUTPUT_DIR, safe)
    if not os.path.exists(path):
        raise HTTPException(404, "audio not found")
    return FileResponse(path, media_type="audio/wav", filename=safe)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=9002)
