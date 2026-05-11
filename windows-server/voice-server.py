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

    # 2. 转 mp4 (高质量 + 密集关键帧 + HDR→SDR tonemap)
    # iPhone HLG/HDR (bt2020) 直接转 SDR 会让肤色发白过曝, 必须 tonemap (zscale + hable)
    # -g 30 + -force_key_frames: 每秒一个 keyframe, finalize 切片精度 ≤1s
    # 注意: 加 zscale 后必须放弃 -hwaccel cuda (GPU/CPU memory 冲突)
    tonemap_filter = (
        "zscale=t=linear:npl=100,"
        "tonemap=tonemap=hable:desat=0,"
        "zscale=p=bt709:t=bt709:m=bt709:r=tv,"
        "format=yuv420p"
    )
    proc = subprocess.run(
        ["ffmpeg", "-y", "-i", raw_path,
         "-vf", tonemap_filter,
         "-c:v", "h264_nvenc", "-preset", "p4", "-cq", "18",
         "-g", "30", "-force_key_frames", "expr:gte(t,n_forced)",
         "-c:a", "aac", "-b:a", "192k",
         "-movflags", "+faststart",
         video_path],
        capture_output=True, timeout=900,
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
    """根据用户保留段, 用 stream copy 无损切片 + concat 拼接 (画质 100% 不掉)."""
    import subprocess
    import shutil

    safe = os.path.basename(req.source_file)
    src_path = os.path.join(NARRATION_OUTPUT_DIR, safe)
    if not os.path.exists(src_path):
        raise HTTPException(404, "源视频不存在")
    if not req.keep_ranges:
        raise HTTPException(400, "keep_ranges 不能为空")

    out_name = f"final_{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}.mp4"
    out_path = os.path.join(NARRATION_OUTPUT_DIR, out_name)

    # 无损切片: 每个 keep_range 用 -ss/-to + -c copy 切成片段, 再用 concat demuxer 拼起来
    # 不重编码, 画质 100% 跟 clean 阶段一致 (clean 已设每秒 keyframe, 切片精度 ≤1s)
    seg_files: list[str] = []
    seg_dir = os.path.join(NARRATION_OUTPUT_DIR, f"_seg_{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}")
    os.makedirs(seg_dir, exist_ok=True)
    try:
        for i, (s, e) in enumerate(req.keep_ranges):
            seg_path = os.path.join(seg_dir, f"seg_{i:04d}.mp4")
            cut = subprocess.run(
                ["ffmpeg", "-y", "-ss", f"{s:.3f}", "-to", f"{e:.3f}", "-i", src_path,
                 "-c", "copy", "-avoid_negative_ts", "make_zero", seg_path],
                capture_output=True, timeout=300,
            )
            if cut.returncode != 0 or not os.path.exists(seg_path):
                err = cut.stderr.decode("utf-8", errors="ignore")[-300:]
                raise HTTPException(500, f"切片 {i} 失败: {err}")
            seg_files.append(seg_path)

        # concat demuxer 拼接 (stream copy, 无损)
        list_path = os.path.join(seg_dir, 'list.txt')
        with open(list_path, 'w', encoding='utf-8') as f:
            for sf in seg_files:
                f.write(f"file '{sf.replace(chr(92), '/')}'\n")
        proc = subprocess.run(
            ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", list_path,
             "-c", "copy", "-movflags", "+faststart", out_path],
            capture_output=True, timeout=600,
        )
        if proc.returncode != 0:
            err = proc.stderr.decode("utf-8", errors="ignore")[-500:]
            raise HTTPException(500, f"ffmpeg concat 失败: {err}")
    finally:
        try: shutil.rmtree(seg_dir, ignore_errors=True)
        except: pass

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

    # 2. 转 mp4 (高质量 + 密集关键帧 + HDR→SDR tonemap; iPhone HLG 不 tonemap 会过曝白)
    tonemap_filter = (
        "zscale=t=linear:npl=100,"
        "tonemap=tonemap=hable:desat=0,"
        "zscale=p=bt709:t=bt709:m=bt709:r=tv,"
        "format=yuv420p"
    )
    proc = subprocess.run(
        ["ffmpeg", "-y", "-i", raw_path,
         "-vf", tonemap_filter,
         "-c:v", "h264_nvenc", "-preset", "p4", "-cq", "18",
         "-g", "30", "-force_key_frames", "expr:gte(t,n_forced)",
         "-c:a", "aac", "-b:a", "192k",
         "-movflags", "+faststart",
         video_path],
        capture_output=True, timeout=900,
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

    # 注意: 不主动删 uploads/, 让 OSS lifecycle 1 天兜底.
    # 之前主动删导致用户重试 (NATAPP 长连接断/前端 retry) 时 404.
    # 让用户能重试同一个 oss_key, 不会因为我们删了文件而挂.

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
    """OSS 模式: 从 OSS 拉源视频, 用 stream copy 无损切片 + concat 拼接 (画质 100% 不掉)."""
    import subprocess
    import shutil
    import tempfile
    from oss_helper import oss_download, oss_upload, oss_sign_get, oss_delete

    if not req.keep_ranges:
        raise HTTPException(400, "keep_ranges 不能为空")

    job_id = f"final_{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}"
    src_path = os.path.join(tempfile.gettempdir(), f"{job_id}_src.mp4")
    out_path = os.path.join(tempfile.gettempdir(), f"{job_id}_out.mp4")
    seg_dir = os.path.join(tempfile.gettempdir(), f"{job_id}_segs")
    os.makedirs(seg_dir, exist_ok=True)

    # 1. 从 OSS 下载源视频
    try:
        oss_download(req.source_oss_key, src_path)
    except Exception as e:
        raise HTTPException(400, f"OSS 下载失败: {e}")

    # 2. 无损切片 + concat 拼接 (不重编码)
    seg_files: list[str] = []
    proc = None
    try:
        for i, (s, e) in enumerate(req.keep_ranges):
            seg_path = os.path.join(seg_dir, f"seg_{i:04d}.mp4")
            cut = subprocess.run(
                ["ffmpeg", "-y", "-ss", f"{s:.3f}", "-to", f"{e:.3f}", "-i", src_path,
                 "-c", "copy", "-avoid_negative_ts", "make_zero", seg_path],
                capture_output=True, timeout=300,
            )
            if cut.returncode != 0 or not os.path.exists(seg_path):
                err = cut.stderr.decode("utf-8", errors="ignore")[-300:]
                raise HTTPException(500, f"切片 {i} 失败: {err}")
            seg_files.append(seg_path)

        list_path = os.path.join(seg_dir, 'list.txt')
        with open(list_path, 'w', encoding='utf-8') as f:
            for sf in seg_files:
                f.write(f"file '{sf.replace(chr(92), '/')}'\n")
        proc = subprocess.run(
            ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", list_path,
             "-c", "copy", "-movflags", "+faststart", out_path],
            capture_output=True, timeout=600,
        )
    finally:
        try: os.unlink(src_path)
        except: pass
        try: shutil.rmtree(seg_dir, ignore_errors=True)
        except: pass

    if proc is None or proc.returncode != 0:
        err = proc.stderr.decode("utf-8", errors="ignore")[-500:] if proc else 'unknown'
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

    # 注意: 不主动删 source_oss_key (sources/), 让 lifecycle 兜底.
    # 之前主动删导致用户改剪 keep_ranges 重新 finalize 时 404.

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
                    elif asset.url:
                        # 公网 URL (Pexels/Pixabay) — 必须带浏览器 UA, 否则 403 Forbidden
                        ureq = urllib.request.Request(asset.url, headers={
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Referer': 'https://www.pexels.com/' if 'pexels' in asset.url else 'https://pixabay.com/',
                        })
                        with urllib.request.urlopen(ureq, timeout=120) as resp, open(local, 'wb') as f:
                            shutil.copyfileobj(resp, f)
                    else:
                        raise ValueError('asset 没 url 也没 oss_key')

                    # ffprobe 验文件是有效视频 (Pexels CDN 偶尔返 HTML 错误页, 文件大小不是 0 但不能解码)
                    probe = subprocess.run(
                        ['ffprobe', '-v', 'error', '-select_streams', 'v:0',
                         '-show_entries', 'stream=codec_name', '-of', 'default=nw=1:nk=1', local],
                        capture_output=True, timeout=30,
                    )
                    if probe.returncode != 0 or not probe.stdout.strip():
                        raise ValueError(f'下载的文件不是有效视频 (ffprobe 失败)')
                    asset_files[(si, ai)] = local
                except Exception as e:
                    print(f"[compose] asset {si}/{ai} 下载/校验失败 ({asset.url[:80] if asset.url else asset.oss_key}): {e}", flush=True)
                    # 失败的镜头让 ffmpeg fallback 用口播画面 (跟"没素材"一样处理)
                    try: os.unlink(local)
                    except: pass

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
                    f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1,fps=30,format=yuv420p[{lbl}]"
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
                        f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1,fps=30,format=yuv420p[{lbl}]"
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

            # PIP 只在"有 b-roll 的镜头"时间段叠 — 没素材的镜头 main 已经是口播全屏, 再叠口播 PIP 是重复
            broll_intervals: list[tuple[float, float]] = []
            acc = 0.0
            for si, shot in enumerate(req.shots):
                seg_dur = max(0.1, shot.end - shot.start)
                shot_has_broll = any((si, ai) in asset_files for ai in range(len(shot.assets)))
                if shot_has_broll:
                    broll_intervals.append((acc, acc + seg_dur))
                acc += seg_dur

            if broll_intervals:
                enable_expr = "+".join(f"between(t,{s:.3f},{e:.3f})" for s, e in broll_intervals)
                filter_parts.append(f"[main][pip]overlay={overlay_xy}:enable='{enable_expr}':format=auto[final_v]")
                final_v_label = 'final_v'
            else:
                # 一镜都没素材 (理论上不会进这里, has_any_broll 已经判过), 不叠 PIP
                filter_parts.pop()  # 撤销刚才 append 的 pip filter
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
        # 注意: 合成阶段不加 -hwaccel cuda. 复杂滤镜链 (split/geq/overlay) 在 GPU memory 上跑不了,
        # ffmpeg 8.x 严格了, 没显式 hwdownload 直接报 -22 Invalid argument. 解码用 CPU + 编码用 nvenc 即可.
        cmd = ["ffmpeg", "-y", *ff_inputs,
               "-filter_complex", filter_complex,
               "-map", f"[{final_v_label}]", "-map", "[final_a]",
               # 质量优先 (preset p4 平衡, cq 19 高清, 码率上限保高质量), 用户要"保留原素材清晰度"
               "-c:v", "h264_nvenc", "-preset", "p4", "-cq", "19",
               "-b:v", "8M", "-maxrate", "12M", "-bufsize", "16M",
               "-c:a", "aac", "-b:a", "192k", "-pix_fmt", "yuv420p",
               "-movflags", "+faststart",
               out_path]
        print(f"[compose] ffmpeg cmd: {' '.join(cmd[:6])} ... (filter {len(filter_complex)} chars)", flush=True)
        proc = subprocess.run(cmd, capture_output=True, timeout=1800)
        if proc.returncode != 0:
            full_err = proc.stderr.decode("utf-8", errors="ignore")
            # 完整 stderr 打到 voice-server 窗口 (用户能看到)
            print(f"[compose] ffmpeg 失败 (returncode={proc.returncode})", flush=True)
            print(f"[compose] ffmpeg cmd: {' '.join(cmd)}", flush=True)
            print(f"[compose] ffmpeg filter_complex: {filter_complex}", flush=True)
            print(f"[compose] ffmpeg stderr 完整:\n{full_err}\n[compose] === stderr 结束 ===", flush=True)
            # 找真正的错误行 (含 'Error' 或 'error' 关键字), 截出来给前端
            err_lines = [l for l in full_err.split('\n') if 'rror' in l or 'failed' in l.lower() or 'invalid' in l.lower()]
            err_summary = '\n'.join(err_lines[-10:]) if err_lines else full_err[-1500:]
            raise HTTPException(500, f"ffmpeg 合成失败 (完整 log 见 voice-server 窗口): {err_summary}")

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


# ============== 视频封面生成 (截帧 + drawtext 叠标题, 5 个内置模板, 4 种比例) ==============


class CoverRequest(BaseModel):
    source_oss_key: str
    frame_time: float = 1.0
    title: str
    subtitle: str = ''
    template: str = 'youtube'
    output_ratios: list[str] = ['9:16', '16:9', '3:4', '1:1']
    font_title: Optional[str] = None
    font_subtitle: Optional[str] = None
    # 用户自定义 (None 走模板默认)
    color_fill: Optional[str] = None      # 字色 hex 例如 '#FFD700'
    color_stroke: Optional[str] = None    # 描边色 hex
    color_sub_fill: Optional[str] = None  # 副标题字色 hex
    position: Optional[str] = None        # 9 宫格: 'tl'/'tc'/'tr'/'cl'/'cc'/'cr'/'bl'/'bc'/'br'
    font_scale: float = 1.0               # 字号倍数 0.5-2.5


# 可选字体清单 (跟一键启动.bat 下载的对应) — 给前端 GET /cover-fonts 用
_FONT_CATALOG = [
    {'file': 'SourceHanSansCN-Heavy.otf',  'label': '思源黑体 Heavy',  'tag': '现代粗黑·万能'},
    {'file': 'youshe-biaoti-hei.ttf',      'label': '优设标题黑',      'tag': '设计感粗黑·标题首选'},
    {'file': 'zcool-xiaowei-logo.otf',     'label': '站酷小薇 LOGO 体', 'tag': 'logo 风·品牌'},
    {'file': 'zcool-qingke-huangyou.ttf',  'label': '站酷庆科黄油体',  'tag': '圆润 q 弹·美食/可爱'},
    {'file': 'zcool-kuaile.ttf',           'label': '站酷快乐体',      'tag': '卡通可爱'},
    {'file': 'shetu-modern-xiaofang.ttf',  'label': '摄图摩登小方体',  'tag': '现代方正·商业'},
    {'file': 'baotu-xiaobai.ttf',          'label': '包图小白体',      'tag': '圆润可爱·种草'},
    {'file': 'jiangxi-zhuokai.ttf',        'label': '江西拙楷',        'tag': '楷书古风·文艺'},
    {'file': 'zhuangjia-mincho.ttf',       'label': '装甲明朝',        'tag': '日文明朝·古典'},
    {'file': 'marker-shouhui.ttf',         'label': '麦克笔手绘体',    'tag': '马克笔手写·涂鸦'},
]


# 各模板按比例输出尺寸 (短边 1080)
_COVER_DIMS = {
    '9:16': (1080, 1920),
    '16:9': (1920, 1080),
    '3:4':  (1080, 1440),
    '1:1':  (1080, 1080),
}

# 字体路径优先级: 项目 fonts 目录 (用户放设计字体) → Win 系统字体 (兜底)
# 用户在 D:\monoi-server\fonts\ 放思源黑体 Heavy 等设计字体, 自动用; 没的话 fallback 到微软雅黑
_FONT_DIR_PROJECT = r'D:\monoi-server\fonts'
_FONT_CANDIDATES_HEAVY = [   # 标题用粗体
    'SourceHanSansCN-Heavy.otf',
    'SourceHanSansSC-Heavy.otf',
    'zcool-gaoduanhei.ttf',     # 站酷高端黑
    'pmzd.ttf',                  # 庞门正道粗书
    'AlibabaPuHuiTi-3-115-Black.ttf',
]
_FONT_CANDIDATES_REGULAR = [  # 副标题用常规
    'SourceHanSansCN-Bold.otf',
    'SourceHanSansSC-Bold.otf',
    'AlibabaPuHuiTi-3-85-Bold.ttf',
]
_FONT_FALLBACK_HEAVY = 'C:/Windows/Fonts/msyhbd.ttc'      # 微软雅黑 Bold
_FONT_FALLBACK_REGULAR = 'C:/Windows/Fonts/msyh.ttc'      # 微软雅黑


def _find_font(candidates: list, fallback: str) -> str:
    """优先项目 fonts 目录, 否则系统字体兜底"""
    for name in candidates:
        path = os.path.join(_FONT_DIR_PROJECT, name)
        if os.path.exists(path):
            return path
    return fallback


def _load_font(size: int, weight: str = 'heavy', user_pick: Optional[str] = None):
    """加载 PIL 字体. user_pick = 用户选的文件名 (优先), 没选才走 weight 兜底."""
    from PIL import ImageFont
    path = None
    if user_pick:
        candidate = os.path.join(_FONT_DIR_PROJECT, os.path.basename(user_pick))
        if os.path.exists(candidate):
            path = candidate
    if not path:
        if weight == 'heavy':
            path = _find_font(_FONT_CANDIDATES_HEAVY, _FONT_FALLBACK_HEAVY)
        else:
            path = _find_font(_FONT_CANDIDATES_REGULAR, _FONT_FALLBACK_REGULAR)
    try:
        return ImageFont.truetype(path, size)
    except Exception as e:
        print(f"[cover] 字体加载失败 {path}: {e}, 用默认", flush=True)
        return ImageFont.load_default()


def _text_size(draw, text: str, font):
    """跨 PIL 版本拿文字尺寸"""
    bbox = draw.textbbox((0, 0), text, font=font)
    return bbox[2] - bbox[0], bbox[3] - bbox[1]


def _draw_text_with_stroke(img, xy, text, font, fill, stroke_color=None, stroke_w=0, shadow=None):
    """画文字: 可选多层描边 + 可选阴影. 用 PIL 内置 stroke_width 性能好.
    shadow = (offset_x, offset_y, color) 或 None"""
    from PIL import ImageDraw
    draw = ImageDraw.Draw(img)
    x, y = xy
    # 阴影
    if shadow:
        sx, sy, sc = shadow
        draw.text((x + sx, y + sy), text, font=font, fill=sc)
    # 主字 + 描边 (PIL 自带 stroke_width 比手动循环快很多)
    if stroke_w > 0 and stroke_color:
        draw.text((x, y), text, font=font, fill=fill, stroke_width=stroke_w, stroke_fill=stroke_color)
    else:
        draw.text((x, y), text, font=font, fill=fill)


def _hex_to_rgb(hex_str: str, default=(255, 255, 255)):
    """'#FFD700' / 'FFD700' → (255, 215, 0). 失败返 default."""
    if not hex_str:
        return default
    s = hex_str.strip().lstrip('#')
    if len(s) == 3:
        s = ''.join(c * 2 for c in s)
    if len(s) != 6:
        return default
    try:
        return tuple(int(s[i:i+2], 16) for i in (0, 2, 4))
    except Exception:
        return default


def _render_template_pillow(img, template: str, title: str, subtitle: str,
                             user_font_title: Optional[str] = None,
                             user_font_subtitle: Optional[str] = None,
                             color_fill: Optional[str] = None,
                             color_stroke: Optional[str] = None,
                             color_sub_fill: Optional[str] = None,
                             position: Optional[str] = None,
                             font_scale: float = 1.0):
    """用 Pillow 在图上叠模板. user_* 字体, color_* 颜色, position 9 宫格, font_scale 字号倍数."""
    from PIL import ImageDraw
    W, H = img.size
    base = min(W, H)
    fs = max(0.5, min(2.5, font_scale or 1.0))
    title_size = int(base * 0.13 * fs)
    sub_size = int(base * 0.055 * fs)
    # 用户自定义颜色覆盖模板默认 (None 走模板默认)
    user_fill = _hex_to_rgb(color_fill) if color_fill else None
    user_stroke = _hex_to_rgb(color_stroke) if color_stroke else None
    user_sub_fill = _hex_to_rgb(color_sub_fill) if color_sub_fill else None

    if template == 'youtube':
        # YouTube 爆款: 大粗黄字 + 红描边 + 黑阴影, 上方
        font = _load_font(title_size, 'heavy', user_font_title)
        sub_font = _load_font(sub_size, 'heavy', user_font_subtitle)
        draw = ImageDraw.Draw(img)
        tw, th = _text_size(draw, title, font)
        # 9 宫格定位 (用户没指定走默认 tc 上方居中)
        pos = position or 'tc'
        pad = int(min(W, H) * 0.04)
        x_map = {'l': pad, 'c': (W - tw) // 2, 'r': W - tw - pad}
        y_map = {'t': int(H * 0.08), 'c': (H - th) // 2, 'b': H - th - pad}
        x = x_map.get(pos[1] if len(pos) > 1 else 'c', x_map['c'])
        y = y_map.get(pos[0] if len(pos) > 0 else 't', y_map['t'])
        sh_off = max(4, int(title_size * 0.05))
        stroke_w = max(6, int(title_size * 0.10))
        _draw_text_with_stroke(
            img, (x, y), title, font,
            fill=user_fill or (255, 220, 0),
            stroke_color=user_stroke or (200, 0, 0),
            stroke_w=stroke_w,
            shadow=(sh_off, sh_off, (0, 0, 0)),
        )
        if subtitle:
            stw, _ = _text_size(draw, subtitle, sub_font)
            sx = (W - stw) // 2
            sy = y + th + int(title_size * 0.2)
            _draw_text_with_stroke(
                img, (sx, sy), subtitle, sub_font,
                fill=user_sub_fill or (255, 255, 255),
                stroke_color=user_stroke or (0, 0, 0),
                stroke_w=max(3, int(sub_size * 0.08)),
            )

    elif template == 'douyin':
        # 抖音爆款: 上下黑底 padding + 中间画面 + 黑底上白字
        bar_h = int(H * 0.18)
        # 上下黑底
        ImageDraw.Draw(img).rectangle([(0, 0), (W, bar_h)], fill=(0, 0, 0))
        ImageDraw.Draw(img).rectangle([(0, H - bar_h), (W, H)], fill=(0, 0, 0))
        # 上方主标题 (大白字)
        t_size = int(bar_h * 0.55)
        font = _load_font(t_size, 'heavy', user_font_title)
        draw = ImageDraw.Draw(img)
        tw, th = _text_size(draw, title, font)
        x = (W - tw) // 2
        y = (bar_h - th) // 2
        draw.text((x, y), title, font=font, fill=user_fill or (255, 255, 255))
        if subtitle:
            sub_font = _load_font(sub_size, 'regular', user_font_subtitle)
            stw, sth = _text_size(draw, subtitle, sub_font)
            sx = (W - stw) // 2
            sy = H - bar_h + (bar_h - sth) // 2
            draw.text((sx, sy), subtitle, font=sub_font, fill=user_sub_fill or (255, 200, 100))

    elif template == 'xhs':
        # 小红书干货: 顶部红色块 + 圆角 + 主副两行白字
        block_h = int(H * 0.24)
        # 红色色块 (略带圆角下沿: 用矩形够了, 视觉上没差太多)
        ImageDraw.Draw(img).rectangle([(0, 0), (W, block_h)], fill=(255, 87, 87))
        # 主标题
        t_size = int(block_h * 0.42) if subtitle else int(block_h * 0.55)
        font = _load_font(t_size, 'heavy', user_font_title)
        draw = ImageDraw.Draw(img)
        tw, th = _text_size(draw, title, font)
        pad = int(W * 0.05)
        if subtitle:
            sub_font = _load_font(sub_size, 'regular', user_font_subtitle)
            stw, sth = _text_size(draw, subtitle, sub_font)
            total_h = th + int(t_size * 0.25) + sth
            y_start = (block_h - total_h) // 2
            draw.text((pad, y_start), title, font=font, fill=user_fill or (255, 255, 255))
            draw.text((pad, y_start + th + int(t_size * 0.25)), subtitle, font=sub_font, fill=user_sub_fill or (255, 220, 220))
        else:
            y = (block_h - th) // 2
            draw.text((pad, y), title, font=font, fill=user_fill or (255, 255, 255))

    elif template == 'bilibili':
        # B站知识型: 左下角白色半透明圆角卡片 + 黑色标题
        card_w = int(W * 0.85)
        card_h = int(H * 0.18)
        margin = int(W * 0.04)
        x0 = margin
        y0 = H - card_h - margin
        # 半透明白色卡片 (要 RGBA 合成才能透明)
        from PIL import Image
        overlay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        odraw = ImageDraw.Draw(overlay)
        try:
            odraw.rounded_rectangle([(x0, y0), (x0 + card_w, y0 + card_h)], radius=20, fill=(255, 255, 255, 230))
        except AttributeError:
            odraw.rectangle([(x0, y0), (x0 + card_w, y0 + card_h)], fill=(255, 255, 255, 230))
        img.paste(Image.alpha_composite(img.convert('RGBA'), overlay).convert('RGB'))
        # 标题 (黑色) + 副标题 (灰)
        draw = ImageDraw.Draw(img)
        t_size = int(card_h * 0.40) if subtitle else int(card_h * 0.55)
        font = _load_font(t_size, 'heavy', user_font_title)
        tw, th = _text_size(draw, title, font)
        text_pad = int(card_w * 0.04)
        if subtitle:
            sub_font = _load_font(int(sub_size * 0.85), 'regular', user_font_subtitle)
            stw, sth = _text_size(draw, subtitle, sub_font)
            total_h = th + int(t_size * 0.2) + sth
            y_start = y0 + (card_h - total_h) // 2
            draw.text((x0 + text_pad, y_start), title, font=font, fill=user_fill or (20, 20, 20))
            draw.text((x0 + text_pad, y_start + th + int(t_size * 0.2)), subtitle, font=sub_font, fill=user_sub_fill or (120, 120, 120))
        else:
            y = y0 + (card_h - th) // 2
            draw.text((x0 + text_pad, y), title, font=font, fill=user_fill or (20, 20, 20))

    else:  # minimal
        # 极简: 底部黑色半透明条 + 白字
        bar_h = int(sub_size * 2.4)
        from PIL import Image
        overlay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        odraw = ImageDraw.Draw(overlay)
        odraw.rectangle([(0, H - bar_h), (W, H)], fill=(0, 0, 0, 160))
        img.paste(Image.alpha_composite(img.convert('RGBA'), overlay).convert('RGB'))
        font = _load_font(int(sub_size * 1.1), 'regular', user_font_title)
        draw = ImageDraw.Draw(img)
        tw, th = _text_size(draw, title, font)
        # minimal 也支持 9 宫格位置 (默认 bc 底部居中)
        pos = position or 'bc'
        pad_min = int(min(W, H) * 0.04)
        x_map_m = {'l': pad_min, 'c': (W - tw) // 2, 'r': W - tw - pad_min}
        y_map_m = {'t': pad_min, 'c': (H - th) // 2, 'b': H - bar_h + (bar_h - th) // 2}
        x = x_map_m.get(pos[1] if len(pos) > 1 else 'c', x_map_m['c'])
        y = y_map_m.get(pos[0] if len(pos) > 0 else 'b', y_map_m['b'])
        draw.text((x, y), title, font=font, fill=user_fill or (255, 255, 255))

    return img


@app.get("/cover-fonts")
def list_cover_fonts():
    """列出 server 上可用的字体 (扫 D:\\monoi-server\\fonts\\, 跟 _FONT_CATALOG 对比).
    前端用这个接口拉字体下拉选项."""
    available = []
    for item in _FONT_CATALOG:
        path = os.path.join(_FONT_DIR_PROJECT, item['file'])
        if os.path.exists(path):
            available.append(item)
    return {'fonts': available}


@app.get("/cover-font-file/{filename}")
def get_cover_font_file(filename: str):
    """提供字体文件给浏览器加载 (前端 FontFace API 用, 显示真字体样式)"""
    safe = os.path.basename(filename)
    path = os.path.join(_FONT_DIR_PROJECT, safe)
    if not os.path.exists(path):
        raise HTTPException(404, f'字体不存在: {safe}')
    media = 'font/otf' if safe.lower().endswith('.otf') else 'font/ttf'
    return FileResponse(path, media_type=media, headers={'Cache-Control': 'public, max-age=2592000'})


@app.post("/generate-cover")
def generate_cover(req: CoverRequest):
    """ffmpeg 截帧 + scale → Pillow 渲染模板 → 上传 OSS"""
    import shutil
    import subprocess
    import tempfile
    from PIL import Image
    from oss_helper import oss_download, oss_upload, oss_sign_get

    if not req.title.strip():
        raise HTTPException(400, '标题不能为空')
    if req.template not in {'youtube', 'douyin', 'xhs', 'bilibili', 'minimal'}:
        raise HTTPException(400, f'未知模板: {req.template}')

    job_id = f"cover_{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}"
    work_dir = os.path.join(tempfile.gettempdir(), job_id)
    os.makedirs(work_dir, exist_ok=True)

    try:
        # 1. 从 OSS 下载源视频
        src_path = os.path.join(work_dir, 'source.mp4')
        try:
            oss_download(req.source_oss_key, src_path)
        except Exception as e:
            err = str(e)
            if 'NoSuchKey' in err or '404' in err:
                raise HTTPException(410, '源视频已过期 (>1 天 OSS 自动清理), 重新合成一遍.')
            raise HTTPException(400, f'OSS 下载失败: {err[:200]}')

        # 2. 每个比例: ffmpeg 截帧 + scale+crop → Pillow 叠字 → 保存
        results = []
        for ratio in req.output_ratios:
            if ratio not in _COVER_DIMS:
                continue
            W, H = _COVER_DIMS[ratio]
            base_jpg = os.path.join(work_dir, f"base_{ratio.replace(':', 'x')}.jpg")

            # ffmpeg 只负责截帧 + 缩放 (无文字), Pillow 负责所有文字效果
            cmd = ["ffmpeg", "-y", "-ss", f"{req.frame_time:.3f}", "-i", src_path,
                   "-frames:v", "1",
                   "-vf", f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H}",
                   "-q:v", "2", base_jpg]
            proc = subprocess.run(cmd, capture_output=True, timeout=60)
            if proc.returncode != 0 or not os.path.exists(base_jpg):
                err = proc.stderr.decode("utf-8", errors="ignore")[-400:]
                print(f"[cover] {ratio} 截帧失败: {err}", flush=True)
                continue

            # Pillow 渲染叠字
            try:
                img = Image.open(base_jpg).convert('RGB')
                img = _render_template_pillow(img, req.template, req.title, req.subtitle,
                                               user_font_title=req.font_title,
                                               user_font_subtitle=req.font_subtitle,
                                               color_fill=req.color_fill,
                                               color_stroke=req.color_stroke,
                                               color_sub_fill=req.color_sub_fill,
                                               position=req.position,
                                               font_scale=req.font_scale)
                out_jpg = os.path.join(work_dir, f"cover_{ratio.replace(':', 'x')}.jpg")
                img.save(out_jpg, 'JPEG', quality=92, optimize=True)
            except Exception as e:
                print(f"[cover] {ratio} Pillow 渲染失败: {e}", flush=True)
                continue

            # 上传 OSS
            oss_key = f"covers/{job_id}_{ratio.replace(':', 'x')}.jpg"
            oss_upload(oss_key, out_jpg, content_type='image/jpeg')
            url = oss_sign_get(oss_key, expires=24 * 3600)
            results.append({'ratio': ratio, 'oss_key': oss_key, 'url': url})

        if not results:
            raise HTTPException(500, '所有比例封面生成都失败, 看 voice-server 窗口 stderr')

        return {'success': True, 'covers': results}
    finally:
        try: shutil.rmtree(work_dir, ignore_errors=True)
        except: pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=9001)
