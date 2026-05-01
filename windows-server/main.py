from __future__ import annotations
from fastapi import FastAPI, HTTPException
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
    conn.commit()
    conn.close()

init_db()

class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str

class LoginRequest(BaseModel):
    email: str
    password: str

def get_db():
    return sqlite3.connect("monoi.db")

def create_token(user_id: int, username: str):
    expire = datetime.utcnow() + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    return jwt.encode({"sub": str(user_id), "username": username, "exp": expire}, SECRET_KEY, algorithm=ALGORITHM)

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
    match = re.search(r'https?://[^\s，。！？、]+', text)
    return match.group(0) if match else text.strip()

def download_video_playwright(url: str, tmpdir: str) -> str | None:
    """用 Playwright 打开视频页，拦截 CDN 视频地址后下载"""
    import re
    import urllib.request
    from playwright.sync_api import sync_playwright

    video_url = None

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        page = context.new_page()

        def on_response(response):
            nonlocal video_url
            if video_url:
                return
            resp_url = response.url
            # 抖音视频 CDN 特征
            if re.search(r'(douyinvod|bytecdn|bytegoodscdn|douyinstatic|douyin\.com.*\.mp4)', resp_url, re.I):
                if response.status == 200 or response.status == 206:
                    video_url = resp_url

        page.on("response", on_response)

        try:
            page.goto(url, wait_until="networkidle", timeout=30000)
            page.wait_for_timeout(5000)
        except Exception:
            pass

        browser.close()

    return video_url


def transcribe_video(video_url: str, tmpdir: str) -> str:
    """ffmpeg 直接从 CDN URL 提取音频 + Whisper 转录"""
    import shutil

    ffmpeg_bin = shutil.which("ffmpeg")
    if not ffmpeg_bin:
        raise Exception("找不到 ffmpeg")

    audio_path = os.path.join(tmpdir, "audio.mp3")
    result = subprocess.run([
        ffmpeg_bin,
        "-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "-headers", "Referer: https://www.douyin.com/\r\n",
        "-i", video_url,
        "-vn", "-acodec", "mp3", audio_path, "-y"
    ], capture_output=True, timeout=180)
    if result.returncode != 0:
        err = result.stderr.decode(errors='ignore')
        print(f"[ffmpeg error] {err}")
        raise Exception(f"ffmpeg 提取音频失败: {err[:200]}")
    import whisper
    model = whisper.load_model("base")
    transcript = model.transcribe(audio_path, language="zh")
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
                print(f"[douyin] video_url={video_path}")
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
                transcript = model.transcribe(files[0], language="zh")
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

@app.get("/api/health")
def health():
    return {"status": "ok"}
