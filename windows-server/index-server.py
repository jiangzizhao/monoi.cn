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

# 离线模式: 模型本地已下载, 不再每次启动联网验证 (国内访问 huggingface SSL 不稳,
# 默认会重试 5 次浪费 20+ 秒). 必须在 import torch/transformers 之前设.
os.environ.setdefault('HF_HUB_OFFLINE', '1')
os.environ.setdefault('TRANSFORMERS_OFFLINE', '1')

INDEX_DIR = r"D:\monoi-server\models\index-tts"
sys.path.insert(0, INDEX_DIR)

import torch
import soundfile as sf
import numpy as np
import torchaudio
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel


# Monkey-patch torchaudio.save 用 soundfile，绕开新 PyTorch 的 torchcodec 依赖
def _patched_save(uri, src, sample_rate, *args, **kwargs):
    arr = src.detach().cpu().numpy() if hasattr(src, "detach") else (src.cpu().numpy() if hasattr(src, "cpu") else src)
    if hasattr(arr, "ndim") and arr.ndim > 1:
        if arr.shape[0] == 1:
            arr = arr.squeeze(0)
        elif arr.shape[0] == 2:
            arr = arr.T  # (frames, 2)
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


# CUDA assert / device-side error 一旦发生整个进程的 GPU 状态就废了 (PyTorch 文档明确说必须重启进程).
# 检测到这类错误就主动退出, 由 .bat 循环脚本拉起新进程, 实现自愈.
@app.exception_handler(Exception)
async def _cuda_error_recovery(request, exc):
    err_str = str(exc)
    is_cuda_dead = (
        "CUDA error" in err_str
        or "device-side assert" in err_str
        or "CUDA out of memory" in err_str
        or "CUDA kernel" in err_str
        or "cudaErrorAssert" in err_str
    )
    if is_cuda_dead:
        import threading as _th
        import time as _t

        def _shutdown():
            _t.sleep(2)  # 给当前响应一点时间送出去
            print(f"[FATAL] GPU 状态异常,主动退出让 .bat 重启: {err_str[:200]}", flush=True)
            os._exit(1)

        _th.Thread(target=_shutdown, daemon=True).start()
        from fastapi.responses import JSONResponse
        return JSONResponse(
            {"detail": f"GPU 状态异常,服务即将自动重启: {err_str[:200]}"},
            status_code=503,
        )
    # 其他错误按原 HTTPException 走 (FastAPI 自己处理)
    if isinstance(exc, HTTPException):
        from fastapi.responses import JSONResponse
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
    raise exc


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

    import traceback as _tb
    result = None
    try:
        # 尝试 keyword 参数（IndexTTS-2 标准调用）
        try:
            result = MODEL.infer(spk_audio_prompt=prompt_path, text=text, output_path=out_path)
        except TypeError:
            # 回退到位置参数
            result = MODEL.infer(prompt_path, text, out_path)
    except Exception as e:
        _tb.print_exc()
        raise HTTPException(500, f"IndexTTS 合成失败: {type(e).__name__}: {e}")

    # 如果 infer 没有写入文件但返回了 audio 数据，自己保存
    if not os.path.exists(out_path) and result is not None:
        try:
            if isinstance(result, np.ndarray):
                sf.write(out_path, result, 22050)
            elif isinstance(result, tuple) and len(result) == 2:
                # (audio, sr) 或 (sr, audio) 都试试
                a, b = result
                if hasattr(a, "shape"):
                    sf.write(out_path, a, b if isinstance(b, int) else 22050)
                else:
                    sf.write(out_path, b, a if isinstance(a, int) else 22050)
            elif hasattr(result, "shape"):  # tensor
                arr = result.cpu().numpy() if hasattr(result, "cpu") else result
                if arr.ndim > 1:
                    arr = arr.squeeze()
                sf.write(out_path, arr, 22050)
        except Exception as e:
            _tb.print_exc()
            raise HTTPException(500, f"保存音频失败: {e}, result type: {type(result)}")

    if not os.path.exists(out_path):
        raise HTTPException(500, f"合成完成但找不到输出文件，result type: {type(result)}")

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
