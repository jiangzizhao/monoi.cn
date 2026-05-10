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
_T2S_CONVERTER = None  # 繁体 → 简体 转换器 (zhconv 懒加载, 没装就跳过)

def get_whisper():
    """懒加载 faster-whisper"""
    global _WHISPER_MODEL
    if _WHISPER_MODEL is None:
        from faster_whisper import WhisperModel
        print("Loading Whisper small (GPU)...", flush=True)
        _WHISPER_MODEL = WhisperModel("small", device="cuda", compute_type="float16")
        print("Whisper loaded.", flush=True)
    return _WHISPER_MODEL


def _to_simplified(text):
    """繁体转简体. zhconv 没装就原样返回 (Whisper 默认可能输出繁体)"""
    if not text:
        return text
    global _T2S_CONVERTER
    if _T2S_CONVERTER is False:
        return text  # 之前 import 失败过, 不再尝试
    if _T2S_CONVERTER is None:
        try:
            from zhconv import convert
            _T2S_CONVERTER = convert
        except ImportError:
            print("[zhconv 未安装, 转录结果保持原始繁简]", flush=True)
            _T2S_CONVERTER = False
            return text
    try:
        return _T2S_CONVERTER(text, "zh-cn")
    except Exception:
        return text


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


def _detect_repeats(segments, similarity_threshold=0.6, max_gap=8.0):
    """检测口误重复: 相邻段文本相似度高 → 标记前一个为删除.
    阈值放宽 (70% → 60%, 5s → 8s) + 短文本也算 (3+ 字, 之前要 4+)"""
    from difflib import SequenceMatcher
    to_remove = []
    for i in range(len(segments) - 1):
        a = segments[i]
        b = segments[i + 1]
        gap = b["start"] - a["end"]
        if gap > max_gap:
            continue
        ta = a["text"].strip().rstrip("，。、；！？!?,.;:")
        tb = b["text"].strip().rstrip("，。、；！？!?,.;:")
        if len(ta) < 3:
            continue
        sim = SequenceMatcher(None, ta, tb).ratio()
        if sim >= similarity_threshold:
            to_remove.append((a["start"], a["end"]))
        # 包含关系: 后段重新念了前段一部分 (前段是后段的子串或反之)
        elif (ta in tb or tb in ta) and min(len(ta), len(tb)) >= 3:
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
    """识别词级"嗯啊呃哦"等填充词. 跳过开头第一个 + 结尾最后一个词
    (用户反馈: "把开头或者结尾的字给去掉了", 边界保护避免误删开场招呼/收尾)"""
    intervals = []
    # 摊平所有词
    all_words = []
    for seg in segments:
        for word in seg.get("words") or []:
            all_words.append(word)
    if len(all_words) < 3:
        return intervals  # 太短, 不识别
    # 跳过第一个和最后一个词 (保护边界)
    for i in range(1, len(all_words) - 1):
        word = all_words[i]
        raw = (word.get("word") or "").strip()
        clean = raw.strip(_FILLER_PUNCTUATION)
        if not clean:
            continue
        if clean in _FILLER_WORDS:
            intervals.append((word["start"], word["end"]))
    return intervals


def _detect_word_gaps(segments, min_gap=0.4):
    """检测词与词之间的停顿. 跳过开头/结尾相邻的 gap (保护边界)"""
    intervals = []
    all_words = []
    for seg in segments:
        for word in seg.get("words") or []:
            all_words.append(word)
    if len(all_words) < 3:
        return intervals
    # 第 1 对 (开头) 和 最后 1 对 (结尾) 不识别
    for i in range(1, len(all_words) - 2):
        gap_start = all_words[i]["end"]
        gap_end = all_words[i + 1]["start"]
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
                words.append({"start": w.start, "end": w.end, "word": _to_simplified(w.word)})
        segments.append({"start": s.start, "end": s.end, "text": _to_simplified(s.text), "words": words})

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

    # 2. 转 mp4 (-hwaccel cuda 解码 H.265 .MOV; h264_nvenc 编码; preset p2 速度优先)
    #    iPhone 录的 .MOV 是 HEVC, 必须 GPU 解码, 否则 CPU 解 H.265 4K 巨慢甚至卡死
    proc = subprocess.run(
        ["ffmpeg", "-y", "-hwaccel", "cuda", "-i", raw_path,
         "-c:v", "h264_nvenc", "-preset", "p2", "-cq", "26",
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

    # 3. 提取音频 16kHz mono wav (给 Whisper 用; 不用解视频, 不需要 hwaccel)
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

    # 5. Whisper 转录 (词级, 输出转简体)
    model = get_whisper()
    segments_iter, _ = model.transcribe(audio_path, language="zh", beam_size=5, word_timestamps=True)
    segments = []
    for s in segments_iter:
        words = []
        if s.words:
            for w in s.words:
                words.append({"start": w.start, "end": w.end, "word": _to_simplified(w.word)})
        segments.append({"start": s.start, "end": s.end, "text": _to_simplified(s.text), "words": words})

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

    # ffmpeg select + aselect 同步切视频和音频; -hwaccel cuda 解码 + nvenc 编码
    select_expr = "+".join(f"between(t,{s},{e})" for s, e in req.keep_ranges)
    proc = subprocess.run(
        ["ffmpeg", "-y", "-hwaccel", "cuda", "-i", src_path,
         "-vf", f"select='{select_expr}',setpts=N/FRAME_RATE/TB",
         "-af", f"aselect='{select_expr}',asetpts=N/SR/TB",
         "-c:v", "h264_nvenc", "-preset", "p2", "-cq", "26",
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


# ============== 口播视频剪辑 OSS 模式 (浏览器直传 OSS, 绕开 NATAPP) ==============


class CleanVideoOssRequest(BaseModel):
    oss_key: str
    filename: str = "video.mp4"


@app.post("/clean-narration-video-oss")
def clean_narration_video_oss(req: CleanVideoOssRequest):
    """OSS 模式: 浏览器已直传到 OSS, 这里从 OSS 拉源视频做转码 + 转录,
    再把转码后的视频回传 OSS 给前端播放. 流程跟 /clean-narration-video 一样,
    只是 IO 换成 OSS."""
    import shutil
    import subprocess
    import tempfile
    from oss_helper import oss_download, oss_upload, oss_sign_get, oss_delete

    job_id = f"narrv_{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}"
    raw_path = os.path.join(tempfile.gettempdir(), f"{job_id}_raw")
    video_path = os.path.join(NARRATION_OUTPUT_DIR, f"{job_id}_input.mp4")
    audio_path = os.path.join(NARRATION_OUTPUT_DIR, f"{job_id}_input.wav")

    # 1. 从 OSS 下载原始视频
    try:
        oss_download(req.oss_key, raw_path)
    except Exception as e:
        raise HTTPException(400, f"OSS 下载失败: {e}")

    # 2. 转 mp4 (-hwaccel cuda 解 H.265, nvenc 编, p2 速度优先)
    proc = subprocess.run(
        ["ffmpeg", "-y", "-hwaccel", "cuda", "-i", raw_path,
         "-c:v", "h264_nvenc", "-preset", "p2", "-cq", "26",
         "-c:a", "aac", "-pix_fmt", "yuv420p",
         "-movflags", "+faststart",
         video_path],
        capture_output=True, timeout=600,
    )
    if proc.returncode != 0:
        try: os.unlink(raw_path)
        except: pass
        oss_delete(req.oss_key)
        err = proc.stderr.decode("utf-8", errors="ignore")[-300:]
        raise HTTPException(400, f"视频转换失败: {err}")

    # 3. 提取音频 16kHz mono wav
    proc = subprocess.run(
        ["ffmpeg", "-y", "-i", raw_path, "-vn", "-ar", "16000", "-ac", "1", "-f", "wav", audio_path],
        capture_output=True, timeout=300,
    )
    try: os.unlink(raw_path)
    except: pass
    if proc.returncode != 0:
        oss_delete(req.oss_key)
        err = proc.stderr.decode("utf-8", errors="ignore")[-300:]
        raise HTTPException(400, f"音频提取失败: {err}")

    info = sf.info(audio_path)
    orig_dur = info.duration

    # 4. Whisper 转录
    model = get_whisper()
    segments_iter, _ = model.transcribe(audio_path, language="zh", beam_size=5, word_timestamps=True)
    segments = []
    for s in segments_iter:
        words = []
        if s.words:
            for w in s.words:
                words.append({"start": w.start, "end": w.end, "word": _to_simplified(w.word)})
        segments.append({"start": s.start, "end": s.end, "text": _to_simplified(s.text), "words": words})
    full_text = "".join(s["text"] for s in segments).strip()

    # 5. 检测气口/重复/填充词
    silences = _ffmpeg_silence_detect(audio_path, noise_db=-25, min_silence=0.4)
    word_gaps = _detect_word_gaps(segments, min_gap=0.4)
    repeats = _detect_repeats(segments)
    fillers = _detect_fillers(segments)

    try: os.unlink(audio_path)
    except: pass

    # 6. 把转码后的视频回传 OSS (前端播放 + finalize 阶段会用)
    source_oss_key = f"sources/{job_id}.mp4"
    try:
        oss_upload(source_oss_key, video_path, content_type="video/mp4")
    except Exception as e:
        oss_delete(req.oss_key)
        raise HTTPException(500, f"OSS 上传失败: {e}")
    finally:
        # 不管成功失败, 本地转码后的文件不需要保留 (finalize 阶段从 OSS 重拉)
        try: os.unlink(video_path)
        except: pass

    # 7. 删 OSS 上的原始上传 (短暂中转, 用完即弃)
    oss_delete(req.oss_key)

    # 8. 给前端签个 GET URL (6 小时有效, 够用户编辑)
    video_url = oss_sign_get(source_oss_key, expires=6 * 3600)

    return {
        "success": True,
        "source_oss_key": source_oss_key,  # finalize 阶段回传这个 key
        "video_url": video_url,             # 签名 GET URL, 浏览器直接播
        "video_url_full": video_url,        # 兼容前端 (旧字段名)
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


class FinalizeVideoOssRequest(BaseModel):
    source_oss_key: str
    keep_ranges: list[list[float]]


@app.post("/finalize-narration-video-oss")
def finalize_narration_video_oss(req: FinalizeVideoOssRequest):
    """OSS 模式: 从 OSS 拉源视频 (clean 阶段保存的), 切完上传 OSS 输出, 返回签名 GET URL."""
    import subprocess
    import tempfile
    from oss_helper import oss_download, oss_upload, oss_sign_get, oss_delete

    if not req.keep_ranges:
        raise HTTPException(400, "keep_ranges 不能为空")

    job_id = f"final_{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}"
    src_path = os.path.join(tempfile.gettempdir(), f"{job_id}_src.mp4")
    out_path = os.path.join(tempfile.gettempdir(), f"{job_id}_out.mp4")

    # 1. 从 OSS 下载源视频
    try:
        oss_download(req.source_oss_key, src_path)
    except Exception as e:
        raise HTTPException(400, f"OSS 下载失败: {e}")

    # 2. ffmpeg select + aselect 切; -hwaccel cuda 解 H.265, nvenc 编
    select_expr = "+".join(f"between(t,{s},{e})" for s, e in req.keep_ranges)
    proc = subprocess.run(
        ["ffmpeg", "-y", "-hwaccel", "cuda", "-i", src_path,
         "-vf", f"select='{select_expr}',setpts=N/FRAME_RATE/TB",
         "-af", f"aselect='{select_expr}',asetpts=N/SR/TB",
         "-c:v", "h264_nvenc", "-preset", "p2", "-cq", "26",
         "-c:a", "aac", "-pix_fmt", "yuv420p",
         "-movflags", "+faststart",
         out_path],
        capture_output=True, timeout=900,
    )
    try: os.unlink(src_path)
    except: pass
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", errors="ignore")[-500:]
        raise HTTPException(500, f"ffmpeg 剪辑失败: {err}")

    # 3. ffprobe 取时长
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", out_path],
        capture_output=True, text=True,
    )
    new_dur = 0.0
    if probe.returncode == 0:
        try: new_dur = float(probe.stdout.strip())
        except ValueError: pass

    # 4. 输出上传 OSS
    out_oss_key = f"outputs/{job_id}.mp4"
    try:
        oss_upload(out_oss_key, out_path, content_type="video/mp4")
    except Exception as e:
        raise HTTPException(500, f"OSS 上传失败: {e}")
    finally:
        try: os.unlink(out_path)
        except: pass

    # 5. 删源 OSS (用完即弃, lifecycle 也会兜底)
    oss_delete(req.source_oss_key)

    # 6. 签 GET URL 返回
    video_url = oss_sign_get(out_oss_key, expires=6 * 3600)

    return {
        "success": True,
        "output_oss_key": out_oss_key,
        "video_url": video_url,
        "video_url_full": video_url,
        "duration": new_dur,
    }


@app.get("/audio/{name}")
def get_audio(name: str):
    safe = os.path.basename(name)
    path = os.path.join(OUTPUT_DIR, safe)
    if not os.path.exists(path):
        raise HTTPException(404, "audio not found")
    return FileResponse(path, media_type="audio/wav", filename=safe)


# ============== 一键合成: 口播 + 多镜 b-roll + PIP overlay → 成品 mp4 ==============


class ComposeAsset(BaseModel):
    url: str                       # 公网 URL (Pexels/Pixabay) 或拼出来的标识 (upload 用 oss_key 走另一条路)
    oss_key: Optional[str] = None  # upload 类型走 OSS 下载
    duration: float                # 素材原长


class ComposeShot(BaseModel):
    start: float                   # 在剪辑后口播视频里的时间 (秒)
    end: float
    assets: list[ComposeAsset]     # 这镜选的素材 (按显示顺序), 时长平均切; 空列表 = 用原口播画面


class ComposePipConfig(BaseModel):
    enabled: bool                  # shape == 'none' 时为 False
    shape: str = 'rounded'         # 'circle' / 'rounded'
    pos: str = 'bl'                # 'tl' / 'tr' / 'bl' / 'br' / 'center'
    size: str = 'M'                # 'S' / 'M' / 'L'
    face_y: str = 'top'            # 'top' / 'center' / 'bottom'


class ComposeRequest(BaseModel):
    narration_oss_key: str         # 剪辑后口播视频 OSS key (sources/...)
    shots: list[ComposeShot]
    pip: ComposePipConfig
    output_ratio: str = '9:16'     # '9:16' / '16:9' / '1:1'
    bgm_oss_key: Optional[str] = None    # BGM (用户自传, 无版权), 不传就没 BGM
    bgm_volume: float = 0.3              # BGM 相对口播的音量 (0-1, 默认 30%)


# 输出尺寸映射 (1080p 等级)
_OUTPUT_DIMS = {'9:16': (1080, 1920), '16:9': (1920, 1080), '1:1': (1080, 1080)}
_PIP_SIZE_RATIO = {'S': 0.20, 'M': 0.25, 'L': 0.33}
_FACE_Y_FRAC = {'top': 0.2, 'center': 0.5, 'bottom': 0.8}


@app.post("/compose-footage")
def compose_footage(req: ComposeRequest):
    """合成: 拉口播 + 所有 b-roll → ffmpeg 拼接 + PIP overlay → 上传输出 → 返签名 URL"""
    import shutil
    import subprocess
    import tempfile
    import urllib.request
    from oss_helper import oss_download, oss_upload, oss_sign_get, oss_delete

    if not req.shots:
        raise HTTPException(400, 'shots 不能为空')
    if req.output_ratio not in _OUTPUT_DIMS:
        raise HTTPException(400, f'无效 output_ratio: {req.output_ratio}')

    W, H = _OUTPUT_DIMS[req.output_ratio]
    job_id = f"compose_{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}"
    work_dir = os.path.join(tempfile.gettempdir(), job_id)
    os.makedirs(work_dir, exist_ok=True)

    try:
        # 1. 下载口播视频 (从 OSS)
        narration_path = os.path.join(work_dir, 'narration.mp4')
        try:
            oss_download(req.narration_oss_key, narration_path)
        except Exception as e:
            err_str = str(e)
            if 'NoSuchKey' in err_str or '404' in err_str:
                raise HTTPException(410, '口播视频文件已过期 (超过 1 天 OSS 自动清理), 请回到口播剪辑重新生成一遍.')
            raise HTTPException(400, f'OSS 下载口播失败: {err_str[:200]}')

        # 2. 收集所有素材 + 下载. 用 (asset_idx, sub_idx) 去重 (同一素材多镜共用)
        # 简化: 每镜每素材独立下载 (即使 URL 重复, 占用一点空间, 但 ffmpeg 命令构造简单)
        asset_files: dict[tuple[int, int], str] = {}  # (shot_idx, asset_idx_in_shot) -> local path
        for si, shot in enumerate(req.shots):
            for ai, asset in enumerate(shot.assets):
                local = os.path.join(work_dir, f'asset_{si}_{ai}.mp4')
                try:
                    if asset.oss_key:
                        oss_download(asset.oss_key, local)
                    else:
                        # 公网 URL (Pexels/Pixabay) — 必须带浏览器 UA, 否则 403 Forbidden
                        ureq = urllib.request.Request(asset.url, headers={
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Referer': 'https://www.pexels.com/' if 'pexels' in asset.url else 'https://pixabay.com/',
                        })
                        with urllib.request.urlopen(ureq, timeout=120) as resp, open(local, 'wb') as f:
                            shutil.copyfileobj(resp, f)
                    asset_files[(si, ai)] = local
                except Exception as e:
                    print(f"[compose] asset {si}/{ai} 下载失败: {e}", flush=True)
                    # 失败的镜头让 ffmpeg fallback 用口播画面 (跟"没素材"一样处理)

        # 3. 构造 ffmpeg filter_complex
        # 输入: 0=narration, 1..N = 所有素材 (按出现顺序)
        ff_inputs = ['-i', narration_path]
        input_idx_map: dict[tuple[int, int], int] = {}
        next_input = 1
        for si, shot in enumerate(req.shots):
            for ai in range(len(shot.assets)):
                if (si, ai) in asset_files:
                    ff_inputs.extend(['-i', asset_files[(si, ai)]])
                    input_idx_map[(si, ai)] = next_input
                    next_input += 1

        # 先算 [0:v] 被消费几次: 没素材的镜头数 + (PIP 时 +1)
        # ffmpeg 要求同一个流多次消费时必须 split, 否则 "Filter ... has an unconnected output"
        narration_v_uses = 0
        for si, shot in enumerate(req.shots):
            usable = [ai for ai in range(len(shot.assets)) if (si, ai) in asset_files]
            if not usable:
                narration_v_uses += 1
        any_broll = any((si, ai) in asset_files for si in range(len(req.shots)) for ai in range(len(req.shots[si].assets)))
        if req.pip.enabled and any_broll:
            narration_v_uses += 1

        filter_parts: list[str] = []
        # narration video 流的别名池
        narration_v_pool: list[str] = []
        if narration_v_uses == 0:
            pass  # 不用 [0:v]
        elif narration_v_uses == 1:
            narration_v_pool = ['0:v']  # 直接用, 不 split
        else:
            split_labels = [f'narrv{i}' for i in range(narration_v_uses)]
            narration_v_pool = split_labels[:]
            filter_parts.append(f"[0:v]split={narration_v_uses}" + ''.join(f'[{l}]' for l in split_labels))

        def take_narration_v():
            return narration_v_pool.pop(0) if narration_v_pool else '0:v'

        # 主轨: 每镜按顺序拼 (有素材用素材, 没素材或失败用口播原画面那段)
        main_segments: list[str] = []
        seg_label_idx = 0

        for si, shot in enumerate(req.shots):
            shot_dur = max(0.1, shot.end - shot.start)
            usable_assets = [(ai, shot.assets[ai]) for ai in range(len(shot.assets)) if (si, ai) in asset_files]

            if not usable_assets:
                lbl = f'mseg{seg_label_idx}'
                src = take_narration_v()
                filter_parts.append(
                    f"[{src}]trim={shot.start}:{shot.end},setpts=PTS-STARTPTS,"
                    f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H}[{lbl}]"
                )
                main_segments.append(lbl)
                seg_label_idx += 1
            else:
                slice_dur = shot_dur / len(usable_assets)
                for ai, asset in usable_assets:
                    inp = input_idx_map[(si, ai)]
                    take_dur = min(slice_dur, max(0.5, asset.duration))
                    lbl = f'mseg{seg_label_idx}'
                    filter_parts.append(
                        f"[{inp}:v]trim=0:{take_dur:.3f},setpts=PTS-STARTPTS,"
                        f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H}[{lbl}]"
                    )
                    main_segments.append(lbl)
                    seg_label_idx += 1

        # concat 所有主段
        concat_inputs = ''.join(f'[{l}]' for l in main_segments)
        filter_parts.append(f"{concat_inputs}concat=n={len(main_segments)}:v=1:a=0[main]")

        # PIP overlay (如果开启 + 至少 1 镜有 b-roll)
        final_v_label = 'main'
        has_any_broll = any((si, ai) in asset_files for si in range(len(req.shots)) for ai in range(len(req.shots[si].assets)))
        if req.pip.enabled and has_any_broll:
            pip_size = _PIP_SIZE_RATIO.get(req.pip.size, 0.25)
            pip_w = int(W * pip_size)
            pip_h = pip_w if req.pip.shape == 'circle' else int(pip_w * 9 / 16)
            face_frac = _FACE_Y_FRAC.get(req.pip.face_y, 0.2)
            pip_src = take_narration_v()
            pip_filter = (
                f"[{pip_src}]scale={pip_w}:-2:force_original_aspect_ratio=increase"
            )
            # 圆形蒙版: geq 生成圆形 alpha, 跟 PIP 合成
            if req.pip.shape == 'circle':
                pip_filter += (
                    f",crop={pip_w}:{pip_w}:0:'(in_h-{pip_w})*{face_frac}',"
                    f"format=yuva420p,"
                    f"geq=lum='p(X,Y)':a='if(lt(pow(X-{pip_w}/2,2)+pow(Y-{pip_w}/2,2),pow({pip_w}/2,2)),255,0)'"
                )
            else:
                # 圆角矩形: crop 后再 alpha 抠圆角. ffmpeg geq 圆角公式比较丑, V1 简化为直角矩形.
                pip_filter += (
                    f",crop={pip_w}:{pip_h}:0:'(in_h-{pip_h})*{face_frac}'"
                )
            pip_filter += '[pip]'
            filter_parts.append(pip_filter)

            # overlay 位置
            pad = 24
            if req.pip.pos == 'tl': overlay_xy = f"{pad}:{pad}"
            elif req.pip.pos == 'tr': overlay_xy = f"W-w-{pad}:{pad}"
            elif req.pip.pos == 'bl': overlay_xy = f"{pad}:H-h-{pad}"
            elif req.pip.pos == 'br': overlay_xy = f"W-w-{pad}:H-h-{pad}"
            else: overlay_xy = f"(W-w)/2:(H-h)/2"
            filter_parts.append(f"[main][pip]overlay={overlay_xy}:format=auto[final_v]")
            final_v_label = 'final_v'

        # 音频: 口播音轨 + 可选 BGM 混音
        bgm_path = None
        if req.bgm_oss_key:
            bgm_path = os.path.join(work_dir, 'bgm.audio')
            try:
                oss_download(req.bgm_oss_key, bgm_path)
                # 用 -stream_loop -1 让 BGM 输入级别无限循环 (比 aloop 滤镜稳, 不会内存爆)
                ff_inputs.extend(['-stream_loop', '-1', '-i', bgm_path])
                bgm_input_idx = next_input
                next_input += 1
                bgm_vol = max(0.0, min(1.0, req.bgm_volume))
                filter_parts.append(f"[{bgm_input_idx}:a]volume={bgm_vol:.2f},aresample=44100[bgm_a]")
                # amix: duration=first 用第一个输入(口播)的时长截断; normalize=0 避免自动衰减改变音量
                filter_parts.append("[0:a]aresample=44100[narr_a];[narr_a][bgm_a]amix=inputs=2:duration=first:normalize=0[final_a]")
            except Exception as e:
                print(f"[compose] BGM 下载失败, 跳过 BGM: {e}", flush=True)
                filter_parts.append("[0:a]anull[final_a]")
        else:
            filter_parts.append("[0:a]anull[final_a]")

        filter_complex = ';'.join(filter_parts)

        # 4. 跑 ffmpeg
        out_path = os.path.join(work_dir, 'out.mp4')
        cmd = ["ffmpeg", "-y", "-hwaccel", "cuda", *ff_inputs,
               "-filter_complex", filter_complex,
               "-map", f"[{final_v_label}]", "-map", "[final_a]",
               "-c:v", "h264_nvenc", "-preset", "p2", "-cq", "26",
               "-c:a", "aac", "-pix_fmt", "yuv420p",
               "-movflags", "+faststart",
               out_path]
        print(f"[compose] ffmpeg cmd: {' '.join(cmd[:6])} ... (filter {len(filter_complex)} chars)", flush=True)
        proc = subprocess.run(cmd, capture_output=True, timeout=1800)
        if proc.returncode != 0:
            err = proc.stderr.decode("utf-8", errors="ignore")[-800:]
            raise HTTPException(500, f"ffmpeg 合成失败: {err}")

        # 5. 上传输出 OSS
        out_oss_key = f"outputs/{job_id}.mp4"
        try:
            oss_upload(out_oss_key, out_path, content_type="video/mp4")
        except Exception as e:
            raise HTTPException(500, f"OSS 上传失败: {e}")

        # 注意: 不在这里删 narration_oss_key / b-roll uploads, 让用户能多次合成 (调 PIP / 比例).
        # OSS lifecycle 规则会在 1 天后自动清掉 sources/ outputs/ uploads/, 不会积成本.

        # ffprobe 取时长
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", out_path],
            capture_output=True, text=True,
        )
        new_dur = 0.0
        if probe.returncode == 0:
            try: new_dur = float(probe.stdout.strip())
            except ValueError: pass

        video_url = oss_sign_get(out_oss_key, expires=24 * 3600)  # 24h, 让用户有时间下载
        return {
            "success": True,
            "output_oss_key": out_oss_key,
            "video_url": video_url,
            "duration": new_dur,
        }
    finally:
        # 清本地临时文件
        try: shutil.rmtree(work_dir, ignore_errors=True)
        except: pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=9001)
