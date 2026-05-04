"""
CosyVoice2 独立推理服务
端口: 9001
启动: 在 cosyvoice venv 中跑 `python voice-server.py`
"""
import os
import sys
import time
import uuid
import asyncio
from typing import Optional

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
COSYVOICE_DIR = r"D:\monoi-server\models\cosyvoice"
sys.path.insert(0, COSYVOICE_DIR)
sys.path.insert(0, os.path.join(COSYVOICE_DIR, "third_party", "Matcha-TTS"))

import torch
import torchaudio
import soundfile as sf
import numpy as np
import torchaudio.transforms as TAT
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel


# Monkey-patch cosyvoice.utils.file_utils.load_wav 用 soundfile 直接读
# 因为 PyTorch 2.10+ 的 torchaudio.load 改用 torchcodec，在 Windows 下装不上
def _patched_load_wav(wav, target_sr):
    speech, sample_rate = sf.read(wav, dtype="float32")
    if speech.ndim > 1:
        speech = speech.mean(axis=1)
    speech_t = torch.from_numpy(speech).unsqueeze(0)
    if sample_rate != target_sr:
        resampler = TAT.Resample(orig_freq=sample_rate, new_freq=target_sr)
        speech_t = resampler(speech_t)
    return speech_t


import cosyvoice.utils.file_utils as _file_utils  # noqa: E402
_file_utils.load_wav = _patched_load_wav

from cosyvoice.cli.cosyvoice import CosyVoice2  # noqa: E402
from cosyvoice.utils.file_utils import load_wav  # noqa: E402

app = FastAPI()

OUTPUT_DIR = os.path.join(COSYVOICE_DIR, "outputs")
PROMPTS_DIR = os.path.join(COSYVOICE_DIR, "voice_prompts")
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(PROMPTS_DIR, exist_ok=True)

DEFAULT_PROMPT_WAV = os.path.join(COSYVOICE_DIR, "asset", "zero_shot_prompt.wav")
DEFAULT_PROMPT_TEXT = "希望你以后能够做的比我还好呦。"

print("Loading CosyVoice2...", flush=True)
MODEL = CosyVoice2(
    os.path.join(COSYVOICE_DIR, "pretrained_models", "CosyVoice2-0.5B"),
    load_jit=False, load_trt=False, fp16=False,
)
print("Model loaded.", flush=True)


class SynthesizeRequest(BaseModel):
    text: str
    voice_id: Optional[str] = None
    prompt_audio_path: Optional[str] = None
    prompt_text: Optional[str] = None
    speed: float = 1.0


def resolve_prompt(req: SynthesizeRequest):
    if req.voice_id:
        wav = os.path.join(PROMPTS_DIR, f"{req.voice_id}.wav")
        txt = os.path.join(PROMPTS_DIR, f"{req.voice_id}.txt")
        if not os.path.exists(wav):
            return DEFAULT_PROMPT_WAV, DEFAULT_PROMPT_TEXT
        prompt_text = ""
        if os.path.exists(txt):
            with open(txt, "r", encoding="utf-8") as f:
                prompt_text = f.read().strip()
        return wav, prompt_text or DEFAULT_PROMPT_TEXT
    if req.prompt_audio_path and os.path.exists(req.prompt_audio_path):
        return req.prompt_audio_path, req.prompt_text or ""
    return DEFAULT_PROMPT_WAV, DEFAULT_PROMPT_TEXT


@app.get("/health")
def health():
    return {"status": "ok", "engine": "cosyvoice2"}


@app.post("/synthesize")
def synthesize(req: SynthesizeRequest):
    text = req.text.strip()
    if not text:
        raise HTTPException(400, "text 不能为空")

    prompt_wav, prompt_text = resolve_prompt(req)

    # 这版 CosyVoice2 的 frontend._extract_speech_feat 内部会 load_wav，所以传路径
    chunks = []
    for piece in MODEL.inference_zero_shot(text, prompt_text, prompt_wav, stream=False, speed=req.speed):
        chunks.append(piece["tts_speech"])
    audio = torch.concat(chunks, dim=1)

    out_name = f"{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}.wav"
    out_path = os.path.join(OUTPUT_DIR, out_name)
    # 用 soundfile 保存（避免 torchaudio.save 走 torchcodec）
    sf.write(out_path, audio.squeeze(0).cpu().numpy(), MODEL.sample_rate)

    return {"success": True, "file": out_name, "path": out_path, "duration_seconds": audio.shape[1] / MODEL.sample_rate}


@app.get("/audio/{name}")
def get_audio(name: str):
    safe = os.path.basename(name)
    path = os.path.join(OUTPUT_DIR, safe)
    if not os.path.exists(path):
        raise HTTPException(404, "audio not found")
    return FileResponse(path, media_type="audio/wav", filename=safe)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=9001)
