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
    {
        "key": "cosy_cn_warm_female",
        "name": "温柔女声",
        "engine": "cosyvoice",
        "category": "preset",
        "gender": "female",
        "locale": "zh-CN",
        "accent": "mandarin",
        "emotion": "natural,warm",
        "speed": "1.0x",
        "sample_text": "适合生活方式、情感口播和轻种草内容。",
    },
    {
        "key": "cosy_cn_steady_male",
        "name": "沉稳男声",
        "engine": "cosyvoice",
        "category": "preset",
        "gender": "male",
        "locale": "zh-CN",
        "accent": "mandarin",
        "emotion": "calm,steady",
        "speed": "0.95x",
        "sample_text": "适合知识分享、财经、商业表达。",
    },
    {
        "key": "cosy_cn_sichuan_female",
        "name": "川渝女声",
        "engine": "cosyvoice",
        "category": "dialect",
        "gender": "female",
        "locale": "zh-CN",
        "accent": "sichuan",
        "emotion": "bright,friendly",
        "speed": "1.05x",
        "sample_text": "适合带方言亲切感的探店和日常分享。",
    },
    {
        "key": "cosy_cn_cantonese_male",
        "name": "粤语男声",
        "engine": "cosyvoice",
        "category": "dialect",
        "gender": "male",
        "locale": "zh-HK",
        "accent": "cantonese",
        "emotion": "relaxed,confident",
        "speed": "1.0x",
        "sample_text": "适合地区化表达和更有识别度的人设内容。",
    },
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
    for preset in VOICE_PRESETS:
        conn.execute("""
            INSERT OR IGNORE INTO voice_presets
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

@app.post("/api/voice/synthesize")
def synthesize_voice(req: VoiceSynthesizeRequest):
    if not req.text.strip():
        raise HTTPException(400, "text 不能为空")
    if not req.preset_key and not req.clone_id:
        raise HTTPException(400, "preset_key 和 clone_id 至少要传一个")

    engine = "cosyvoice" if req.preset_key else "fish-speech"
    return {
        "success": True,
        "status": "queued",
        "engine": engine,
        "text_length": len(req.text.strip()),
        "preset_key": req.preset_key,
        "clone_id": req.clone_id,
        "speed": req.speed or "1.0x",
        "emotion": req.emotion or "natural",
        "output_name": req.output_name or "voice-output.wav",
        "next_action": "当前接口已预留完成，下一步接入实际的 CosyVoice / Fish Speech 推理服务。",
    }
