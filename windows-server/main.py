from __future__ import annotations
from typing import Optional
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from jose import jwt, JWTError
from datetime import datetime, timedelta
import sqlite3
import hashlib
import os
import binascii
import tempfile
import subprocess
from urllib.parse import urlparse

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

SECRET_KEY = "monoi-secret-key-2025"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 30
VOICE_STORAGE_DIR = "voice-assets"
VOICE_PRESETS = [
    # ─── CosyVoice 大模型 女声（最自然，接近真人）───
    {"key": "longwan_v2",      "name": "龙婉",     "engine": "aliyun", "category": "preset", "gender": "female", "locale": "zh-CN", "accent": "mandarin", "emotion": "literary",     "speed": "1.0x", "sample_text": "文学女声，温柔、有故事感。"},
    {"key": "longhua_v2",      "name": "龙华",     "engine": "aliyun", "category": "preset", "gender": "female", "locale": "zh-CN", "accent": "mandarin", "emotion": "professional", "speed": "1.0x", "sample_text": "资讯女声，清晰专业。"},
    {"key": "longxiaobai",     "name": "龙小白",   "engine": "aliyun", "category": "preset", "gender": "female", "locale": "zh-CN", "accent": "mandarin", "emotion": "young",        "speed": "1.0x", "sample_text": "年轻女声，活力、生活方式。"},
    {"key": "longwan",         "name": "龙婉(经典)","engine": "aliyun", "category": "preset", "gender": "female", "locale": "zh-CN", "accent": "mandarin", "emotion": "literary",     "speed": "1.0x", "sample_text": "文学女声 V1。"},
    # ─── CosyVoice 大模型 男声 ───
    {"key": "longxiaochun_v2", "name": "龙小淳",   "engine": "aliyun", "category": "preset", "gender": "male",   "locale": "zh-CN", "accent": "mandarin", "emotion": "natural",      "speed": "1.0x", "sample_text": "自然男声，知识科普。"},
    {"key": "longxiaochun",    "name": "龙小淳(经典)","engine":"aliyun","category": "preset", "gender": "male",   "locale": "zh-CN", "accent": "mandarin", "emotion": "natural",      "speed": "1.0x", "sample_text": "自然男声 V1。"},
    {"key": "libai",           "name": "李白",     "engine": "aliyun", "category": "preset", "gender": "male",   "locale": "zh-CN", "accent": "mandarin", "emotion": "ancient",      "speed": "1.0x", "sample_text": "古风男声，文学、诗歌、历史。"},
    {"key": "loongbella",      "name": "Bella(英文)","engine": "aliyun", "category": "language", "gender": "female", "locale": "en-US", "accent": "english", "emotion": "natural", "speed": "1.0x", "sample_text": "CosyVoice 英语女声。"},
    # ─── 方言 ───
    {"key": "shanshan", "name": "姗姗",   "engine": "aliyun", "category": "dialect", "gender": "female", "locale": "zh-HK", "accent": "cantonese", "emotion": "natural", "speed": "1.0x", "sample_text": "粤语女声。"},
    {"key": "jiajia",   "name": "佳佳",   "engine": "aliyun", "category": "dialect", "gender": "female", "locale": "zh-HK", "accent": "cantonese", "emotion": "natural", "speed": "1.0x", "sample_text": "粤语女声（年轻）。"},
    {"key": "kelly",    "name": "Kelly",  "engine": "aliyun", "category": "dialect", "gender": "female", "locale": "zh-HK", "accent": "cantonese", "emotion": "natural", "speed": "1.0x", "sample_text": "香港粤语女声。"},
    {"key": "taozi",    "name": "桃子",   "engine": "aliyun", "category": "dialect", "gender": "female", "locale": "zh-HK", "accent": "cantonese", "emotion": "natural", "speed": "1.0x", "sample_text": "粤语女声（甜美）。"},
    {"key": "dahu",     "name": "大虎",   "engine": "aliyun", "category": "dialect", "gender": "male",   "locale": "zh-CN", "accent": "northeast", "emotion": "natural", "speed": "1.0x", "sample_text": "东北话男声。"},
    {"key": "cuijie",   "name": "翠姐",   "engine": "aliyun", "category": "dialect", "gender": "female", "locale": "zh-CN", "accent": "northeast", "emotion": "natural", "speed": "1.0x", "sample_text": "东北话女声。"},
    {"key": "aikan",    "name": "艾侃",   "engine": "aliyun", "category": "dialect", "gender": "male",   "locale": "zh-CN", "accent": "tianjin",   "emotion": "natural", "speed": "1.0x", "sample_text": "天津话男声。"},
    {"key": "qingqing", "name": "青青",   "engine": "aliyun", "category": "dialect", "gender": "female", "locale": "zh-TW", "accent": "taiwanese", "emotion": "natural", "speed": "1.0x", "sample_text": "台湾话女声。"},
    {"key": "xiaoze",   "name": "小泽",   "engine": "aliyun", "category": "dialect", "gender": "male",   "locale": "zh-CN", "accent": "hunan",     "emotion": "natural", "speed": "1.0x", "sample_text": "湖南重口音男声。"},
    {"key": "xiaoyue",  "name": "小玥",   "engine": "aliyun", "category": "dialect", "gender": "female", "locale": "zh-CN", "accent": "sichuan",   "emotion": "natural", "speed": "1.0x", "sample_text": "四川话女声。"},
    # ─── 外语 ───
    {"key": "zhixiang", "name": "智香",    "engine": "aliyun", "category": "language", "gender": "female", "locale": "ja-JP", "accent": "japanese", "emotion": "natural", "speed": "1.0x", "sample_text": "日语女声。"},
    {"key": "zhiye",    "name": "智也",    "engine": "aliyun", "category": "language", "gender": "male",   "locale": "ja-JP", "accent": "japanese", "emotion": "natural", "speed": "1.0x", "sample_text": "日语男声。"},
    {"key": "kyong",    "name": "Kyong",  "engine": "aliyun", "category": "language", "gender": "female", "locale": "ko-KR", "accent": "korean",   "emotion": "natural", "speed": "1.0x", "sample_text": "韩语女声。"},
    {"key": "stella",   "name": "Stella", "engine": "aliyun", "category": "language", "gender": "female", "locale": "en-US", "accent": "english",  "emotion": "natural", "speed": "1.0x", "sample_text": "英语女声。"},
    {"key": "harry",    "name": "Harry",  "engine": "aliyun", "category": "language", "gender": "male",   "locale": "en-US", "accent": "english",  "emotion": "natural", "speed": "1.0x", "sample_text": "英语男声。"},
    {"key": "clara",    "name": "Clara",  "engine": "aliyun", "category": "language", "gender": "female", "locale": "fr-FR", "accent": "french",   "emotion": "natural", "speed": "1.0x", "sample_text": "法语女声。"},
    {"key": "hanna",    "name": "Hanna",  "engine": "aliyun", "category": "language", "gender": "female", "locale": "de-DE", "accent": "german",   "emotion": "natural", "speed": "1.0x", "sample_text": "德语女声。"},
    {"key": "camila",   "name": "Camila", "engine": "aliyun", "category": "language", "gender": "female", "locale": "es-ES", "accent": "spanish",  "emotion": "natural", "speed": "1.0x", "sample_text": "西班牙语女声。"},
    {"key": "perla",    "name": "Perla",  "engine": "aliyun", "category": "language", "gender": "female", "locale": "it-IT", "accent": "italian",  "emotion": "natural", "speed": "1.0x", "sample_text": "意大利语女声。"},
    {"key": "masha",    "name": "masha",  "engine": "aliyun", "category": "language", "gender": "female", "locale": "ru-RU", "accent": "russian",  "emotion": "natural", "speed": "1.0x", "sample_text": "俄语女声。"},
    {"key": "waan",     "name": "Waan",   "engine": "aliyun", "category": "language", "gender": "female", "locale": "th-TH", "accent": "thai",     "emotion": "natural", "speed": "1.0x", "sample_text": "泰语女声。"},
    {"key": "tien",     "name": "Tien",   "engine": "aliyun", "category": "language", "gender": "female", "locale": "vi-VN", "accent": "vietnamese","emotion": "natural", "speed": "1.0x", "sample_text": "越南语女声。"},
    {"key": "indah",    "name": "Indah",  "engine": "aliyun", "category": "language", "gender": "female", "locale": "id-ID", "accent": "indonesian","emotion": "natural", "speed": "1.0x", "sample_text": "印尼语女声。"},
    {"key": "farah",    "name": "Farah",  "engine": "aliyun", "category": "language", "gender": "female", "locale": "ms-MY", "accent": "malay",    "emotion": "natural", "speed": "1.0x", "sample_text": "马来语女声。"},
    {"key": "tala",     "name": "Tala",   "engine": "aliyun", "category": "language", "gender": "female", "locale": "fil-PH","accent": "filipino", "emotion": "natural", "speed": "1.0x", "sample_text": "菲律宾语女声。"},
]

# 用 Python 内置 hashlib，无需 bcrypt/passlib
def hash_password(password: str) -> str:
    salt = os.urandom(16)
    key = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 100000)
    return binascii.hexlify(salt + key).decode()

def verify_password(password: str, stored: str) -> bool:
    try:
        data = binascii.unhexlify(stored)
        salt = data[:16]
        key = data[16:]
        new_key = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 100000)
        return key == new_key
    except Exception:
        return False

def init_db():
    conn = sqlite3.connect("monoi.db")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS voice_presets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            engine TEXT NOT NULL,
            category TEXT NOT NULL,
            gender TEXT,
            locale TEXT,
            accent TEXT,
            emotion TEXT,
            speed TEXT,
            sample_text TEXT,
            is_active INTEGER DEFAULT 1,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS voice_assets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            asset_name TEXT NOT NULL,
            source_type TEXT NOT NULL,
            file_name TEXT,
            file_path TEXT,
            duration_seconds REAL DEFAULT 0,
            sample_rate INTEGER,
            transcript TEXT,
            note TEXT,
            status TEXT DEFAULT 'ready',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS voice_clones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            clone_name TEXT NOT NULL,
            engine TEXT NOT NULL,
            source_asset_id INTEGER,
            accent TEXT,
            emotion_hint TEXT,
            status TEXT DEFAULT 'draft',
            model_ref TEXT,
            sample_text TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # 完全重置 voice_presets，每次启动都同步成 VOICE_PRESETS 里的最新列表
    conn.execute("DELETE FROM voice_presets")
    for preset in VOICE_PRESETS:
        conn.execute("""
            INSERT INTO voice_presets
            (key, name, engine, category, gender, locale, accent, emotion, speed, sample_text)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            preset["key"], preset["name"], preset["engine"], preset["category"],
            preset["gender"], preset["locale"], preset["accent"], preset["emotion"],
            preset["speed"], preset["sample_text"]
        ))
    conn.commit()
    conn.close()
    os.makedirs(VOICE_STORAGE_DIR, exist_ok=True)

init_db()

class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str

class LoginRequest(BaseModel):
    email: str
    password: str

class VoiceAssetCreateRequest(BaseModel):
    user_id: Optional[int] = None
    asset_name: str
    source_type: str
    file_name: Optional[str] = None
    file_path: Optional[str] = None
    duration_seconds: Optional[float] = 0
    sample_rate: Optional[int] = None
    transcript: Optional[str] = None
    note: Optional[str] = None

class VoiceCloneCreateRequest(BaseModel):
    user_id: Optional[int] = None
    clone_name: str
    source_asset_id: int
    accent: Optional[str] = None
    emotion_hint: Optional[str] = None
    sample_text: Optional[str] = None

class VoiceSynthesizeRequest(BaseModel):
    text: str
    preset_key: Optional[str] = None
    clone_id: Optional[int] = None
    speed: Optional[str] = None
    emotion: Optional[str] = None
    output_name: Optional[str] = None

def get_db():
    return sqlite3.connect("monoi.db")

def create_token(user_id: int, username: str):
    expire = datetime.utcnow() + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    return jwt.encode({"sub": str(user_id), "username": username, "exp": expire}, SECRET_KEY, algorithm=ALGORITHM)

def row_to_dict(row: sqlite3.Row) -> dict:
    return dict(row)

@app.post("/api/register")
def register(req: RegisterRequest):
    if len(req.username) < 2:
        raise HTTPException(400, "用户名至少2个字符")
    if len(req.password) < 6:
        raise HTTPException(400, "密码至少6位")
    conn = get_db()
    try:
        hashed = hash_password(req.password)
        conn.execute("INSERT INTO users (username, email, password) VALUES (?, ?, ?)",
                     (req.username, req.email, hashed))
        conn.commit()
        return {"success": True, "message": "注册成功"}
    except sqlite3.IntegrityError:
        raise HTTPException(400, "用户名或邮箱已存在")
    finally:
        conn.close()

@app.post("/api/login")
def login(req: LoginRequest):
    conn = get_db()
    try:
        row = conn.execute("SELECT id, username, password FROM users WHERE email = ?",
                           (req.email,)).fetchone()
        if not row or not verify_password(req.password, row[2]):
            raise HTTPException(401, "邮箱或密码错误")
        token = create_token(row[0], row[1])
        return {"success": True, "token": token, "username": row[1]}
    finally:
        conn.close()

@app.post("/api/verify")
def verify(payload: dict):
    try:
        data = jwt.decode(payload["token"], SECRET_KEY, algorithms=[ALGORITHM])
        return {"success": True, "username": data["username"], "user_id": data["sub"]}
    except JWTError:
        raise HTTPException(401, "无效或过期的token")

class FetchRequest(BaseModel):
    url: str

def extract_url(text: str) -> str:
    import re
    match = re.search(r"https?://[^\s，。！？、]+", text)
    return match.group(0) if match else text.strip()

def _is_placeholder_stream(url: str, content_length: int) -> bool:
    low = url.lower()
    if "douyin-pc-web/uuu_265.mp4" in low:
        return True
    if content_length and content_length < 600_000 and "douyinstatic.com" in low:
        return True
    return False

def _collect_douyin_candidates(url: str, headless: bool) -> list[dict]:
    import re
    from playwright.sync_api import sync_playwright

    candidates: list[dict] = []
    print(f"[playwright] begin collect headless={headless}")

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=headless,
            args=["--autoplay-policy=no-user-gesture-required", "--disable-web-security"]
        )
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 720},
        )
        page = context.new_page()

        def on_response(response):
            resp_url = response.url
            if re.search(r"\.(css|js|png|jpg|jpeg|gif|svg|woff|ico|json|xml)(\?|$)", resp_url, re.I):
                return
            if response.status not in (200, 206):
                return
            content_type = response.headers.get("content-type", "")
            content_length = int(response.headers.get("content-length", "0"))
            if content_length < 10000:
                return

            is_audio = "audio" in content_type or re.search(r"\.(m4a|aac|mp3|opus)(\?|$)", resp_url, re.I)
            is_video = ("video" in content_type or "octet-stream" in content_type or
                        re.search(r"(douyinvod|bytecdn|\.mp4)", resp_url, re.I))
            if not (is_audio or is_video):
                return

            item = {
                "url": resp_url,
                "content_type": content_type,
                "content_length": content_length,
                "is_audio": bool(is_audio),
                "is_video": bool(is_video),
                "is_placeholder": _is_placeholder_stream(resp_url, content_length),
            }
            candidates.append(item)
            kind = "audio" if is_audio else "video"
            print(
                "[playwright] candidate "
                f"{kind} {content_length // 1024}KB placeholder={item['is_placeholder']} "
                f"{resp_url[:120]}"
            )

        page.on("response", on_response)
        page.on("requestfinished", lambda req: None)

        goto_done = False
        for attempt_url in [url, extract_url(url)]:
            try:
                page.goto(attempt_url, wait_until="domcontentloaded", timeout=35000)
                goto_done = True
                break
            except Exception as e:
                print(f"[playwright] goto failed: {attempt_url} error={e}")

        if not goto_done:
            browser.close()
            return candidates

        try:
            page.wait_for_timeout(1500)
            page.evaluate("""
                () => {
                  const btns = Array.from(document.querySelectorAll('button'));
                  const playBtn = btns.find(b => /播放|play/i.test((b.innerText || '') + (b.getAttribute('aria-label') || '')));
                  if (playBtn) playBtn.click();
                }
            """)
        except Exception as e:
            print(f"[playwright] click play button failed: {e}")

        try:
            page.evaluate("document.querySelectorAll('video').forEach(v => { v.muted = true; v.play().catch(()=>{}); })")
        except Exception as e:
            print(f"[playwright] force play failed: {e}")

        for selector in ["video", "[data-e2e='feed-active-video']", ".xgplayer video"]:
            try:
                page.click(selector, timeout=2500)
                print(f"[playwright] clicked selector={selector}")
                break
            except Exception:
                continue

        page.wait_for_timeout(12000)
        try:
            page.mouse.wheel(0, 600)
            page.wait_for_timeout(2500)
        except Exception:
            pass

        browser.close()

    print(f"[playwright] collected={len(candidates)} headless={headless}")
    return candidates

def _pick_best_streams(candidates: list[dict]) -> tuple[str | None, str | None]:
    good = [c for c in candidates if not c["is_placeholder"]]
    if not good:
        good = candidates

    audio_candidates = [c for c in good if c["is_audio"]]
    video_candidates = [c for c in good if c["is_video"]]

    audio_url = max(audio_candidates, key=lambda x: x["content_length"])["url"] if audio_candidates else None
    video_url = max(video_candidates, key=lambda x: x["content_length"])["url"] if video_candidates else None
    return video_url, audio_url

def download_video_playwright(url: str, tmpdir: str, debug: bool = False):
    """抓取抖音 CDN 流。先 headless，失败后有头重试。"""
    attempts = [True, False]
    all_candidates: list[dict] = []

    for idx, headless in enumerate(attempts, start=1):
        print(f"[douyin] attempt={idx} headless={headless}")
        candidates = _collect_douyin_candidates(url, headless=headless)
        all_candidates.extend(candidates)
        video_url, audio_url = _pick_best_streams(candidates)
        print(
            "[douyin] picked "
            f"headless={headless} video={(video_url or '')[:100]} "
            f"audio={(audio_url or '')[:100]}"
        )
        if video_url or audio_url:
            if debug:
                return {
                    "ok": True,
                    "attempt": idx,
                    "headless": headless,
                    "video_url": video_url,
                    "audio_url": audio_url,
                    "candidates": candidates[:20],
                }
            return (video_url, audio_url)

    if debug:
        return {
            "ok": False,
            "attempt": len(attempts),
            "video_url": None,
            "audio_url": None,
            "candidates": all_candidates[:40],
        }
    return None


def transcribe_video(urls: tuple, tmpdir: str) -> str:
    """ffmpeg 从 CDN URL 提取音频 + Whisper 转录"""
    import shutil

    ffmpeg_bin = shutil.which("ffmpeg")
    if not ffmpeg_bin:
        raise Exception("找不到 ffmpeg")

    video_url, audio_url = urls
    audio_path = os.path.join(tmpdir, "audio.mp3")
    parsed = urlparse(audio_url or video_url or "")
    referer = f"{parsed.scheme}://{parsed.netloc}/" if parsed.scheme and parsed.netloc else "https://www.douyin.com/"
    headers = [
        "-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "-headers", f"Referer: {referer}\r\n",
    ]

    if audio_url:
        # 有独立音频流，直接转录音频
        print(f"[transcribe] using audio stream")
        cmd = [ffmpeg_bin] + headers + ["-i", audio_url, "-acodec", "mp3", audio_path, "-y"]
    else:
        # 只有视频流，尝试提取音频
        print(f"[transcribe] extracting from video stream")
        cmd = [ffmpeg_bin] + headers + ["-i", video_url, "-vn", "-acodec", "mp3", audio_path, "-y"]

    result = subprocess.run(cmd, capture_output=True, timeout=180)
    if result.returncode != 0:
        err = result.stderr.decode(errors='ignore')
        print(f"[ffmpeg error] {err[-500:]}")
        raise Exception(f"ffmpeg 失败: {err[:200]}")

    import whisper
    model = whisper.load_model("base")
    transcript = model.transcribe(audio_path, language="zh", initial_prompt="以下是普通话简体中文内容：")
    return transcript["text"]


@app.post("/api/fetch")
def fetch_content(req: FetchRequest):
    """抓取链接内容：视频链接用 Playwright+Whisper 转录，网页链接直接抓正文"""
    import re
    url = extract_url(req.url)

    is_douyin = bool(re.search(r'douyin\.com|v\.douyin\.com', url, re.I))
    is_video = bool(re.search(
        r'youtube\.com|youtu\.be|tiktok\.com|bilibili\.com|v\.qq\.com|instagram\.com/reel',
        url, re.I
    ))

    # 抖音 → Playwright 拦截 CDN 地址
    if is_douyin:
        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                print(f"[douyin] start playwright: {url}")
                video_path = download_video_playwright(url, tmpdir)
                print(f"[douyin] urls={video_path}")
                if not video_path:
                    raise HTTPException(422, "未能捕获视频地址，请稍后重试")
                print(f"[douyin] start transcribe")
                text = transcribe_video(video_path, tmpdir)
                print(f"[douyin] done, length={len(text)}")
                return {"content": text, "source": "video"}
        except HTTPException:
            raise
        except Exception as e:
            print(f"[douyin error] {e}")
            raise HTTPException(500, f"转录失败: {str(e)}")

    # 其他视频平台 → yt-dlp
    if is_video:
        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                audio_path = os.path.join(tmpdir, "audio.%(ext)s")
                result = subprocess.run([
                    "yt-dlp", "-x", "--audio-format", "mp3",
                    "--audio-quality", "0",
                    "-o", audio_path, url
                ], capture_output=True, text=True, timeout=120)

                if result.returncode != 0:
                    raise HTTPException(400, f"视频下载失败: {result.stderr[:200]}")

                import glob
                files = glob.glob(os.path.join(tmpdir, "audio.*"))
                if not files:
                    raise HTTPException(500, "音频文件未找到")

                import whisper
                model = whisper.load_model("base")
                transcript = model.transcribe(files[0], language="zh", initial_prompt="以下是普通话简体中文内容：")
                return {"content": transcript["text"], "source": "video"}
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(500, f"转录失败: {str(e)}")
    else:
        # 网页抓取
        try:
            import urllib.request
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'zh-CN,zh;q=0.9',
            }
            req_obj = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req_obj, timeout=15) as response:
                html = response.read().decode('utf-8', errors='ignore')

            # 去除标签提取正文
            text = re.sub(r'<script[\s\S]*?</script>', '', html, flags=re.I)
            text = re.sub(r'<style[\s\S]*?</style>', '', text, flags=re.I)
            text = re.sub(r'<[^>]+>', ' ', text)
            text = text.replace('&nbsp;', ' ').replace('&amp;', '&')
            text = re.sub(r'\s{2,}', '\n', text).strip()[:3000]

            if len(text) < 50:
                raise HTTPException(422, "无法提取页面内容")
            return {"content": text, "source": "webpage"}
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(500, f"页面抓取失败: {str(e)}")

@app.post("/api/transcribe")
def transcribe(req: FetchRequest):
    return fetch_content(req)

@app.post("/api/fetch-debug")
def fetch_debug(req: FetchRequest):
    import re
    url = extract_url(req.url)
    is_douyin = bool(re.search(r"douyin\.com|v\.douyin\.com", url, re.I))
    if not is_douyin:
        raise HTTPException(400, "仅支持抖音链接调试")

    with tempfile.TemporaryDirectory() as tmpdir:
        result = download_video_playwright(url, tmpdir, debug=True)
        return {"source": "douyin_debug", **result}

@app.get("/api/health")
def health():
    return {"status": "ok"}

@app.get("/api/voice/presets")
def get_voice_presets():
    conn = get_db()
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute("""
            SELECT id, key, name, engine, category, gender, locale, accent, emotion, speed, sample_text
            FROM voice_presets
            WHERE is_active = 1
            ORDER BY category, id
        """).fetchall()
        return {
            "items": [row_to_dict(row) for row in rows],
            "engines": {
                "preset": "cosyvoice",
                "clone": "fish-speech",
            },
        }
    finally:
        conn.close()

@app.post("/api/voice/assets")
def create_voice_asset(req: VoiceAssetCreateRequest):
    if not req.asset_name.strip():
        raise HTTPException(400, "asset_name 不能为空")
    if req.source_type not in ("upload", "recording", "reference"):
        raise HTTPException(400, "source_type 仅支持 upload / recording / reference")

    conn = get_db()
    conn.row_factory = sqlite3.Row
    try:
        cursor = conn.execute("""
            INSERT INTO voice_assets
            (user_id, asset_name, source_type, file_name, file_path, duration_seconds, sample_rate, transcript, note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            req.user_id, req.asset_name.strip(), req.source_type, req.file_name, req.file_path,
            req.duration_seconds or 0, req.sample_rate, req.transcript, req.note
        ))
        conn.commit()
        row = conn.execute("SELECT * FROM voice_assets WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return {"success": True, "item": row_to_dict(row)}
    finally:
        conn.close()

@app.get("/api/voice/assets")
def list_voice_assets(user_id: Optional[int] = None):
    conn = get_db()
    conn.row_factory = sqlite3.Row
    try:
        if user_id is None:
            rows = conn.execute("SELECT * FROM voice_assets ORDER BY id DESC LIMIT 50").fetchall()
        else:
            rows = conn.execute("SELECT * FROM voice_assets WHERE user_id = ? ORDER BY id DESC LIMIT 50", (user_id,)).fetchall()
        return {"items": [row_to_dict(row) for row in rows]}
    finally:
        conn.close()

@app.post("/api/voice/clones")
def create_voice_clone(req: VoiceCloneCreateRequest):
    conn = get_db()
    conn.row_factory = sqlite3.Row
    try:
        asset = conn.execute("SELECT * FROM voice_assets WHERE id = ?", (req.source_asset_id,)).fetchone()
        if not asset:
            raise HTTPException(404, "source_asset_id 不存在")
        cursor = conn.execute("""
            INSERT INTO voice_clones
            (user_id, clone_name, engine, source_asset_id, accent, emotion_hint, status, sample_text)
            VALUES (?, ?, 'fish-speech', ?, ?, ?, 'pending', ?)
        """, (
            req.user_id, req.clone_name.strip(), req.source_asset_id,
            req.accent, req.emotion_hint, req.sample_text
        ))
        conn.commit()
        row = conn.execute("SELECT * FROM voice_clones WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return {
            "success": True,
            "item": row_to_dict(row),
            "next_action": "在 Windows 机器上接入 Fish Speech 后，把这个 clone_id 送入实际克隆任务队列。",
        }
    finally:
        conn.close()

@app.get("/api/voice/clones")
def list_voice_clones(user_id: Optional[int] = None):
    conn = get_db()
    conn.row_factory = sqlite3.Row
    try:
        if user_id is None:
            rows = conn.execute("SELECT * FROM voice_clones ORDER BY id DESC LIMIT 50").fetchall()
        else:
            rows = conn.execute("SELECT * FROM voice_clones WHERE user_id = ? ORDER BY id DESC LIMIT 50", (user_id,)).fetchall()
        return {"items": [row_to_dict(row) for row in rows]}
    finally:
        conn.close()

VOICE_SERVER_URL = "http://127.0.0.1:9001"

# 阿里云语音合成配置（从环境变量读取）
ALIYUN_AK_ID = os.environ.get("ALIYUN_AK_ID", "")
ALIYUN_AK_SECRET = os.environ.get("ALIYUN_AK_SECRET", "")
ALIYUN_APP_KEY = os.environ.get("ALIYUN_APP_KEY", "")
ALIYUN_NLS_HOST = "nls-gateway-cn-shanghai.aliyuncs.com"
ALIYUN_TOKEN_HOST = "nls-meta.cn-shanghai.aliyuncs.com"

import threading as _th
_aliyun_token_cache = {"token": None, "expires_at": 0}
_aliyun_token_lock = _th.Lock()

def aliyun_get_token():
    """获取阿里云 NLS Token，内存缓存避免每次请求都拿新的"""
    import time as _t
    import json as _j
    with _aliyun_token_lock:
        now = _t.time()
        if _aliyun_token_cache["token"] and now < _aliyun_token_cache["expires_at"]:
            return _aliyun_token_cache["token"]
        if not ALIYUN_AK_ID or not ALIYUN_AK_SECRET:
            raise HTTPException(500, "阿里云 AccessKey 未配置")
        try:
            from aliyunsdkcore.client import AcsClient
            from aliyunsdkcore.request import CommonRequest
        except ImportError:
            raise HTTPException(500, "未安装 aliyun-python-sdk-core，请先 pip install aliyun-python-sdk-core")
        client = AcsClient(ALIYUN_AK_ID, ALIYUN_AK_SECRET, "cn-shanghai")
        req = CommonRequest()
        req.set_method("POST")
        req.set_domain(ALIYUN_TOKEN_HOST)
        req.set_version("2019-02-28")
        req.set_action_name("CreateToken")
        try:
            resp = client.do_action_with_exception(req)
            data = _j.loads(resp)
            token_info = data.get("Token", {})
            token = token_info.get("Id")
            expire = int(token_info.get("ExpireTime", 0))
            _aliyun_token_cache["token"] = token
            _aliyun_token_cache["expires_at"] = expire - 600  # 提前 10 分钟续
            return token
        except Exception as e:
            raise HTTPException(500, f"阿里云 Token 获取失败: {e}")


def aliyun_submit_long_tts(text: str, voice: str, speech_rate: int = 0, volume: int = 50, sample_rate: int = 16000):
    """提交长文本合成任务，返回 task_id"""
    import requests as _req
    token = aliyun_get_token()
    if not ALIYUN_APP_KEY:
        raise HTTPException(500, "阿里云 AppKey 未配置")
    url = f"https://{ALIYUN_NLS_HOST}/rest/v1/tts/async"
    payload = {
        "payload": {
            "tts_request": {
                "voice": voice,
                "sample_rate": sample_rate,
                "format": "wav",
                "text": text,
                "speech_rate": speech_rate,
                "volume": volume,
                "enable_subtitle": False,
            },
            "enable_notify": False,
        },
        "context": {"device_id": "monoi-server"},
        "header": {"appkey": ALIYUN_APP_KEY, "token": token},
    }
    try:
        resp = _req.post(url, json=payload, timeout=15)
    except Exception as e:
        raise HTTPException(503, f"阿里云提交失败: {e}")
    if resp.status_code != 200:
        raise HTTPException(502, f"阿里云返回 {resp.status_code}: {resp.text[:200]}")
    data = resp.json()
    if data.get("status") != 200:
        raise HTTPException(502, f"阿里云错误: {data.get('error_message', resp.text[:200])}")
    return data["data"]["task_id"]


def aliyun_get_task(task_id: str):
    """查询长文本任务状态"""
    import requests as _req
    token = aliyun_get_token()
    url = f"https://{ALIYUN_NLS_HOST}/rest/v1/tts/async"
    params = {"appkey": ALIYUN_APP_KEY, "token": token, "task_id": task_id}
    try:
        resp = _req.get(url, params=params, timeout=15)
    except Exception as e:
        raise HTTPException(503, f"阿里云查询失败: {e}")
    return resp.json()


def parse_speed(speed_str):
    if not speed_str:
        return 1.0
    try:
        return float(str(speed_str).rstrip("x"))
    except ValueError:
        return 1.0


def speed_to_aliyun_rate(speed_str):
    """前端 1.0x 风格转阿里云 speech_rate（-500 到 500，0 是正常语速）"""
    s = parse_speed(speed_str)
    # 1.0x → 0, 0.5x → -500, 1.5x → +500
    return int(round((s - 1.0) * 1000))

def _lookup_preset_engine(preset_key: str):
    """从 voice_presets 表里查这个 preset 的 engine"""
    if not preset_key:
        return None
    conn = get_db()
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute("SELECT engine FROM voice_presets WHERE key = ?", (preset_key,)).fetchone()
        return row["engine"] if row else None
    finally:
        conn.close()


@app.post("/api/voice/synthesize")
def synthesize_voice(req: VoiceSynthesizeRequest):
    import requests as _req

    if not req.text.strip():
        raise HTTPException(400, "text 不能为空")
    if not req.preset_key and not req.clone_id:
        raise HTTPException(400, "preset_key 和 clone_id 至少要传一个")

    # 按 preset 的 engine 字段决定走哪条路
    engine = _lookup_preset_engine(req.preset_key) or ("cosyvoice" if req.preset_key else "fish-speech")

    # ─── 阿里云长文本 TTS ───
    if engine == "aliyun":
        task_id = aliyun_submit_long_tts(
            text=req.text.strip(),
            voice=req.preset_key,
            speech_rate=speed_to_aliyun_rate(req.speed),
            volume=50,
            sample_rate=16000,
        )
        return {
            "success": True,
            "status": "queued",
            "engine": "aliyun",
            "task_id": task_id,
            "preset_key": req.preset_key,
            "speed": req.speed or "1.0x",
        }

    # ─── CosyVoice2 同步合成（克隆和老 preset） ───
    if engine == "cosyvoice":
        try:
            resp = _req.post(
                f"{VOICE_SERVER_URL}/synthesize",
                json={
                    "text": req.text.strip(),
                    "voice_id": req.preset_key,
                    "speed": parse_speed(req.speed),
                },
                timeout=120,
            )
            if resp.status_code != 200:
                raise HTTPException(500, f"voice-server 错误: {resp.status_code} {resp.text[:200]}")
            data = resp.json()
            return {
                "success": True,
                "status": "ready",
                "engine": "cosyvoice",
                "audio_url": f"/api/voice/audio/{data['file']}",
                "duration_seconds": data.get("duration_seconds"),
                "preset_key": req.preset_key,
                "speed": req.speed or "1.0x",
            }
        except _req.exceptions.ConnectionError:
            raise HTTPException(503, "voice-server (9001) 未启动")
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(500, f"合成失败: {e}")

    # Fish Speech 克隆暂未接入
    return {
        "success": True,
        "status": "queued",
        "engine": "fish-speech",
        "clone_id": req.clone_id,
        "next_action": "Fish Speech 克隆推理待接入。",
    }


@app.get("/api/voice/task/{task_id}")
def get_voice_task(task_id: str):
    """查询阿里云长文本任务状态"""
    data = aliyun_get_task(task_id)
    print(f"[ALIYUN TASK QUERY] raw response: {data}", flush=True)

    # 阿里云返回结构：status / status_text 在顶层，data 在嵌套里
    body = data.get("data") or {}
    # 音频地址：先看嵌套 data，再看顶层
    audio_url = body.get("audio_address") or data.get("audio_address")
    duration = body.get("duration") or data.get("duration") or 0

    # 状态文本：SUCCESS / RUNNING / QUEUEING
    status_text = (body.get("task_status") or data.get("task_status") or data.get("status_text") or "").upper()

    if audio_url:
        return {"status": "ready", "audio_url": audio_url, "duration_seconds": duration}

    if status_text in ("RUNNING", "QUEUEING") or status_text == "":
        return {"status": "processing", "task_status": status_text or "UNKNOWN", "raw": str(data)[:400]}

    error_msg = data.get("error_message") or data.get("message") or status_text
    return {"status": "error", "message": error_msg, "raw": str(data)[:400]}


@app.get("/api/voice/audio/{name}")
def proxy_audio(name: str):
    import requests as _req
    from fastapi.responses import StreamingResponse

    safe = os.path.basename(name)
    try:
        resp = _req.get(f"{VOICE_SERVER_URL}/audio/{safe}", stream=True, timeout=30)
        if resp.status_code != 200:
            raise HTTPException(resp.status_code, "音频未找到")
        return StreamingResponse(resp.iter_content(8192), media_type="audio/wav")
    except _req.exceptions.ConnectionError:
        raise HTTPException(503, "voice-server (9001) 未启动")
