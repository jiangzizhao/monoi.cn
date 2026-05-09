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
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
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
    # zero_shot: 同语种克隆 (默认, 中文 → 中文)
    # cross_lingual: 跨语言克隆 (中文样本念日/韩/英 等)
    mode: str = "zero_shot"


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

    chunks = []
    if req.mode == "cross_lingual":
        # 跨语言克隆: 中文 prompt 念其他语言. 不需要 prompt_text.
        # 这版 CosyVoice2 的 frontend_cross_lingual → frontend_zero_shot → _extract_speech_feat
        # 内部还是会调 load_wav, 所以传路径就行 (跟 zero_shot 一样)
        for piece in MODEL.inference_cross_lingual(text, prompt_wav, stream=False, speed=req.speed):
            chunks.append(piece["tts_speech"])
    else:
        # 同语种 zero_shot 克隆 (默认, 中文 → 中文)
        for piece in MODEL.inference_zero_shot(text, prompt_text, prompt_wav, stream=False, speed=req.speed):
            chunks.append(piece["tts_speech"])
    audio = torch.concat(chunks, dim=1)

    out_name = f"{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}.wav"
    out_path = os.path.join(OUTPUT_DIR, out_name)
    # 用 soundfile 保存（避免 torchaudio.save 走 torchcodec）
    sf.write(out_path, audio.squeeze(0).cpu().numpy(), MODEL.sample_rate)

    return {"success": True, "file": out_name, "path": out_path, "duration_seconds": audio.shape[1] / MODEL.sample_rate}


# ============== 录音清洗（去气口 + 去重复） ==============

NARRATION_OUTPUT_DIR = os.path.join(COSYVOICE_DIR, "narration_outputs")
os.makedirs(NARRATION_OUTPUT_DIR, exist_ok=True)

_WHISPER_MODEL = None

def get_whisper():
    """懒加载 faster-whisper"""
    global _WHISPER_MODEL
    if _WHISPER_MODEL is None:
        from faster_whisper import WhisperModel
        print("Loading Whisper small (GPU)...", flush=True)
        _WHISPER_MODEL = WhisperModel("small", device="cuda", compute_type="float16")
        print("Whisper loaded.", flush=True)
    return _WHISPER_MODEL


def _ffmpeg_silence_detect(audio_path, noise_db=-30, min_silence=0.6):
    """用 ffmpeg silencedetect 找静音段，返回 [(start, end), ...]"""
    import subprocess
    import re
    proc = subprocess.run(
        ["ffmpeg", "-i", audio_path, "-af", f"silencedetect=noise={noise_db}dB:d={min_silence}", "-f", "null", "-"],
        capture_output=True, text=True
    )
    output = proc.stderr
    starts = [float(m) for m in re.findall(r"silence_start: ([\d.]+)", output)]
    ends = [float(m) for m in re.findall(r"silence_end: ([\d.]+)", output)]
    return list(zip(starts, ends))


def _detect_repeats(segments, similarity_threshold=0.7, max_gap=5.0):
    """检测口误重复段：相邻两段文本相似度高且时间近的，标记前一个为删除"""
    from difflib import SequenceMatcher
    to_remove = []
    for i in range(len(segments) - 1):
        a = segments[i]
        b = segments[i + 1]
        gap = b["start"] - a["end"]
        if gap > max_gap:
            continue
        sim = SequenceMatcher(None, a["text"].strip(), b["text"].strip()).ratio()
        if sim >= similarity_threshold and len(a["text"].strip()) >= 4:
            to_remove.append((a["start"], a["end"]))
    return to_remove


# 中文口播常见纯填充词 (没语义贡献, 可以无脑删)
_FILLER_WORDS = {
    "嗯", "啊", "呃", "哦", "诶", "欸", "哎", "唉", "咦", "哟", "呵",
    "唔", "呢", "嘿", "哈", "哇", "诶嘿", "嗯嗯", "啊啊", "呃呃",
}
# 标点 (Whisper 词级时间戳的 word 可能带标点 like "嗯,")
_FILLER_PUNCTUATION = "，。、；！？!?,.;:：~～-—_… "


def _detect_fillers(segments):
    """识别词级"嗯啊呃哦"等填充词, 返回时间区间列表"""
    intervals = []
    for seg in segments:
        for word in seg.get("words") or []:
            raw = (word.get("word") or "").strip()
            clean = raw.strip(_FILLER_PUNCTUATION)
            if not clean:
                continue
            if clean in _FILLER_WORDS:
                intervals.append((word["start"], word["end"]))
    return intervals


def _detect_word_gaps(segments, min_gap=0.4):
    """检测词与词之间的停顿 (silencedetect 兜底, 一些场景下 silencedetect 漏掉的)"""
    intervals = []
    for seg in segments:
        words = seg.get("words") or []
        for i in range(len(words) - 1):
            gap_start = words[i]["end"]
            gap_end = words[i + 1]["start"]
            if gap_end - gap_start >= min_gap:
                intervals.append((gap_start, gap_end))
    return intervals


def _ffmpeg_concat_keep(audio_path, removed_intervals, total_duration, out_path):
    """根据要删除的区间，输出剩余拼接的 wav"""
    import subprocess
    # 算出"保留段" = 全长 - removed_intervals
    removed_intervals = sorted(removed_intervals)
    keep_segments = []
    cursor = 0.0
    for s, e in removed_intervals:
        if s > cursor:
            keep_segments.append((cursor, s))
        cursor = max(cursor, e)
    if cursor < total_duration:
        keep_segments.append((cursor, total_duration))

    if not keep_segments:
        # 全删了？保底用原音频
        keep_segments = [(0, total_duration)]

    # 用 ffmpeg select filter
    select_expr = "+".join(f"between(t,{s},{e})" for s, e in keep_segments)
    proc = subprocess.run(
        ["ffmpeg", "-y", "-i", audio_path, "-af",
         f"aselect='{select_expr}',asetpts=N/SR/TB", out_path],
        capture_output=True
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg concat failed: {proc.stderr.decode('utf-8', errors='ignore')[-300:]}")
    return keep_segments


@app.post("/clean-narration")
async def clean_narration(file: UploadFile = File(...), reference_text: str = Form("")):
    """上传录音 → 去气口 + 去口误重复 → 返回清洗后的 wav"""
    import shutil
    import subprocess
    import tempfile

    job_id = f"narr_{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}"
    raw_path = os.path.join(tempfile.gettempdir(), f"{job_id}_raw")
    norm_path = os.path.join(NARRATION_OUTPUT_DIR, f"{job_id}_input.wav")
    out_path = os.path.join(NARRATION_OUTPUT_DIR, f"{job_id}_cleaned.wav")

    # 1. 保存上传文件
    with open(raw_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    # 2. 转 16kHz 单声道 wav
    proc = subprocess.run(
        ["ffmpeg", "-y", "-i", raw_path, "-ar", "16000", "-ac", "1", "-f", "wav", norm_path],
        capture_output=True, timeout=120
    )
    if proc.returncode != 0:
        raise HTTPException(400, f"音频转换失败")
    try: os.unlink(raw_path)
    except: pass

    # 3. 测原始时长
    info = sf.info(norm_path)
    orig_dur = info.duration

    # 4. Whisper 转录（词级时间戳）
    model = get_whisper()
    segments_iter, info = model.transcribe(norm_path, language="zh", beam_size=5, word_timestamps=True)
    segments = []
    for s in segments_iter:
        words = []
        if s.words:
            for w in s.words:
                words.append({"start": w.start, "end": w.end, "word": w.word})
        segments.append({"start": s.start, "end": s.end, "text": s.text, "words": words})

    full_text = "".join(s["text"] for s in segments).strip()

    # 5. 找静音 + 词间隔 + 重复 + 填充词 (作为"建议删除"提示给用户)
    silences = _ffmpeg_silence_detect(norm_path, noise_db=-25, min_silence=0.4)
    word_gaps = _detect_word_gaps(segments, min_gap=0.4)
    repeats = _detect_repeats(segments)
    fillers = _detect_fillers(segments)

    return {
        "success": True,
        "source_file": os.path.basename(norm_path),  # 原始处理后的 wav
        "audio_url_path": f"/narration/{os.path.basename(norm_path)}",
        "duration": orig_dur,
        "transcription": full_text,
        "segments": segments,  # 含 words 数组（词级时间戳）
        "suggested_removals": {
            "silences": [{"start": s, "end": e} for s, e in silences],
            "word_gaps": [{"start": s, "end": e} for s, e in word_gaps],
            "repeats": [{"start": s, "end": e} for s, e in repeats],
            "fillers": [{"start": s, "end": e} for s, e in fillers],
        },
    }


class FinalizeRequest(BaseModel):
    source_file: str  # /clean-narration 返回的 source_file
    keep_ranges: list[list[float]]  # [[start, end], ...]


@app.post("/finalize-narration")
def finalize_narration(req: FinalizeRequest):
    """根据用户选择的保留段，产出最终 wav"""
    import subprocess

    safe = os.path.basename(req.source_file)
    src_path = os.path.join(NARRATION_OUTPUT_DIR, safe)
    if not os.path.exists(src_path):
        raise HTTPException(404, "源文件不存在")
    if not req.keep_ranges:
        raise HTTPException(400, "keep_ranges 不能为空")

    out_name = f"final_{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}.wav"
    out_path = os.path.join(NARRATION_OUTPUT_DIR, out_name)

    # 用 ffmpeg aselect filter 拼接保留段
    select_expr = "+".join(f"between(t,{s},{e})" for s, e in req.keep_ranges)
    proc = subprocess.run(
        ["ffmpeg", "-y", "-i", src_path, "-af",
         f"aselect='{select_expr}',asetpts=N/SR/TB", out_path],
        capture_output=True, timeout=120
    )
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", errors="ignore")[-300:]
        raise HTTPException(500, f"ffmpeg failed: {err}")

    new_dur = sf.info(out_path).duration
    return {
        "success": True,
        "file": out_name,
        "audio_url_path": f"/narration/{out_name}",
        "duration": new_dur,
    }


@app.get("/narration/{name}")
def get_narration(name: str):
    safe = os.path.basename(name)
    path = os.path.join(NARRATION_OUTPUT_DIR, safe)
    if not os.path.exists(path):
        raise HTTPException(404, "audio not found")
    return FileResponse(path, media_type="audio/wav", filename=safe)


# ============== 口播视频剪辑 (跟音频剪辑同套逻辑, 但处理视频) ==============


@app.post("/clean-narration-video")
async def clean_narration_video(file: UploadFile = File(...)):
    """上传视频 → 提取音频 → Whisper 转录词级时间戳 → silencedetect 找气口
    返回原视频 URL + 词级 segments + 静音/重复建议删除区间
    """
    import shutil
    import subprocess
    import tempfile

    job_id = f"narrv_{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}"
    raw_path = os.path.join(tempfile.gettempdir(), f"{job_id}_raw")
    video_path = os.path.join(NARRATION_OUTPUT_DIR, f"{job_id}_input.mp4")
    audio_path = os.path.join(NARRATION_OUTPUT_DIR, f"{job_id}_input.wav")

    # 1. 保存上传文件 (任意格式: mp4/mov/avi/mkv/webm 等)
    with open(raw_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    # 2. 转 mp4 (h264_nvenc + aac, NVIDIA GPU 加速, 比 libx264 快 5-10 倍)
    #    p4 preset = 平衡速度/质量; cq 23 = 质量 (类似 libx264 -crf 23)
    proc = subprocess.run(
        ["ffmpeg", "-y", "-i", raw_path,
         "-c:v", "h264_nvenc", "-preset", "p4", "-cq", "23",
         "-c:a", "aac", "-pix_fmt", "yuv420p",
         "-movflags", "+faststart",
         video_path],
        capture_output=True, timeout=600,
    )
    if proc.returncode != 0:
        try: os.unlink(raw_path)
        except: pass
        err = proc.stderr.decode("utf-8", errors="ignore")[-300:]
        raise HTTPException(400, f"视频转换失败: {err}")

    # 3. 提取音频 16kHz mono wav (给 Whisper 用)
    proc = subprocess.run(
        ["ffmpeg", "-y", "-i", raw_path, "-vn", "-ar", "16000", "-ac", "1", "-f", "wav", audio_path],
        capture_output=True, timeout=300,
    )
    try: os.unlink(raw_path)
    except: pass
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", errors="ignore")[-300:]
        raise HTTPException(400, f"音频提取失败: {err}")

    # 4. 测时长 (从音频测,跟视频对齐)
    info = sf.info(audio_path)
    orig_dur = info.duration

    # 5. Whisper 转录 (词级)
    model = get_whisper()
    segments_iter, _ = model.transcribe(audio_path, language="zh", beam_size=5, word_timestamps=True)
    segments = []
    for s in segments_iter:
        words = []
        if s.words:
            for w in s.words:
                words.append({"start": w.start, "end": w.end, "word": w.word})
        segments.append({"start": s.start, "end": s.end, "text": s.text, "words": words})

    full_text = "".join(s["text"] for s in segments).strip()

    # 6. 静音 + 词间隔 + 重复 + 填充词 (建议删除)
    silences = _ffmpeg_silence_detect(audio_path, noise_db=-25, min_silence=0.4)
    word_gaps = _detect_word_gaps(segments, min_gap=0.4)
    repeats = _detect_repeats(segments)
    fillers = _detect_fillers(segments)

    # 清理音频中转件 (前端只用 video, 不需要这个 wav)
    try: os.unlink(audio_path)
    except: pass

    return {
        "success": True,
        "source_file": os.path.basename(video_path),
        "video_url_path": f"/narration-video/{os.path.basename(video_path)}",
        "duration": orig_dur,
        "transcription": full_text,
        "segments": segments,
        "suggested_removals": {
            "silences": [{"start": s, "end": e} for s, e in silences],
            "word_gaps": [{"start": s, "end": e} for s, e in word_gaps],
            "repeats": [{"start": s, "end": e} for s, e in repeats],
            "fillers": [{"start": s, "end": e} for s, e in fillers],
        },
    }


class FinalizeVideoRequest(BaseModel):
    source_file: str             # /clean-narration-video 返回的 source_file
    keep_ranges: list[list[float]]  # [[start, end], ...]


@app.post("/finalize-narration-video")
def finalize_narration_video(req: FinalizeVideoRequest):
    """根据用户保留段, ffmpeg select+aselect 切视频. 重编码 (libx264) 保证段间过渡平滑."""
    import subprocess

    safe = os.path.basename(req.source_file)
    src_path = os.path.join(NARRATION_OUTPUT_DIR, safe)
    if not os.path.exists(src_path):
        raise HTTPException(404, "源视频不存在")
    if not req.keep_ranges:
        raise HTTPException(400, "keep_ranges 不能为空")

    out_name = f"final_{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}.mp4"
    out_path = os.path.join(NARRATION_OUTPUT_DIR, out_name)

    # ffmpeg select + aselect 同步切视频和音频, h264_nvenc GPU 加速重编码
    # 8 分钟视频 ffmpeg 切片从 1-2 分钟 → 10-15 秒
    select_expr = "+".join(f"between(t,{s},{e})" for s, e in req.keep_ranges)
    proc = subprocess.run(
        ["ffmpeg", "-y", "-i", src_path,
         "-vf", f"select='{select_expr}',setpts=N/FRAME_RATE/TB",
         "-af", f"aselect='{select_expr}',asetpts=N/SR/TB",
         "-c:v", "h264_nvenc", "-preset", "p4", "-cq", "23",
         "-c:a", "aac", "-pix_fmt", "yuv420p",
         "-movflags", "+faststart",
         out_path],
        capture_output=True, timeout=900,
    )
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", errors="ignore")[-500:]
        raise HTTPException(500, f"ffmpeg 剪辑失败: {err}")

    # ffprobe 取新视频时长
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", out_path],
        capture_output=True, text=True,
    )
    new_dur = 0.0
    if probe.returncode == 0:
        try: new_dur = float(probe.stdout.strip())
        except ValueError: pass

    return {
        "success": True,
        "file": out_name,
        "video_url_path": f"/narration-video/{out_name}",
        "duration": new_dur,
    }


@app.get("/narration-video/{name}")
def get_narration_video(name: str):
    safe = os.path.basename(name)
    path = os.path.join(NARRATION_OUTPUT_DIR, safe)
    if not os.path.exists(path):
        raise HTTPException(404, "video not found")
    return FileResponse(path, media_type="video/mp4", filename=safe)


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
