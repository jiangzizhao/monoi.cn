from __future__ import annotations
from typing import Optional
from fastapi import FastAPI, HTTPException, Query, BackgroundTasks, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from jose import jwt, JWTError
from datetime import datetime, timedelta
import sqlite3
import hashlib
import os
import time
import uuid
import binascii
import tempfile
import subprocess
from urllib.parse import urlparse


# 零依赖的 .env 加载器 (不需要 python-dotenv)
# 启动时从当前工作目录读取 .env 把键值对塞进 os.environ
def _load_dotenv_simple(path: str = ".env") -> None:
    if not os.path.exists(path):
        return
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = value
    except Exception as _e:
        print(f"[load_dotenv] 警告: {_e}", flush=True)


_load_dotenv_simple()


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
    # ─── 本地 CosyVoice2 （免费，质量优）───
    {"key": "cosy_default", "name": "莫小本", "engine": "cosyvoice", "category": "preset", "gender": "female", "locale": "zh-CN", "accent": "mandarin", "emotion": "natural", "speed": "1.0x", "sample_text": "自然女声，日常分享、生活vlog。"},
    # ─── 普通话女声（极致音+多情感，长文本商用版可用）───
    {"key": "siqi",        "name": "莫小婉", "engine": "aliyun", "category": "preset", "gender": "female", "locale": "zh-CN", "accent": "mandarin", "emotion": "warm",       "speed": "1.0x", "sample_text": "温柔女声，情感、生活方式。"},
    {"key": "ruoxi",       "name": "莫小华", "engine": "aliyun", "category": "preset", "gender": "female", "locale": "zh-CN", "accent": "mandarin", "emotion": "knowledgeable","speed": "1.0x", "sample_text": "知性女声，知识、纪录。"},
    {"key": "zhitian_emo", "name": "莫小琪", "engine": "aliyun", "category": "preset", "gender": "female", "locale": "zh-CN", "accent": "mandarin", "emotion": "expressive", "speed": "1.0x", "sample_text": "多情感女声，活力日常。"},
    {"key": "sijia",       "name": "莫小韵", "engine": "aliyun", "category": "preset", "gender": "female", "locale": "zh-CN", "accent": "mandarin", "emotion": "natural",    "speed": "1.0x", "sample_text": "自然女声，日常口播。"},
    # ─── 普通话男声 ───
    {"key": "sicheng",     "name": "莫小淳", "engine": "aliyun", "category": "preset", "gender": "male",   "locale": "zh-CN", "accent": "mandarin", "emotion": "steady",     "speed": "0.95x","sample_text": "沉稳男声，资讯、商业、知识。"},
    {"key": "zhibei_emo",  "name": "莫小辰", "engine": "aliyun", "category": "preset", "gender": "male",   "locale": "zh-CN", "accent": "mandarin", "emotion": "expressive", "speed": "1.0x", "sample_text": "多情感男声，自然真人感。"},
    {"key": "aijia",       "name": "莫小逸", "engine": "aliyun", "category": "preset", "gender": "male",   "locale": "zh-CN", "accent": "mandarin", "emotion": "casual",     "speed": "1.0x", "sample_text": "精品男声，年轻自然。"},
    # ─── 方言 ───
    {"key": "shanshan", "name": "莫小珊", "engine": "aliyun", "category": "dialect", "gender": "female", "locale": "zh-HK", "accent": "cantonese", "emotion": "natural", "speed": "1.0x", "sample_text": "粤语女声。"},
    {"key": "jiajia",   "name": "莫小佳", "engine": "aliyun", "category": "dialect", "gender": "female", "locale": "zh-HK", "accent": "cantonese", "emotion": "natural", "speed": "1.0x", "sample_text": "粤语女声。"},
    {"key": "kelly",    "name": "莫小琳", "engine": "aliyun", "category": "dialect", "gender": "female", "locale": "zh-HK", "accent": "cantonese", "emotion": "natural", "speed": "1.0x", "sample_text": "香港粤语女声。"},
    {"key": "taozi",    "name": "莫小桃", "engine": "aliyun", "category": "dialect", "gender": "female", "locale": "zh-HK", "accent": "cantonese", "emotion": "natural", "speed": "1.0x", "sample_text": "粤语甜美女声。"},
    {"key": "dahu",     "name": "莫小虎", "engine": "aliyun", "category": "dialect", "gender": "male",   "locale": "zh-CN", "accent": "northeast", "emotion": "natural", "speed": "1.0x", "sample_text": "东北话男声。"},
    {"key": "cuijie",   "name": "莫小翠", "engine": "aliyun", "category": "dialect", "gender": "female", "locale": "zh-CN", "accent": "northeast", "emotion": "natural", "speed": "1.0x", "sample_text": "东北话女声。"},
    {"key": "aikan",    "name": "莫小侃", "engine": "aliyun", "category": "dialect", "gender": "male",   "locale": "zh-CN", "accent": "tianjin",   "emotion": "natural", "speed": "1.0x", "sample_text": "天津话男声。"},
    {"key": "qingqing", "name": "莫小青", "engine": "aliyun", "category": "dialect", "gender": "female", "locale": "zh-TW", "accent": "taiwanese", "emotion": "natural", "speed": "1.0x", "sample_text": "台湾话女声。"},
    {"key": "xiaoze",   "name": "莫小泽", "engine": "aliyun", "category": "dialect", "gender": "male",   "locale": "zh-CN", "accent": "hunan",     "emotion": "natural", "speed": "1.0x", "sample_text": "湖南重口音男声。"},
    {"key": "xiaoyue",  "name": "莫小玥", "engine": "aliyun", "category": "dialect", "gender": "female", "locale": "zh-CN", "accent": "sichuan",   "emotion": "natural", "speed": "1.0x", "sample_text": "四川话女声。"},
    # ─── 外语（保留原名）───
    {"key": "zhixiang",   "name": "智香",   "engine": "aliyun", "category": "language", "gender": "female", "locale": "ja-JP", "accent": "japanese", "emotion": "natural", "speed": "1.0x", "sample_text": "日语女声。"},
    {"key": "zhiye",      "name": "智也",   "engine": "aliyun", "category": "language", "gender": "male",   "locale": "ja-JP", "accent": "japanese", "emotion": "natural", "speed": "1.0x", "sample_text": "日语男声。"},
    {"key": "kyong",      "name": "Kyong",  "engine": "aliyun", "category": "language", "gender": "female", "locale": "ko-KR", "accent": "korean",   "emotion": "natural", "speed": "1.0x", "sample_text": "韩语女声。"},
    {"key": "stella",     "name": "Stella", "engine": "aliyun", "category": "language", "gender": "female", "locale": "en-US", "accent": "english",  "emotion": "natural", "speed": "1.0x", "sample_text": "英语女声。"},
    {"key": "harry",      "name": "Harry",  "engine": "aliyun", "category": "language", "gender": "male",   "locale": "en-US", "accent": "english",  "emotion": "natural", "speed": "1.0x", "sample_text": "英语男声。"},
    {"key": "loongbella", "name": "Bella",  "engine": "aliyun", "category": "language", "gender": "female", "locale": "en-US", "accent": "english",  "emotion": "natural", "speed": "1.0x", "sample_text": "CosyVoice 英语女声。"},
    {"key": "clara",      "name": "Clara",  "engine": "aliyun", "category": "language", "gender": "female", "locale": "fr-FR", "accent": "french",   "emotion": "natural", "speed": "1.0x", "sample_text": "法语女声。"},
    {"key": "hanna",      "name": "Hanna",  "engine": "aliyun", "category": "language", "gender": "female", "locale": "de-DE", "accent": "german",   "emotion": "natural", "speed": "1.0x", "sample_text": "德语女声。"},
    {"key": "camila",     "name": "Camila", "engine": "aliyun", "category": "language", "gender": "female", "locale": "es-ES", "accent": "spanish",  "emotion": "natural", "speed": "1.0x", "sample_text": "西班牙语女声。"},
    {"key": "perla",      "name": "Perla",  "engine": "aliyun", "category": "language", "gender": "female", "locale": "it-IT", "accent": "italian",  "emotion": "natural", "speed": "1.0x", "sample_text": "意大利语女声。"},
    {"key": "masha",      "name": "masha",  "engine": "aliyun", "category": "language", "gender": "female", "locale": "ru-RU", "accent": "russian",  "emotion": "natural", "speed": "1.0x", "sample_text": "俄语女声。"},
    # ─── MiniMax 系统预设 (统一莫小X 命名, 用户无感引擎区别) ───
    # 普通话男声
    {"key": "Chinese (Mandarin)_Reliable_Executive",   "name": "莫小稳", "engine": "minimax", "category": "preset", "gender": "male",   "locale": "zh-CN", "accent": "mandarin", "emotion": "natural", "speed": "1.0x", "sample_text": "沉稳高管男声,商业财经。"},
    {"key": "Chinese (Mandarin)_Unrestrained_Young_Man","name": "莫小羁", "engine": "minimax", "category": "preset", "gender": "male",   "locale": "zh-CN", "accent": "mandarin", "emotion": "natural", "speed": "1.0x", "sample_text": "不羁青年,慵懒霸道。"},
    {"key": "Chinese (Mandarin)_Radio_Host",           "name": "莫小台", "engine": "minimax", "category": "preset", "gender": "male",   "locale": "zh-CN", "accent": "mandarin", "emotion": "natural", "speed": "1.0x", "sample_text": "深夜电台男声。"},
    {"key": "Chinese (Mandarin)_Male_Announcer",       "name": "莫小播", "engine": "minimax", "category": "preset", "gender": "male",   "locale": "zh-CN", "accent": "mandarin", "emotion": "natural", "speed": "1.0x", "sample_text": "新闻播报男声。"},
    {"key": "Chinese (Mandarin)_Gentleman",            "name": "莫小润", "engine": "minimax", "category": "preset", "gender": "male",   "locale": "zh-CN", "accent": "mandarin", "emotion": "natural", "speed": "1.0x", "sample_text": "温润绅士男声。"},
    {"key": "Chinese (Mandarin)_Lyrical_Voice",        "name": "莫小抒", "engine": "minimax", "category": "preset", "gender": "male",   "locale": "zh-CN", "accent": "mandarin", "emotion": "natural", "speed": "1.0x", "sample_text": "抒情有感染力男声。"},
    {"key": "Chinese (Mandarin)_Sincere_Adult",        "name": "莫小诚", "engine": "minimax", "category": "preset", "gender": "male",   "locale": "zh-CN", "accent": "mandarin", "emotion": "natural", "speed": "1.0x", "sample_text": "真诚青年男声。"},
    {"key": "Chinese (Mandarin)_Gentle_Youth",         "name": "莫小绅", "engine": "minimax", "category": "preset", "gender": "male",   "locale": "zh-CN", "accent": "mandarin", "emotion": "natural", "speed": "1.0x", "sample_text": "邻家大哥哥,温润青年。"},
    {"key": "Chinese (Mandarin)_Southern_Young_Man",   "name": "莫小南", "engine": "minimax", "category": "preset", "gender": "male",   "locale": "zh-CN", "accent": "mandarin", "emotion": "natural", "speed": "1.0x", "sample_text": "南方口音青年男声。"},
    {"key": "Chinese (Mandarin)_Straightforward_Boy",  "name": "莫小直", "engine": "minimax", "category": "preset", "gender": "male",   "locale": "zh-CN", "accent": "mandarin", "emotion": "natural", "speed": "1.0x", "sample_text": "邻家少年,率真自然。"},
    {"key": "Chinese (Mandarin)_Pure-hearted_Boy",     "name": "莫小澈", "engine": "minimax", "category": "preset", "gender": "male",   "locale": "zh-CN", "accent": "mandarin", "emotion": "natural", "speed": "1.0x", "sample_text": "清澈纯真邻家弟弟。"},
    # 普通话女声
    {"key": "Chinese (Mandarin)_News_Anchor",          "name": "莫小新", "engine": "minimax", "category": "preset", "gender": "female", "locale": "zh-CN", "accent": "mandarin", "emotion": "natural", "speed": "1.0x", "sample_text": "新闻播报女声。"},
    {"key": "Chinese (Mandarin)_Gentle_Senior",        "name": "莫小柔", "engine": "minimax", "category": "preset", "gender": "female", "locale": "zh-CN", "accent": "mandarin", "emotion": "natural", "speed": "1.0x", "sample_text": "温柔学姐,知识科普。"},
    {"key": "Chinese (Mandarin)_Sweet_Lady",           "name": "莫小甜", "engine": "minimax", "category": "preset", "gender": "female", "locale": "zh-CN", "accent": "mandarin", "emotion": "natural", "speed": "1.0x", "sample_text": "甜美邻家亲切感。"},
    {"key": "Chinese (Mandarin)_Warm_Bestie",          "name": "莫小蜜", "engine": "minimax", "category": "preset", "gender": "female", "locale": "zh-CN", "accent": "mandarin", "emotion": "natural", "speed": "1.0x", "sample_text": "温暖闺蜜对话感。"},
    {"key": "Chinese (Mandarin)_Wise_Women",           "name": "莫小阅", "engine": "minimax", "category": "preset", "gender": "female", "locale": "zh-CN", "accent": "mandarin", "emotion": "natural", "speed": "1.0x", "sample_text": "阅历丰富姐姐音。"},
    {"key": "Chinese (Mandarin)_Mature_Woman",         "name": "莫小娇", "engine": "minimax", "category": "preset", "gender": "female", "locale": "zh-CN", "accent": "mandarin", "emotion": "natural", "speed": "1.0x", "sample_text": "傲娇成熟御姐。"},
    {"key": "Chinese (Mandarin)_Warm_Girl",            "name": "莫小暖", "engine": "minimax", "category": "preset", "gender": "female", "locale": "zh-CN", "accent": "mandarin", "emotion": "natural", "speed": "1.0x", "sample_text": "甜美细腻治愈感。"},
    {"key": "Chinese (Mandarin)_Crisp_Girl",           "name": "莫小脆", "engine": "minimax", "category": "preset", "gender": "female", "locale": "zh-CN", "accent": "mandarin", "emotion": "natural", "speed": "1.0x", "sample_text": "清脆甜美治愈亲切。"},
    {"key": "Chinese (Mandarin)_Soft_Girl",            "name": "莫小绒", "engine": "minimax", "category": "preset", "gender": "female", "locale": "zh-CN", "accent": "mandarin", "emotion": "natural", "speed": "1.0x", "sample_text": "柔和清雅少女。"},
    {"key": "Chinese (Mandarin)_Cute_Spirit",          "name": "莫小萌", "engine": "minimax", "category": "preset", "gender": "female", "locale": "zh-CN", "accent": "mandarin", "emotion": "natural", "speed": "1.0x", "sample_text": "软萌稚嫩天真烂漫。"},
    # 粤语
    {"key": "Cantonese_ProfessionalHost(F)",           "name": "莫小港", "engine": "minimax", "category": "dialect", "gender": "female", "locale": "zh-HK", "accent": "cantonese", "emotion": "natural", "speed": "1.0x", "sample_text": "粤语专业女主持。"},
    {"key": "Cantonese_ProfessionalHost(M)",           "name": "莫小阳", "engine": "minimax", "category": "dialect", "gender": "male",   "locale": "zh-HK", "accent": "cantonese", "emotion": "natural", "speed": "1.0x", "sample_text": "粤语专业男主持。"},
    {"key": "Cantonese_GentleLady",                    "name": "莫小怡", "engine": "minimax", "category": "dialect", "gender": "female", "locale": "zh-HK", "accent": "cantonese", "emotion": "natural", "speed": "1.0x", "sample_text": "粤语温柔女声。"},
    {"key": "Cantonese_PlayfulMan",                    "name": "莫小活", "engine": "minimax", "category": "dialect", "gender": "male",   "locale": "zh-HK", "accent": "cantonese", "emotion": "natural", "speed": "1.0x", "sample_text": "粤语活泼男声。"},
    {"key": "Cantonese_CuteGirl",                      "name": "莫小可", "engine": "minimax", "category": "dialect", "gender": "female", "locale": "zh-HK", "accent": "cantonese", "emotion": "natural", "speed": "1.0x", "sample_text": "粤语可爱女孩。"},
    {"key": "Cantonese_KindWoman",                     "name": "莫小善", "engine": "minimax", "category": "dialect", "gender": "female", "locale": "zh-HK", "accent": "cantonese", "emotion": "natural", "speed": "1.0x", "sample_text": "粤语善良女声。"},
    # 多语种 (保留原名, 国际化感)
    {"key": "English_Graceful_Lady",       "name": "Graceful Lady",       "engine": "minimax", "category": "language", "gender": "female", "locale": "en-US", "accent": "english",  "emotion": "natural", "speed": "1.0x", "sample_text": "MiniMax 英语优雅女声。"},
    {"key": "English_Aussie_Bloke",        "name": "Aussie Bloke",        "engine": "minimax", "category": "language", "gender": "male",   "locale": "en-AU", "accent": "english",  "emotion": "natural", "speed": "1.0x", "sample_text": "澳式英语男声,松弛随性。"},
    {"key": "English_Whispering_girl",     "name": "Whispering Girl",     "engine": "minimax", "category": "language", "gender": "female", "locale": "en-US", "accent": "english",  "emotion": "natural", "speed": "1.0x", "sample_text": "ASMR 气声女声。"},
    {"key": "Japanese_IntellectualSenior", "name": "Intellectual Senior", "engine": "minimax", "category": "language", "gender": "male",   "locale": "ja-JP", "accent": "japanese", "emotion": "natural", "speed": "1.0x", "sample_text": "日语知性男声。"},
    {"key": "Japanese_DecisivePrincess",   "name": "Decisive Princess",   "engine": "minimax", "category": "language", "gender": "female", "locale": "ja-JP", "accent": "japanese", "emotion": "natural", "speed": "1.0x", "sample_text": "傲娇严厉日语女声。"},
    {"key": "Japanese_OptimisticYouth",    "name": "Optimistic Youth",    "engine": "minimax", "category": "language", "gender": "male",   "locale": "ja-JP", "accent": "japanese", "emotion": "natural", "speed": "1.0x", "sample_text": "日语阳光青年男声。"},
    {"key": "waan",       "name": "Waan",   "engine": "aliyun", "category": "language", "gender": "female", "locale": "th-TH", "accent": "thai",     "emotion": "natural", "speed": "1.0x", "sample_text": "泰语女声。"},
    {"key": "tien",       "name": "Tien",   "engine": "aliyun", "category": "language", "gender": "female", "locale": "vi-VN", "accent": "vietnamese","emotion": "natural", "speed": "1.0x", "sample_text": "越南语女声。"},
    {"key": "indah",      "name": "Indah",  "engine": "aliyun", "category": "language", "gender": "female", "locale": "id-ID", "accent": "indonesian","emotion": "natural", "speed": "1.0x", "sample_text": "印尼语女声。"},
    {"key": "farah",      "name": "Farah",  "engine": "aliyun", "category": "language", "gender": "female", "locale": "ms-MY", "accent": "malay",    "emotion": "natural", "speed": "1.0x", "sample_text": "马来语女声。"},
    {"key": "tala",       "name": "Tala",   "engine": "aliyun", "category": "language", "gender": "female", "locale": "fil-PH","accent": "filipino", "emotion": "natural", "speed": "1.0x", "sample_text": "菲律宾语女声。"},
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
    conn.execute("""
        CREATE TABLE IF NOT EXISTS digital_human_avatars (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            avatar_key TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            file_path TEXT NOT NULL,
            duration_seconds REAL,
            width INTEGER,
            height INTEGER,
            file_size INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS tts_tasks (
            task_id TEXT PRIMARY KEY,
            user_id INTEGER,
            engine TEXT NOT NULL,
            text TEXT,
            preset_key TEXT,
            speed TEXT,
            status TEXT DEFAULT 'processing',
            progress INTEGER DEFAULT 0,
            audio_url TEXT,
            duration_seconds REAL,
            error_message TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # 用户克隆音色 → MiniMax voice_id 的映射 (懒加载,首次粤语合成时上传 prompt 创建)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS minimax_voice_clones (
            clone_key TEXT PRIMARY KEY,
            minimax_voice_id TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # 只清掉系统预设，保留用户克隆 (category='clone')
    conn.execute("DELETE FROM voice_presets WHERE category != 'clone'")
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
    """系统预设音色（不含用户克隆）"""
    conn = get_db()
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute("""
            SELECT id, key, name, engine, category, gender, locale, accent, emotion, speed, sample_text
            FROM voice_presets
            WHERE is_active = 1 AND category != 'clone'
            ORDER BY category, id
        """).fetchall()
        return {
            "items": [row_to_dict(row) for row in rows],
            "engines": {"preset": "cosyvoice", "clone": "fish-speech"},
        }
    finally:
        conn.close()


MAX_CLONES_PER_USER = 5

@app.get("/api/voice/my-clones")
def get_my_clones():
    """用户克隆音色列表（与系统预设独立）"""
    conn = get_db()
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute("""
            SELECT id, key, name, engine, category, gender, locale, accent, emotion, speed, sample_text, created_at
            FROM voice_presets
            WHERE category = 'clone'
            ORDER BY id DESC
        """).fetchall()
        return {
            "items": [row_to_dict(row) for row in rows],
            "max_count": MAX_CLONES_PER_USER,
            "current_count": len(rows),
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

VOICE_PROMPTS_DIR = r"D:\monoi-server\models\cosyvoice\voice_prompts"

@app.post("/api/voice/upload-clone")
async def upload_clone(
    file: UploadFile = File(...),
    clone_name: str = Form("我的声音"),
    transcript: str = Form(""),
    gender: str = Form("female"),
    user_id: Optional[int] = Form(None),
):
    """用户上传录音作为 CosyVoice2 克隆的 prompt 音频"""
    import shutil
    import uuid as _uuid
    import time as _t

    if not clone_name.strip():
        clone_name = "我的声音"
    os.makedirs(VOICE_PROMPTS_DIR, exist_ok=True)

    # 检查克隆数量上限
    conn0 = get_db()
    try:
        count = conn0.execute("SELECT COUNT(*) FROM voice_presets WHERE category = 'clone'").fetchone()[0]
    finally:
        conn0.close()
    if count >= MAX_CLONES_PER_USER:
        raise HTTPException(400, f"已达上限：最多保留 {MAX_CLONES_PER_USER} 个克隆音色，请先删除一个再上传")

    clone_key = f"clone_{int(_t.time())}_{_uuid.uuid4().hex[:6]}"
    raw_path = os.path.join(tempfile.gettempdir(), f"{clone_key}_raw")
    wav_path = os.path.join(VOICE_PROMPTS_DIR, f"{clone_key}.wav")
    txt_path = os.path.join(VOICE_PROMPTS_DIR, f"{clone_key}.txt")

    # 保存上传文件
    try:
        with open(raw_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
    except Exception as e:
        raise HTTPException(500, f"保存上传文件失败: {e}")

    # 用 ffmpeg 转成 16kHz 单声道 wav（CosyVoice2 prompt 标准格式）
    try:
        result = subprocess.run(
            ["ffmpeg", "-y", "-i", raw_path, "-ar", "16000", "-ac", "1", "-f", "wav", wav_path],
            capture_output=True, timeout=60,
        )
        if result.returncode != 0:
            err_msg = result.stderr.decode("utf-8", errors="ignore")[-500:]
            raise HTTPException(400, f"音频转换失败: {err_msg}")
    except FileNotFoundError:
        raise HTTPException(500, "服务器未安装 ffmpeg")
    except subprocess.TimeoutExpired:
        raise HTTPException(408, "音频转换超时")
    finally:
        if os.path.exists(raw_path):
            try: os.unlink(raw_path)
            except: pass

    # 保存对应的文案
    if transcript.strip():
        try:
            with open(txt_path, "w", encoding="utf-8") as f:
                f.write(transcript.strip())
        except Exception:
            pass

    # 写数据库（voice_clones + voice_presets）
    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO voice_clones (user_id, clone_name, engine, accent, status, sample_text) VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, clone_name, "cosyvoice", "mandarin", "ready", transcript[:200] if transcript else ""),
        )
        conn.execute(
            "INSERT INTO voice_presets (key, name, engine, category, gender, locale, accent, emotion, speed, sample_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (clone_key, clone_name, "cosyvoice", "clone", gender, "zh-CN", "mandarin", "natural", "1.0x", "我的克隆声音。"),
        )
        conn.commit()
    finally:
        conn.close()

    return {"success": True, "clone_key": clone_key, "name": clone_name}


@app.delete("/api/voice/clone/{clone_key}")
def delete_clone(clone_key: str):
    """删除一个克隆音色"""
    import re as _re
    safe_key = _re.sub(r"[^a-zA-Z0-9_]", "", clone_key)
    if not safe_key.startswith("clone_"):
        raise HTTPException(400, "只能删除克隆音色")
    wav_path = os.path.join(VOICE_PROMPTS_DIR, f"{safe_key}.wav")
    txt_path = os.path.join(VOICE_PROMPTS_DIR, f"{safe_key}.txt")
    preview_path = os.path.join(VOICE_PREVIEW_DIR, f"{safe_key}.wav")
    for p in (wav_path, txt_path, preview_path):
        if os.path.exists(p):
            try: os.unlink(p)
            except: pass
    conn = get_db()
    try:
        conn.execute("DELETE FROM voice_presets WHERE key = ?", (safe_key,))
        conn.commit()
    finally:
        conn.close()
    return {"success": True}


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

VOICE_SERVER_URL = "http://127.0.0.1:9001"   # CosyVoice2 (莫小本)
INDEX_SERVER_URL = "http://127.0.0.1:9002"   # IndexTTS-2 (用户克隆)

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

def _detect_text_language(text: str) -> str:
    """检测文本主要语种. 返回: zh / ja / ko / en / cantonese"""
    import re as _re
    if not text:
        return "zh"

    # 日文假名 (片假名 + 平假名)
    if _re.search(r"[぀-ゟ゠-ヿ]", text):
        return "ja"

    # 韩文
    if _re.search(r"[가-힯]", text):
        return "ko"

    # 英文 (拉丁字母明显多于中文字符)
    latin = len(_re.findall(r"[a-zA-Z]", text))
    chinese = len(_re.findall(r"[一-鿿]", text))
    if latin > 30 and chinese < latin * 0.2:
        return "en"

    # 粤语 (高辨识度方言字, 出现 2+ 个就判定为粤语)
    cantonese_markers = ["係", "嘅", "咁", "唔", "嗰", "嘢", "畀", "邊度", "點解", "我哋", "佢哋", "啲", "冇"]
    cantonese_hits = sum(1 for m in cantonese_markers if m in text)
    if cantonese_hits >= 2:
        return "cantonese"

    return "zh"


def _lookup_preset_engine(preset_key: str, target_text: Optional[str] = None):
    """从 voice_presets 表里查 engine. 用户克隆音色根据目标文本语种智能选引擎:
    - 普通话 → IndexTTS-2 (中文音质天花板)
    - 日/韩/英 → CosyVoice2 (cross_lingual, 实测日语 OK)
    - 粤语 → 不支持克隆, 走 indextts 兜底但实际会在 synthesize_voice 入口直接拒绝
    """
    if not preset_key:
        return None
    conn = get_db()
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute("SELECT engine, category FROM voice_presets WHERE key = ?", (preset_key,)).fetchone()
        if not row:
            return None
        if row["category"] == "clone":
            if target_text:
                lang = _detect_text_language(target_text)
                if lang in ("ja", "ko", "en"):
                    return "cosyvoice"
            return "indextts"
        return row["engine"]
    finally:
        conn.close()


# ============== TTS 任务异步执行 (indextts / cosyvoice 通用) ==============
# 同步等待 indextts 推理 (71-189 秒) 会被 NATAPP 隧道 idle timeout (~120s) 切断,
# 改成"提交立即返回 task_id, 后台线程跑, 前端轮询 task 状态"模式, 跟阿里云预设统一.

def _create_tts_task(engine: str, text: str, preset_key: Optional[str], speed: Optional[str], user_id: Optional[int] = None) -> str:
    """新建一条 tts 任务, 返回 task_id"""
    import uuid as _uuid
    import time as _t
    task_id = f"local_{int(_t.time())}_{_uuid.uuid4().hex[:8]}"
    conn = get_db()
    try:
        conn.execute(
            """INSERT INTO tts_tasks (task_id, user_id, engine, text, preset_key, speed)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (task_id, user_id, engine, text, preset_key, speed),
        )
        conn.commit()
    finally:
        conn.close()
    return task_id


def _update_tts_task(task_id: str, **fields) -> None:
    """更新任务字段, updated_at 自动刷新"""
    if not fields:
        return
    cols = ", ".join(f"{k} = ?" for k in fields)
    vals = list(fields.values())
    conn = get_db()
    try:
        conn.execute(
            f"UPDATE tts_tasks SET {cols}, updated_at = CURRENT_TIMESTAMP WHERE task_id = ?",
            vals + [task_id],
        )
        conn.commit()
    finally:
        conn.close()


def _run_tts_task(task_id: str, server_url: str, payload: dict, audio_url_path_prefix: str, server_label: str) -> None:
    """通用后台任务: POST 到本地推理服务器, 把结果写回 task 表"""
    import requests as _req
    try:
        # 进程内 → 进程内调用, 不受 NATAPP 限制. 给 10 分钟兜底.
        resp = _req.post(server_url, json=payload, timeout=600)
        if resp.status_code != 200:
            _update_tts_task(
                task_id,
                status="failed",
                error_message=f"{server_label} 错误: {resp.status_code} {resp.text[:200]}",
            )
            return
        data = resp.json()
        if not data.get("file"):
            _update_tts_task(
                task_id,
                status="failed",
                error_message=f"{server_label} 没返回 file 字段: {str(data)[:200]}",
            )
            return
        _update_tts_task(
            task_id,
            status="ready",
            audio_url=f"{audio_url_path_prefix}/{data['file']}",
            duration_seconds=data.get("duration_seconds") or 0,
            progress=100,
        )
    except _req.exceptions.ConnectionError:
        _update_tts_task(task_id, status="failed", error_message=f"{server_label} 未启动")
    except _req.exceptions.Timeout:
        _update_tts_task(task_id, status="failed", error_message=f"{server_label} 超时 (>10 分钟)")
    except Exception as e:
        _update_tts_task(task_id, status="failed", error_message=f"合成失败: {type(e).__name__}: {e}")


# ============== MiniMax T2A (粤语克隆 + 系统预设) ==============
MINIMAX_API_KEY = os.environ.get("MINIMAX_API_KEY", "")
MINIMAX_GROUP_ID = os.environ.get("MINIMAX_GROUP_ID", "")
MINIMAX_API_BASE = os.environ.get("MINIMAX_API_BASE", "https://api.minimax.io/v1")
MINIMAX_MODEL = os.environ.get("MINIMAX_MODEL", "speech-02-turbo")  # turbo 便宜实时, hd 更高音质
MINIMAX_OUTPUT_DIR = "minimax-outputs"
os.makedirs(MINIMAX_OUTPUT_DIR, exist_ok=True)


def _minimax_t2a_sync(text: str, voice_id: str, speed: float = 1.0) -> dict:
    """调 MiniMax T2A 同步合成. 返回 {file, path, duration_seconds}"""
    import requests as _req
    if not MINIMAX_API_KEY or not MINIMAX_GROUP_ID:
        raise RuntimeError("MiniMax 未配置 (需设置 MINIMAX_API_KEY + MINIMAX_GROUP_ID 环境变量)")

    headers = {
        "Authorization": f"Bearer {MINIMAX_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": MINIMAX_MODEL,
        "text": text,
        "stream": False,
        "voice_setting": {
            "voice_id": voice_id,
            "speed": float(speed),
            "vol": 1.0,
            "pitch": 0,
        },
        "audio_setting": {
            "sample_rate": 32000,
            "bitrate": 128000,
            "format": "wav",
            "channel": 1,
        },
    }
    url = f"{MINIMAX_API_BASE}/t2a_v2?GroupId={MINIMAX_GROUP_ID}"
    resp = _req.post(url, json=payload, headers=headers, timeout=120)
    if resp.status_code != 200:
        raise RuntimeError(f"MiniMax HTTP {resp.status_code}: {resp.text[:200]}")

    data = resp.json()
    base = data.get("base_resp") or {}
    if base.get("status_code") not in (0, None):
        raise RuntimeError(f"MiniMax 业务错误: {base.get('status_msg')}")

    audio_hex = (data.get("data") or {}).get("audio")
    if not audio_hex:
        raise RuntimeError(f"MiniMax 没返回 audio: {str(data)[:300]}")

    audio_bytes = bytes.fromhex(audio_hex)
    import uuid as _uuid
    out_name = f"minimax_{int(time.time()*1000)}_{_uuid.uuid4().hex[:6]}.wav"
    out_path = os.path.join(MINIMAX_OUTPUT_DIR, out_name)
    with open(out_path, "wb") as f:
        f.write(audio_bytes)

    extra = data.get("extra_info") or {}
    return {
        "file": out_name,
        "path": out_path,
        "duration_seconds": (extra.get("audio_length") or 0) / 1000.0,
    }


def _minimax_create_clone(audio_file_path: str, voice_id_to_use: Optional[str] = None) -> str:
    """上传 prompt 音频到 MiniMax 创建语音复刻, 返回 voice_id (创建后首次合成时扣 9.9 元)"""
    import requests as _req
    import uuid as _uuid
    if not MINIMAX_API_KEY or not MINIMAX_GROUP_ID:
        raise RuntimeError("MiniMax 未配置")

    if not voice_id_to_use:
        voice_id_to_use = f"monoi_clone_{int(time.time())}_{_uuid.uuid4().hex[:6]}"

    headers = {"Authorization": f"Bearer {MINIMAX_API_KEY}"}

    # 1. 上传文件 → 拿 file_id
    upload_url = f"{MINIMAX_API_BASE}/files/upload?GroupId={MINIMAX_GROUP_ID}"
    with open(audio_file_path, "rb") as f:
        files = {"file": (os.path.basename(audio_file_path), f, "audio/wav")}
        data = {"purpose": "voice_clone"}
        resp = _req.post(upload_url, headers=headers, files=files, data=data, timeout=60)
    if resp.status_code != 200:
        raise RuntimeError(f"MiniMax 上传失败 HTTP {resp.status_code}: {resp.text[:200]}")
    fdata = resp.json()
    file_id = (fdata.get("file") or {}).get("file_id")
    if not file_id:
        raise RuntimeError(f"MiniMax 没返回 file_id: {str(fdata)[:300]}")

    # 2. 创建克隆
    clone_url = f"{MINIMAX_API_BASE}/voice_clone?GroupId={MINIMAX_GROUP_ID}"
    headers2 = {**headers, "Content-Type": "application/json"}
    payload = {
        "file_id": file_id,
        "voice_id": voice_id_to_use,
        "need_noise_reduction": False,
    }
    resp = _req.post(clone_url, json=payload, headers=headers2, timeout=60)
    if resp.status_code != 200:
        raise RuntimeError(f"MiniMax 克隆失败 HTTP {resp.status_code}: {resp.text[:200]}")
    result = resp.json()
    base = result.get("base_resp") or {}
    if base.get("status_code") not in (0, None):
        raise RuntimeError(f"MiniMax 克隆业务错误: {base.get('status_msg')}")

    return voice_id_to_use


def _get_or_create_minimax_voice_id(clone_key: str) -> str:
    """查 minimax_voice_clones 缓存, 没有就上传 prompt 创建. 返回 MiniMax voice_id"""
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT minimax_voice_id FROM minimax_voice_clones WHERE clone_key = ?", (clone_key,)
        ).fetchone()
        if row and row[0]:
            return row[0]
    finally:
        conn.close()

    # 没有 → 上传创建
    prompt_wav = os.path.join(VOICE_PROMPTS_DIR, f"{clone_key}.wav")
    if not os.path.exists(prompt_wav):
        raise RuntimeError(f"找不到克隆 prompt 文件: {prompt_wav}")

    minimax_voice_id = _minimax_create_clone(prompt_wav)

    conn = get_db()
    try:
        conn.execute(
            "INSERT OR REPLACE INTO minimax_voice_clones (clone_key, minimax_voice_id) VALUES (?, ?)",
            (clone_key, minimax_voice_id),
        )
        conn.commit()
    finally:
        conn.close()

    return minimax_voice_id


def _run_minimax_t2a_task(task_id: str, text: str, voice_id: str, speed: float) -> None:
    """MiniMax T2A 后台任务 (跟 _run_tts_task 同模式, 但 endpoint/payload 不同)"""
    try:
        result = _minimax_t2a_sync(text, voice_id, speed)
        _update_tts_task(
            task_id,
            status="ready",
            audio_url=f"/api/voice/audio-minimax/{result['file']}",
            duration_seconds=result["duration_seconds"],
            progress=100,
        )
    except Exception as e:
        _update_tts_task(task_id, status="failed", error_message=f"MiniMax: {e}")


@app.post("/api/voice/synthesize")
def synthesize_voice(req: VoiceSynthesizeRequest):
    import requests as _req

    if not req.text.strip():
        raise HTTPException(400, "text 不能为空")
    if not req.preset_key and not req.clone_id:
        raise HTTPException(400, "preset_key 和 clone_id 至少要传一个")

    # 拒绝: 克隆音色 + 粤语. 引导用户改用粤语预设音色.
    if req.preset_key:
        _conn = get_db()
        _conn.row_factory = sqlite3.Row
        try:
            _row = _conn.execute("SELECT category FROM voice_presets WHERE key = ?", (req.preset_key,)).fetchone()
        finally:
            _conn.close()
        if _row and _row["category"] == "clone":
            if _detect_text_language(req.text) == "cantonese":
                raise HTTPException(
                    400,
                    "粤语暂不支持克隆音色。建议改用粤语预设音色: "
                    "莫小琳 / 莫小珊 / 莫小桃 / 莫小佳 / "
                    "莫小港 / 莫小阳 / 莫小怡 / 莫小活 / 莫小可 / 莫小善"
                )

    # 按 preset 的 engine 字段决定走哪条路 (克隆音色还会根据目标文本语种智能选)
    engine = _lookup_preset_engine(req.preset_key, req.text) or ("cosyvoice" if req.preset_key else "fish-speech")

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

    # ─── IndexTTS-2（用户克隆，异步任务） ───
    if engine == "indextts":
        import threading as _th
        task_id = _create_tts_task("indextts", req.text.strip(), req.preset_key, req.speed or "1.0x")
        _th.Thread(
            target=_run_tts_task,
            args=(
                task_id,
                f"{INDEX_SERVER_URL}/synthesize",
                {"text": req.text.strip(), "voice_id": req.preset_key, "speed": parse_speed(req.speed)},
                "/api/voice/audio-index",
                "index-server (9002)",
            ),
            daemon=True,
        ).start()
        return {
            "success": True,
            "status": "queued",
            "engine": "indextts",
            "task_id": task_id,
            "preset_key": req.preset_key,
            "speed": req.speed or "1.0x",
        }

    # ─── CosyVoice2（莫小本/克隆跨语言 等，异步任务） ───
    if engine == "cosyvoice":
        import threading as _th
        text = req.text.strip()
        # 检测语种, 决定 voice-server 的推理模式
        # zh → zero_shot (同语种克隆, 需要 prompt text 帮 BPE)
        # 其他 → cross_lingual (跨语言克隆, 中文样本能念日韩英)
        lang = _detect_text_language(text)
        mode = "cross_lingual" if lang != "zh" else "zero_shot"
        task_id = _create_tts_task("cosyvoice", text, req.preset_key, req.speed or "1.0x")
        _th.Thread(
            target=_run_tts_task,
            args=(
                task_id,
                f"{VOICE_SERVER_URL}/synthesize",
                {
                    "text": text,
                    "voice_id": req.preset_key,
                    "speed": parse_speed(req.speed),
                    "mode": mode,
                },
                "/api/voice/audio",
                "voice-server (9001)",
            ),
            daemon=True,
        ).start()
        return {
            "success": True,
            "status": "queued",
            "engine": "cosyvoice",
            "task_id": task_id,
            "preset_key": req.preset_key,
            "speed": req.speed or "1.0x",
            "lang": lang,
            "mode": mode,
        }

    # ─── MiniMax (粤语克隆 + MiniMax 系统预设, 异步任务) ───
    if engine == "minimax":
        import threading as _th
        text = req.text.strip()

        # 用户克隆 → 取/创建 MiniMax voice_id; 系统预设 → preset_key 直接是 MiniMax voice_id
        try:
            if req.preset_key and req.preset_key.startswith("clone_"):
                minimax_voice_id = _get_or_create_minimax_voice_id(req.preset_key)
            else:
                minimax_voice_id = req.preset_key
        except Exception as e:
            raise HTTPException(500, f"MiniMax 音色获取失败: {e}")

        task_id = _create_tts_task("minimax", text, req.preset_key, req.speed or "1.0x")
        _th.Thread(
            target=_run_minimax_t2a_task,
            args=(task_id, text, minimax_voice_id, parse_speed(req.speed)),
            daemon=True,
        ).start()
        return {
            "success": True,
            "status": "queued",
            "engine": "minimax",
            "task_id": task_id,
            "preset_key": req.preset_key,
            "speed": req.speed or "1.0x",
        }

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
    """查询合成任务状态. 本地任务 (indextts/cosyvoice) 优先, 没有则当阿里云任务查."""
    # 1. 先查本地 tts_tasks 表 (indextts / cosyvoice)
    conn = get_db()
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute(
            "SELECT * FROM tts_tasks WHERE task_id = ?", (task_id,)
        ).fetchone()
    finally:
        conn.close()

    if row:
        d = dict(row)
        if d["status"] == "ready":
            return {
                "status": "ready",
                "audio_url": d["audio_url"],
                "duration_seconds": d.get("duration_seconds") or 0,
                "engine": d.get("engine"),
            }
        if d["status"] == "failed":
            return {
                "status": "error",
                "message": d.get("error_message") or "合成失败",
                "engine": d.get("engine"),
            }
        return {
            "status": "processing",
            "progress": d.get("progress") or 0,
            "engine": d.get("engine"),
        }

    # 2. 本地没找到 → 当作阿里云任务
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
        # 阿里云 OSS 返回 http://, 但前端在 HTTPS 页面 fetch 会被 mixed-content block
        if isinstance(audio_url, str) and audio_url.startswith("http://"):
            audio_url = "https://" + audio_url[len("http://"):]
        return {"status": "ready", "audio_url": audio_url, "duration_seconds": duration, "engine": "aliyun"}

    if status_text in ("RUNNING", "QUEUEING") or status_text == "":
        return {"status": "processing", "task_status": status_text or "UNKNOWN", "engine": "aliyun", "raw": str(data)[:400]}

    error_msg = data.get("error_message") or data.get("message") or status_text
    return {"status": "error", "message": error_msg, "engine": "aliyun", "raw": str(data)[:400]}


VOICE_PREVIEW_DIR = "voice-previews"
os.makedirs(VOICE_PREVIEW_DIR, exist_ok=True)

# 每种 accent/locale 用对应语言的 demo 文本
PREVIEW_TEXTS = {
    "mandarin":  "你好，我是 monoi 的配音助手，欢迎来到我们的产品",
    "cantonese": "你好，我係 monoi 嘅配音助手，歡迎嚟到我哋嘅產品",
    "sichuan":   "你好嘞，我是 monoi 的配音助手，欢迎来到咱们的产品",
    "northeast": "嗨呀，俺是 monoi 的配音助手，欢迎来到咱们的产品",
    "tianjin":   "哎，介就是 monoi 配音助手，欢迎您嘞",
    "taiwanese": "你好啦，我是 monoi 配音助手，欢迎来到我们的产品哦",
    "hunan":     "你好咯，咱是 monoi 配音助手，欢迎来到咱们的产品",
    "japanese":  "こんにちは、monoi の音声アシスタントです。よろしくお願いします",
    "english":   "Hello, I am the monoi voice assistant, welcome to our product",
    "korean":    "안녕하세요, monoi 음성 도우미입니다. 환영합니다",
    "french":    "Bonjour, je suis l'assistant vocal monoi, bienvenue",
    "german":    "Hallo, ich bin der monoi-Sprachassistent, willkommen",
    "spanish":   "Hola, soy el asistente de voz monoi, bienvenido",
    "italian":   "Ciao, sono l'assistente vocale monoi, benvenuto",
    "russian":   "Привет, я голосовой помощник monoi, добро пожаловать",
    "thai":      "สวัสดี ฉันคือผู้ช่วยเสียง monoi ยินดีต้อนรับ",
    "vietnamese":"Xin chào, tôi là trợ lý giọng nói monoi, chào mừng",
    "indonesian":"Halo, saya asisten suara monoi, selamat datang",
    "malay":     "Halo, saya pembantu suara monoi, selamat datang",
    "filipino":  "Kumusta, ako ang voice assistant ng monoi, maligayang pagdating",
}


_PREVIEW_GENERATING = set()  # 当前正在后台生成的 voice keys


def _preview_filename(voice_key: str) -> str:
    """voice_key 转成安全的文件名 (去掉空格/括号等, 防 Windows 文件名问题)"""
    return hashlib.md5(voice_key.encode("utf-8")).hexdigest()


def _generate_preview_in_background(safe_key: str, demo_text: str, engine: str):
    """后台任务：合成并保存试听音频"""
    import time as _t
    import requests as _req
    import shutil as _shutil
    # 文件名要去掉特殊字符 (Windows 不让 voice 名含空格括号当文件名也行,但更稳用 md5)
    cache_path = os.path.join(VOICE_PREVIEW_DIR, f"{_preview_filename(safe_key)}.wav")
    try:
        if engine == "minimax":
            # MiniMax T2A 同步合成, 把 wav 复制到 preview 缓存目录
            result = _minimax_t2a_sync(demo_text, safe_key, 1.0)
            _shutil.copy(result["path"], cache_path)
            print(f"[preview] {safe_key} 缓存完成 (minimax)", flush=True)
            return

        if engine in ("cosyvoice", "indextts"):
            # 本地推理
            server_url = INDEX_SERVER_URL if engine == "indextts" else VOICE_SERVER_URL
            resp = _req.post(
                f"{server_url}/synthesize",
                json={"text": demo_text, "voice_id": safe_key, "speed": 1.0},
                timeout=180,
            )
            if resp.status_code != 200:
                print(f"[preview] {safe_key} {engine} server 错误 {resp.status_code}", flush=True)
                return
            data = resp.json()
            file_name = data.get("file")
            if not file_name:
                return
            r = _req.get(f"{server_url}/audio/{file_name}", timeout=30)
            if r.status_code == 200:
                with open(cache_path, "wb") as f:
                    f.write(r.content)
                print(f"[preview] {safe_key} 缓存完成（{engine}）", flush=True)
            return

        # 阿里云
        task_id = aliyun_submit_long_tts(demo_text, voice=safe_key, speech_rate=0)
        audio_url = None
        for _ in range(40):  # 最多 80 秒
            _t.sleep(2)
            data = aliyun_get_task(task_id)
            body = data.get("data") or {}
            audio_url = body.get("audio_address")
            if audio_url:
                break
        if not audio_url:
            print(f"[preview] {safe_key} 合成超时", flush=True)
            return
        r = _req.get(audio_url, timeout=30)
        if r.status_code == 200:
            with open(cache_path, "wb") as f:
                f.write(r.content)
            print(f"[preview] {safe_key} 缓存完成（aliyun）", flush=True)
        else:
            print(f"[preview] {safe_key} 下载失败 {r.status_code}", flush=True)
    except Exception as e:
        print(f"[preview] {safe_key} 错误: {e}", flush=True)
    finally:
        _PREVIEW_GENERATING.discard(safe_key)


@app.get("/api/voice/preview/{voice_key}")
def voice_preview(voice_key: str, background_tasks: BackgroundTasks):
    """每个音色的试听 demo（异步生成 + 磁盘缓存）"""
    from fastapi.responses import FileResponse, JSONResponse

    # 阻止路径穿越 (..)  其他字符 (空格/括号/中文/连字符) 都允许 — MiniMax voice_id 有这些
    if not voice_key or ".." in voice_key or "/" in voice_key or "\\" in voice_key:
        raise HTTPException(400, "无效 voice_key")
    safe_key = voice_key
    cache_path = os.path.join(VOICE_PREVIEW_DIR, f"{_preview_filename(safe_key)}.wav")

    # 已缓存 → 直接返回音频
    if os.path.exists(cache_path) and os.path.getsize(cache_path) > 1024:
        return FileResponse(cache_path, media_type="audio/wav")

    # 没缓存 → 触发后台生成（如果还没在生成中）
    if safe_key not in _PREVIEW_GENERATING:
        conn = get_db()
        conn.row_factory = sqlite3.Row
        try:
            row = conn.execute("SELECT * FROM voice_presets WHERE key = ?", (safe_key,)).fetchone()
        finally:
            conn.close()
        if not row:
            raise HTTPException(404, f"音色 {safe_key} 不存在")
        accent = row["accent"] or "mandarin"
        demo_text = PREVIEW_TEXTS.get(accent, PREVIEW_TEXTS["mandarin"])
        # 用户克隆走 IndexTTS
        engine = "indextts" if row["category"] == "clone" else (row["engine"] or "aliyun")
        _PREVIEW_GENERATING.add(safe_key)
        background_tasks.add_task(_generate_preview_in_background, safe_key, demo_text, engine)

    # 立刻返回 202，前端轮询
    return JSONResponse({"status": "generating"}, status_code=202)


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


@app.post("/api/voice/clean-narration")
async def clean_narration(file: UploadFile = File(...), reference_text: str = Form("")):
    """转发到 voice-server 处理录音清洗"""
    import requests as _req

    try:
        files = {"file": (file.filename, await file.read(), file.content_type or "audio/wav")}
        data = {"reference_text": reference_text}
        resp = _req.post(f"{VOICE_SERVER_URL}/clean-narration", files=files, data=data, timeout=300)
        if resp.status_code != 200:
            raise HTTPException(resp.status_code, f"voice-server 错误: {resp.text[:200]}")
        result = resp.json()
        # 把 voice-server 内部 path 改写成 main.py 可代理的路径
        if result.get("source_file"):
            result["audio_url_path"] = f"/api/voice/narration-audio/{result['source_file']}"
        return result
    except _req.exceptions.ConnectionError:
        raise HTTPException(503, "voice-server (9001) 未启动")


class FinalizeNarrationRequest(BaseModel):
    source_file: str
    keep_ranges: list[list[float]]


@app.post("/api/voice/finalize-narration")
def finalize_narration_proxy(req: FinalizeNarrationRequest):
    """转发到 voice-server"""
    import requests as _req
    try:
        resp = _req.post(
            f"{VOICE_SERVER_URL}/finalize-narration",
            json={"source_file": req.source_file, "keep_ranges": req.keep_ranges},
            timeout=180,
        )
        if resp.status_code != 200:
            raise HTTPException(resp.status_code, f"voice-server 错误: {resp.text[:200]}")
        result = resp.json()
        if result.get("file"):
            result["audio_url_path"] = f"/api/voice/narration-audio/{result['file']}"
        return result
    except _req.exceptions.ConnectionError:
        raise HTTPException(503, "voice-server (9001) 未启动")


@app.get("/api/voice/narration-audio/{name}")
def proxy_narration_audio(name: str):
    """代理清洗后的录音文件"""
    import requests as _req
    from fastapi.responses import StreamingResponse

    safe = os.path.basename(name)
    try:
        resp = _req.get(f"{VOICE_SERVER_URL}/narration/{safe}", stream=True, timeout=30)
        if resp.status_code != 200:
            raise HTTPException(resp.status_code, "音频未找到")
        return StreamingResponse(resp.iter_content(8192), media_type="audio/wav")
    except _req.exceptions.ConnectionError:
        raise HTTPException(503, "voice-server (9001) 未启动")


# ============== 口播视频剪辑代理 (转发到 voice-server) ==============


@app.post("/api/voice/clean-narration-video")
async def clean_narration_video_proxy(file: UploadFile = File(...)):
    """转发到 voice-server: 上传视频 → 转录 → 返回 video_url + 词级 segments"""
    import requests as _req

    raw = await file.read()
    try:
        files = {"file": (file.filename or "video.mp4", raw, file.content_type or "video/mp4")}
        resp = _req.post(f"{VOICE_SERVER_URL}/clean-narration-video", files=files, timeout=900)
        if resp.status_code != 200:
            raise HTTPException(resp.status_code, f"voice-server 错误: {resp.text[:200]}")
        result = resp.json()
        # 改写视频路径为 main.py 代理路径 (让前端能通过 NATAPP 访问)
        if result.get("source_file"):
            result["video_url_path"] = f"/api/voice/narration-video/{result['source_file']}"
        return result
    except _req.exceptions.ConnectionError:
        raise HTTPException(503, "voice-server (9001) 未启动")


class FinalizeNarrationVideoRequest(BaseModel):
    source_file: str
    keep_ranges: list[list[float]]


@app.post("/api/voice/finalize-narration-video")
def finalize_narration_video_proxy(req: FinalizeNarrationVideoRequest):
    """转发到 voice-server: 接 keep_ranges → 剪视频"""
    import requests as _req
    try:
        resp = _req.post(
            f"{VOICE_SERVER_URL}/finalize-narration-video",
            json={"source_file": req.source_file, "keep_ranges": req.keep_ranges},
            timeout=900,
        )
        if resp.status_code != 200:
            raise HTTPException(resp.status_code, f"voice-server 错误: {resp.text[:200]}")
        result = resp.json()
        if result.get("file"):
            result["video_url_path"] = f"/api/voice/narration-video/{result['file']}"
        return result
    except _req.exceptions.ConnectionError:
        raise HTTPException(503, "voice-server (9001) 未启动")


@app.get("/api/voice/narration-video/{name}")
def proxy_narration_video(name: str):
    """代理剪辑后的视频文件"""
    import requests as _req
    from fastapi.responses import StreamingResponse

    safe = os.path.basename(name)
    try:
        resp = _req.get(f"{VOICE_SERVER_URL}/narration-video/{safe}", stream=True, timeout=60)
        if resp.status_code != 200:
            raise HTTPException(resp.status_code, "视频未找到")
        return StreamingResponse(resp.iter_content(8192), media_type="video/mp4")
    except _req.exceptions.ConnectionError:
        raise HTTPException(503, "voice-server (9001) 未启动")


@app.get("/api/voice/audio-index/{name}")
def proxy_audio_index(name: str):
    """IndexTTS 输出音频代理"""
    import requests as _req
    from fastapi.responses import StreamingResponse

    safe = os.path.basename(name)
    try:
        resp = _req.get(f"{INDEX_SERVER_URL}/audio/{safe}", stream=True, timeout=30)
        if resp.status_code != 200:
            raise HTTPException(resp.status_code, "音频未找到")
        return StreamingResponse(resp.iter_content(8192), media_type="audio/wav")
    except _req.exceptions.ConnectionError:
        raise HTTPException(503, "index-server (9002) 未启动")


@app.get("/api/voice/audio-minimax/{name}")
def proxy_audio_minimax(name: str):
    """MiniMax 输出音频代理 (文件直接存在 main.py 同进程的 minimax-outputs/)"""
    from fastapi.responses import FileResponse
    safe = os.path.basename(name)
    file_path = os.path.join(MINIMAX_OUTPUT_DIR, safe)
    if not os.path.exists(file_path):
        raise HTTPException(404, "音频未找到")
    return FileResponse(file_path, media_type="audio/wav", filename=safe)


# ============== 数字人 (Duix-Avatar / HeyGem) ==============
DUIX_API_BASE = "http://127.0.0.1:8383/easy"
DUIX_DATA_DIR = r"D:\monoi-server\heygem-data\face2face\temp"
DUIX_AVATAR_DIR = r"D:\monoi-server\heygem-data\avatars"
MAX_AVATARS_PER_USER = 5
os.makedirs(DUIX_DATA_DIR, exist_ok=True)
os.makedirs(DUIX_AVATAR_DIR, exist_ok=True)


def _duix_cleanup(*paths: str) -> None:
    for p in paths:
        if p and os.path.exists(p):
            try:
                os.remove(p)
            except Exception:
                pass


def _probe_video_meta(path: str) -> dict:
    """用 ffprobe 取分辨率 / 时长. 失败返回空字典."""
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error", "-select_streams", "v:0",
                "-show_entries", "stream=width,height:format=duration",
                "-of", "json", path,
            ],
            capture_output=True, timeout=20,
        )
        if result.returncode != 0:
            return {}
        import json as _json
        info = _json.loads(result.stdout.decode("utf-8", errors="ignore"))
        out: dict = {}
        if info.get("streams"):
            stream = info["streams"][0]
            if stream.get("width"):
                out["width"] = stream["width"]
            if stream.get("height"):
                out["height"] = stream["height"]
        if info.get("format", {}).get("duration"):
            try:
                out["duration_seconds"] = float(info["format"]["duration"])
            except (KeyError, ValueError):
                pass
        return out
    except (FileNotFoundError, subprocess.TimeoutExpired, Exception):
        return {}


@app.get("/api/digital-human/avatars")
def list_avatars(user_id: Optional[int] = None):
    """列出已保存的数字人形象 (最多 5 个)"""
    conn = get_db()
    conn.row_factory = sqlite3.Row
    try:
        if user_id is None:
            rows = conn.execute(
                "SELECT * FROM digital_human_avatars ORDER BY id DESC LIMIT 50"
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM digital_human_avatars WHERE user_id = ? ORDER BY id DESC LIMIT 50",
                (user_id,),
            ).fetchall()
        items = []
        for row in rows:
            d = row_to_dict(row)
            d["file_url"] = f"/api/digital-human/avatars/{d['avatar_key']}/file"
            items.append(d)
        return {
            "items": items,
            "count": len(items),
            "max_count": MAX_AVATARS_PER_USER,
        }
    finally:
        conn.close()


@app.post("/api/digital-human/avatars")
async def upload_avatar(
    file: UploadFile = File(...),
    name: str = Form("我的形象"),
    user_id: Optional[int] = Form(None),
):
    """上传形象视频, 保存为可复用的 avatar"""
    import shutil
    import uuid as _uuid
    import time as _t

    name = name.strip() or "我的形象"

    # 检查上限
    conn0 = get_db()
    try:
        if user_id is None:
            count = conn0.execute(
                "SELECT COUNT(*) FROM digital_human_avatars"
            ).fetchone()[0]
        else:
            count = conn0.execute(
                "SELECT COUNT(*) FROM digital_human_avatars WHERE user_id = ?",
                (user_id,),
            ).fetchone()[0]
    finally:
        conn0.close()
    if count >= MAX_AVATARS_PER_USER:
        raise HTTPException(
            400,
            f"已达上限: 最多保留 {MAX_AVATARS_PER_USER} 个数字人形象, 请先删除一个再上传",
        )

    avatar_key = f"avatar_{int(_t.time())}_{_uuid.uuid4().hex[:6]}"
    file_path = os.path.join(DUIX_AVATAR_DIR, f"{avatar_key}.mp4")

    try:
        with open(file_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
    except Exception as e:
        if os.path.exists(file_path):
            try: os.remove(file_path)
            except: pass
        raise HTTPException(500, f"保存上传文件失败: {e}")

    meta = _probe_video_meta(file_path)
    file_size = os.path.getsize(file_path)

    conn = get_db()
    try:
        conn.execute(
            """INSERT INTO digital_human_avatars
               (user_id, avatar_key, name, file_path, duration_seconds, width, height, file_size)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                user_id,
                avatar_key,
                name,
                file_path,
                meta.get("duration_seconds"),
                meta.get("width"),
                meta.get("height"),
                file_size,
            ),
        )
        conn.commit()
    finally:
        conn.close()

    return {
        "success": True,
        "avatar_key": avatar_key,
        "name": name,
        "duration_seconds": meta.get("duration_seconds"),
        "width": meta.get("width"),
        "height": meta.get("height"),
        "file_size": file_size,
        "file_url": f"/api/digital-human/avatars/{avatar_key}/file",
    }


@app.delete("/api/digital-human/avatars/{avatar_key}")
def delete_avatar(avatar_key: str):
    """删除一个数字人形象"""
    import re as _re
    safe_key = _re.sub(r"[^a-zA-Z0-9_]", "", avatar_key)
    if not safe_key.startswith("avatar_"):
        raise HTTPException(400, "avatar_key 格式错误")
    file_path = os.path.join(DUIX_AVATAR_DIR, f"{safe_key}.mp4")
    if os.path.exists(file_path):
        try: os.remove(file_path)
        except: pass
    conn = get_db()
    try:
        conn.execute(
            "DELETE FROM digital_human_avatars WHERE avatar_key = ?", (safe_key,)
        )
        conn.commit()
    finally:
        conn.close()
    return {"success": True}


@app.get("/api/digital-human/avatars/{avatar_key}/file")
def serve_avatar_file(avatar_key: str):
    """提供形象视频文件 (用于前端预览/试播)"""
    from fastapi.responses import FileResponse
    import re as _re
    safe_key = _re.sub(r"[^a-zA-Z0-9_]", "", avatar_key)
    file_path = os.path.join(DUIX_AVATAR_DIR, f"{safe_key}.mp4")
    if not os.path.exists(file_path):
        raise HTTPException(404, "形象视频未找到")
    return FileResponse(file_path, media_type="video/mp4")


@app.post("/api/digital-human/submit")
def submit_digital_human(
    audio: UploadFile = File(...),
    avatar_key: str = Form(...),
):
    """用已保存的形象 + 上传的音频提交数字人对口型. 返回 code, 前端轮询 /task/{code}"""
    import requests as _req
    import shutil
    import uuid as _uuid
    import re as _re

    safe_key = _re.sub(r"[^a-zA-Z0-9_]", "", avatar_key)
    if not safe_key.startswith("avatar_"):
        raise HTTPException(400, "avatar_key 格式错误")

    avatar_path = os.path.join(DUIX_AVATAR_DIR, f"{safe_key}.mp4")
    if not os.path.exists(avatar_path):
        raise HTTPException(404, "形象不存在, 请重新选择")

    code = _uuid.uuid4().hex[:16]
    audio_name = f"{code}_audio.wav"
    video_name = f"{code}_video.mp4"
    audio_path = os.path.join(DUIX_DATA_DIR, audio_name)
    video_path = os.path.join(DUIX_DATA_DIR, video_name)

    try:
        with open(audio_path, "wb") as f:
            f.write(audio.file.read())
        # HeyGem 只认 /code/data/temp/ 下的文件, 把 avatar 复制过去
        shutil.copyfile(avatar_path, video_path)
    except Exception as e:
        _duix_cleanup(audio_path, video_path)
        raise HTTPException(500, f"准备文件失败: {e}")

    payload = {
        "audio_url": audio_name,
        "video_url": video_name,
        "code": code,
        "chaofen": 0,
        "watermark_switch": 0,
        "pn": 1,
    }

    try:
        resp = _req.post(f"{DUIX_API_BASE}/submit", json=payload, timeout=30)
        if resp.status_code != 200:
            _duix_cleanup(audio_path, video_path)
            raise HTTPException(resp.status_code, f"数字人服务错误: {resp.text[:200]}")
        data = resp.json()
        if not data.get("success"):
            _duix_cleanup(audio_path, video_path)
            raise HTTPException(500, data.get("msg") or "提交任务失败")
        return {"success": True, "code": code, "submit_response": data}
    except _req.exceptions.ConnectionError:
        _duix_cleanup(audio_path, video_path)
        raise HTTPException(503, "数字人服务 (8383) 未启动")


@app.get("/api/digital-human/task/{code}")
def query_digital_human(code: str):
    """轮询数字人任务状态. status: processing/completed/failed"""
    import requests as _req

    try:
        resp = _req.get(f"{DUIX_API_BASE}/query", params={"code": code}, timeout=10)
        if resp.status_code != 200:
            raise HTTPException(resp.status_code, f"查询失败: {resp.text[:200]}")
        data = resp.json()
    except _req.exceptions.ConnectionError:
        raise HTTPException(503, "数字人服务 (8383) 未启动")

    inner = data.get("data") or {}
    status = inner.get("status")

    if status == 2:
        result = (inner.get("result") or "").lstrip("/").lstrip("\\")
        return {
            "success": True,
            "status": "completed",
            "progress": 100,
            "video_url": f"/api/digital-human/video/{result}",
            "duration_ms": inner.get("video_duration"),
            "width": inner.get("width"),
            "height": inner.get("height"),
        }
    if status == 1:
        return {
            "success": True,
            "status": "processing",
            "progress": inner.get("progress", 0),
            "msg": inner.get("msg", ""),
        }
    if status == 3:
        return {
            "success": False,
            "status": "failed",
            "msg": inner.get("msg") or "任务失败",
        }
    return {"success": False, "status": "unknown", "raw": data}


@app.get("/api/digital-human/video/{name}")
def serve_digital_human_video(name: str):
    """提供数字人输出视频文件"""
    from fastapi.responses import FileResponse

    safe = os.path.basename(name)  # 防路径穿越
    file_path = os.path.join(DUIX_DATA_DIR, safe)
    if not os.path.exists(file_path):
        raise HTTPException(404, "视频未找到")
    return FileResponse(file_path, media_type="video/mp4")
