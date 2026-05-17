from __future__ import annotations
from typing import Optional
from fastapi import FastAPI, HTTPException, Query, BackgroundTasks, UploadFile, File, Form, Request
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

# CORS 严格化: 只允许我们自己的域名 (env 覆盖 ALLOWED_ORIGINS 逗号分隔, 不配走默认列表)
_DEFAULT_ALLOWED_ORIGINS = [
    "https://monoi.cn",
    "https://www.monoi.cn",
    "https://monoi-cn.vercel.app",
    "http://localhost:5173",   # vite dev
    "http://localhost:5175",   # vite preview
]
_env_origins = os.getenv('ALLOWED_ORIGINS', '').strip()
ALLOWED_ORIGINS = [o.strip() for o in _env_origins.split(',') if o.strip()] if _env_origins else _DEFAULT_ALLOWED_ORIGINS
print(f"[cors] 允许 origins: {ALLOWED_ORIGINS}", flush=True)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Real-IP", "X-Forwarded-For"],
)

# JWT 签名 key, 必须从 env 读 (硬编码会被 git 暴露). 兼容老的默认值, 但启动会警告
SECRET_KEY = os.getenv('JWT_SECRET_KEY') or "monoi-secret-key-2025"
if SECRET_KEY == "monoi-secret-key-2025":
    print("[security] ⚠️  JWT_SECRET_KEY 未配置, 用默认硬编码 key (生产环境必须配 32+ 位随机字符串)", flush=True)
else:
    print(f"[security] JWT_SECRET_KEY 从 env 读取 ({len(SECRET_KEY)} 字符)", flush=True)
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
    # 给已有 users 表加 phone / avatar_oss_key / is_admin (老 schema 兼容, ALTER 失败说明列已存在)
    for col_def in [
        "ALTER TABLE users ADD COLUMN phone TEXT",
        "ALTER TABLE users ADD COLUMN avatar_oss_key TEXT",
        "ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0",
    ]:
        try:
            conn.execute(col_def)
        except sqlite3.OperationalError:
            pass  # 列已存在
    # 短信验证码表 (mock 模式存 6 位随机, 5 分钟过期)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS sms_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phone TEXT NOT NULL,
            code TEXT NOT NULL,
            purpose TEXT NOT NULL DEFAULT 'register',
            created_at REAL NOT NULL,
            expires_at REAL NOT NULL,
            used INTEGER DEFAULT 0
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sms_codes_phone ON sms_codes(phone, created_at DESC)")
    # 老 schema 兼容: 给 sms_codes 加 client_ip 列 (按 IP 限流, 防脚本批量烧短信费)
    try:
        conn.execute("ALTER TABLE sms_codes ADD COLUMN client_ip TEXT")
    except sqlite3.OperationalError:
        pass  # 列已存在
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sms_codes_ip ON sms_codes(client_ip, created_at DESC)")
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

# 安全模块 (登录锁定 + 限流 + admin 白名单)
import security
security.init_login_attempts_table()

# 商业化模块 (会员/积分/推广)
import billing
billing.init_billing_tables()
app.include_router(billing.router)
app.include_router(billing.referral_router)

# 管理员后台
import admin
app.include_router(admin.router)

# 支付集成 (微信 v1, 支付宝 stub)
try:
    import wxpay as _wxpay
    _WXPAY_REAL = _wxpay.is_configured()
except Exception as _e:
    _WXPAY_REAL = False
    print(f"[wxpay] 模块加载失败, 走 mock: {_e}", flush=True)
try:
    import alipay as _alipay
    _ALIPAY_REAL = _alipay.is_configured()
except Exception as _e:
    _ALIPAY_REAL = False
if _WXPAY_REAL:
    print("[wxpay] mode = REAL (微信商户)", flush=True)
else:
    try:
        _missing = _wxpay.missing_env_vars()
        print(f"[wxpay] mode = MOCK (15s 后自动支付) — 缺 env: {_missing}", flush=True)
    except Exception:
        print("[wxpay] mode = MOCK (15s 后自动支付)", flush=True)
print(f"[alipay] mode = {'REAL' if _ALIPAY_REAL else 'OFF (商户审核中)'}", flush=True)


class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str
    phone: str                                # 必填手机号 (中国格式 11 位)
    sms_code: str                             # 6 位短信验证码
    referral_code: Optional[str] = None       # 可选: 推广码

class SendSmsRequest(BaseModel):
    phone: str
    purpose: str = 'register'                 # register / reset_password / rebind_phone / login
    captcha_verify_param: Optional[str] = None  # 阿里云 Captcha 2.0 滑块完成后前端 SDK 返回的字符串

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

import random
import time as _time

# 短信验证码: env 齐了走阿里云真发送, 没齐 (开发期) 走 mock 控制台打印
# 想强制 mock (即使 env 齐了) 设环境变量 SMS_FORCE_MOCK=1
try:
    import sms_aliyun as _sms_aliyun
    _SMS_REAL_ENABLED = _sms_aliyun.is_configured()
except Exception as _e:
    _SMS_REAL_ENABLED = False
    print(f"[sms] aliyun 模块加载失败, 走 mock: {_e}", flush=True)

SMS_MOCK_MODE = (os.getenv('SMS_FORCE_MOCK') == '1') or not _SMS_REAL_ENABLED
SMS_CODE_TTL_SECONDS = 5 * 60
SMS_RESEND_COOLDOWN = 60
# IP 限流: 同一个 IP 1 小时内最多发 SMS_IP_LIMIT_PER_HOUR 次, 防脚本批量烧短信费 (¥0.045/条)
SMS_IP_WINDOW_SECONDS = 3600
SMS_IP_LIMIT_PER_HOUR = int(os.getenv('SMS_IP_LIMIT_PER_HOUR', '5'))

# 阿里云人机验证 (Captcha 2.0): env 齐了 send-sms 必须先过滑块, 没齐 (开发期) skip 校验
try:
    import captcha_aliyun as _captcha_aliyun
    _CAPTCHA_ENABLED = _captcha_aliyun.is_configured()
except Exception as _e:
    _CAPTCHA_ENABLED = False
    print(f"[captcha] aliyun 模块加载失败, 跳过校验: {_e}", flush=True)

print(f"[sms] mode = {'MOCK (控制台打印)' if SMS_MOCK_MODE else 'REAL (阿里云)'}", flush=True)
print(f"[captcha] mode = {'REAL (阿里云人机验证)' if _CAPTCHA_ENABLED else 'OFF (env 没配, send-sms 不强制滑块)'}", flush=True)


def _client_ip_from_request(request: Request) -> str:
    """优先从 X-Forwarded-For 拿真实 IP (Vercel + NATAPP 两层代理后, request.client.host 是上游 IP).
    取最左边的 (即真实客户端 IP). 取不到 fallback 到 request.client.host."""
    xff = request.headers.get('x-forwarded-for') or request.headers.get('x-real-ip') or ''
    if xff:
        return xff.split(',')[0].strip()
    return (request.client.host if request.client else '') or 'unknown'


def _validate_phone(phone: str) -> bool:
    """中国手机号 1xxxxxxxxxx"""
    return bool(phone and len(phone) == 11 and phone.startswith('1') and phone.isdigit())


def _gen_sms_code() -> str:
    return f"{random.randint(0, 999999):06d}"


@app.post("/api/send-sms")
def send_sms_code(req: SendSmsRequest, request: Request):
    """发送短信验证码. mock 模式下: 控制台 print + 响应返回 dev_code 字段方便测试.
    防滥用按 "免费 → 花钱" 顺序检查, 攻击者撞前面任一关卡都不会让阿里云扣钱:
      ① 手机号格式 (代码, 0)
      ② 同手机号 60s 冷却 (查 SQLite, 0)
      ③ 同 IP 1 小时上限 (查 SQLite, 0)
      ④ 阿里云人机验证 (¥0.001/次, 走到这才花钱)
      ⑤ 阿里云发短信 (¥0.045/次, 最贵, 最后)"""
    if not _validate_phone(req.phone):
        raise HTTPException(400, "手机号格式不对, 需要 11 位数字以 1 开头")
    if req.purpose not in ('register', 'reset_password', 'rebind_phone', 'login'):
        raise HTTPException(400, f"未知用途: {req.purpose}")

    client_ip = _client_ip_from_request(request)
    now = _time.time()
    conn = get_db()

    # ② 频率限制: 同手机号 60s 内只能发一次
    recent = conn.execute(
        "SELECT created_at FROM sms_codes WHERE phone = ? ORDER BY created_at DESC LIMIT 1",
        (req.phone,)
    ).fetchone()
    if recent and now - recent[0] < SMS_RESEND_COOLDOWN:
        wait = int(SMS_RESEND_COOLDOWN - (now - recent[0]))
        conn.close()
        raise HTTPException(429, f"请求过频, {wait} 秒后再试")

    # ③ 频率限制: 同 IP 1 小时内最多 SMS_IP_LIMIT_PER_HOUR 次
    ip_count_row = conn.execute(
        "SELECT COUNT(*) FROM sms_codes WHERE client_ip = ? AND created_at > ?",
        (client_ip, now - SMS_IP_WINDOW_SECONDS),
    ).fetchone()
    if ip_count_row and ip_count_row[0] >= SMS_IP_LIMIT_PER_HOUR:
        conn.close()
        print(f"[sms] IP 限流命中 ip={client_ip} count={ip_count_row[0]} (window={SMS_IP_WINDOW_SECONDS}s)", flush=True)
        raise HTTPException(429, "该网络段请求次数过多, 请 1 小时后再试")

    # ④ 阿里云人机验证: env 配了就强制要 token + 校验; 没配 (开发期) skip
    # 故意放在 ②③ 之后, 让 IP 限流先挡掉脚本攻击, 避免被刷 ¥0.001/次的 verify 调用
    if _CAPTCHA_ENABLED:
        if not req.captcha_verify_param:
            conn.close()
            raise HTTPException(400, "请先完成滑块验证")
        ok, err = _captcha_aliyun.verify(req.captcha_verify_param)
        if not ok:
            conn.close()
            raise HTTPException(403, f"人机验证未通过: {err}")

    code = _gen_sms_code()
    conn.execute("""
        INSERT INTO sms_codes (phone, code, purpose, created_at, expires_at, used, client_ip)
        VALUES (?, ?, ?, ?, ?, 0, ?)
    """, (req.phone, code, req.purpose, now, now + SMS_CODE_TTL_SECONDS, client_ip))
    conn.commit()
    conn.close()

    if SMS_MOCK_MODE:
        # 开发模式: 控制台打印 + 响应里返 dev_code 方便测试
        print(f"[sms-mock] {req.phone} 收到验证码: {code} (用途: {req.purpose}, 5 分钟有效)", flush=True)
        return {"success": True, "message": "验证码已发送 (mock 模式)", "dev_code": code}

    # 真发送: 调阿里云 SDK
    ok, err = _sms_aliyun.send_sms_code(req.phone, code, req.purpose)
    if not ok:
        # 真发送失败 fallback: 控制台打印 code + 报错给前端
        print(f"[sms-real] 发送失败 {req.phone}: {err} | code={code} (本地仍能验, 但用户收不到)", flush=True)
        raise HTTPException(500, f"短信发送失败: {err}")
    print(f"[sms-real] 已发送给 {req.phone} (用途: {req.purpose})", flush=True)
    return {"success": True, "message": "验证码已发送, 5 分钟内有效"}


def _verify_sms_code(phone: str, code: str, purpose: str) -> bool:
    """验证短信验证码. 验过即标记 used = 1."""
    conn = get_db()
    now = _time.time()
    row = conn.execute("""
        SELECT id FROM sms_codes
        WHERE phone = ? AND code = ? AND purpose = ?
          AND used = 0 AND expires_at >= ?
        ORDER BY created_at DESC LIMIT 1
    """, (phone, code, purpose, now)).fetchone()
    if not row:
        conn.close()
        return False
    conn.execute("UPDATE sms_codes SET used = 1 WHERE id = ?", (row[0],))
    conn.commit()
    conn.close()
    return True


@app.post("/api/register")
def register(req: RegisterRequest):
    if len(req.username) < 2:
        raise HTTPException(400, "用户名至少 2 个字符")
    if len(req.password) < 6:
        raise HTTPException(400, "密码至少 6 位")
    if not _validate_phone(req.phone):
        raise HTTPException(400, "手机号格式不对")
    if not _verify_sms_code(req.phone, req.sms_code, 'register'):
        raise HTTPException(400, "验证码错误或已过期")

    # 邮箱统一小写 + 去空格, 避免登录时大小写不匹配
    email_norm = (req.email or '').strip().lower()

    conn = get_db()
    try:
        # 手机号唯一性 (用代码强制, ALTER ADD COLUMN 没法加 UNIQUE 约束)
        existing = conn.execute("SELECT id FROM users WHERE phone = ?", (req.phone,)).fetchone()
        if existing:
            raise HTTPException(400, "手机号已注册")
        hashed = hash_password(req.password)
        cursor = conn.execute(
            "INSERT INTO users (username, email, password, phone) VALUES (?, ?, ?, ?)",
            (req.username, email_norm, hashed, req.phone)
        )
        new_user_id = cursor.lastrowid
        conn.commit()
    except sqlite3.IntegrityError:
        raise HTTPException(400, "用户名或邮箱已存在")
    finally:
        conn.close()

    # 第一个注册的用户自动是 admin (创业期方便, 后续上线该删掉)
    if new_user_id == 1:
        conn = get_db()
        conn.execute("UPDATE users SET is_admin = 1 WHERE id = 1")
        conn.commit()
        conn.close()
        print(f"[register] user_id=1 自动设为 admin", flush=True)

    # 商业化: 给新用户建推广员状态 (拿到推广码) + 绑定推广关系 + 50 体验积分
    try:
        billing.ensure_referrer_status(new_user_id)
        if req.referral_code:
            billing.bind_referrer(new_user_id, req.referral_code.strip().upper())
        billing.add_credits(new_user_id, FREE_PLAN_INIT_CREDITS, 'subscription_grant',
                             feature='free_signup', to_monthly=False)
    except Exception as e:
        print(f"[register] billing 初始化失败 user={new_user_id}: {e}", flush=True)

    return {"success": True, "message": "注册成功"}


FREE_PLAN_INIT_CREDITS = 50    # 免费用户注册一次性送的积分

@app.post("/api/login")
def login(req: LoginRequest, request: Request):
    # 邮箱大小写不敏感
    email_norm = (req.email or '').strip().lower()
    client_ip = _client_ip_from_request(request)
    # 失败锁定 (security 模块挂了就跳过, 不影响登录主流程)
    try:
        security.guard_login(email_norm)
    except HTTPException:
        raise   # 锁定错误正常抛
    except Exception as e:
        print(f"[security] guard_login 异常, 跳过锁检查: {e}", flush=True)
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT id, username, password FROM users WHERE LOWER(email) = ?",
            (email_norm,)
        ).fetchone()
        if not row:
            try: security.record_login_attempt(email_norm, client_ip, success=False)
            except Exception as e: print(f"[security] record_login_attempt 失败: {e}", flush=True)
            raise HTTPException(404, "该邮箱未注册")
        if not verify_password(req.password, row[2]):
            try: security.record_login_attempt(email_norm, client_ip, success=False)
            except Exception as e: print(f"[security] record_login_attempt 失败: {e}", flush=True)
            raise HTTPException(401, "密码错误")
        try: security.record_login_attempt(email_norm, client_ip, success=True)
        except Exception as e: print(f"[security] record_login_attempt 失败: {e}", flush=True)
        token = create_token(row[0], row[1])
        return {"success": True, "token": token, "username": row[1]}
    finally:
        conn.close()


class LoginSmsRequest(BaseModel):
    phone: str
    sms_code: str


@app.post("/api/login-sms")
def login_sms(req: LoginSmsRequest, request: Request):
    """手机号 + 短信验证码登录 (mock 模式下 sms_code 跟发送时的 dev_code 一致)"""
    if not _validate_phone(req.phone):
        raise HTTPException(400, "手机号格式不对")
    client_ip = _client_ip_from_request(request)
    try:
        security.guard_login(req.phone)
    except HTTPException:
        raise
    except Exception as e:
        print(f"[security] guard_login 异常 (sms), 跳过: {e}", flush=True)
    if not _verify_sms_code(req.phone, req.sms_code, 'login'):
        try: security.record_login_attempt(req.phone, client_ip, success=False)
        except Exception as e: print(f"[security] record err: {e}", flush=True)
        raise HTTPException(401, "验证码错误或已过期")
    conn = get_db()
    try:
        row = conn.execute("SELECT id, username FROM users WHERE phone = ?", (req.phone,)).fetchone()
        if not row:
            try: security.record_login_attempt(req.phone, client_ip, success=False)
            except Exception as e: print(f"[security] record err: {e}", flush=True)
            raise HTTPException(404, "手机号未注册, 请先注册账号")
        try: security.record_login_attempt(req.phone, client_ip, success=True)
        except Exception as e: print(f"[security] record err: {e}", flush=True)
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


def _user_id_from_request(request) -> int:
    """从 Authorization Bearer 解 user_id (JWT). 失败抛 401."""
    auth = request.headers.get('authorization') or request.headers.get('Authorization') or ''
    if not auth.startswith('Bearer '):
        raise HTTPException(401, '未登录')
    token = auth[7:]
    try:
        data = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return int(data['sub'])
    except Exception:
        raise HTTPException(401, '无效或过期的 token')


@app.get("/api/me")
def get_me(request: Request):
    """当前用户基础信息 (用户名/邮箱/手机/头像/注册时间/admin 标记)."""
    user_id = _user_id_from_request(request)
    conn = get_db()
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT id, username, email, phone, avatar_oss_key, is_admin, created_at FROM users WHERE id = ?",
        (user_id,)
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, '用户不存在')
    d = dict(row)
    # 头像签名 URL (avatar_oss_key 是裸 key, 签 6 小时 GET URL 给前端)
    if d.get('avatar_oss_key'):
        try:
            from oss_helper import oss_sign_get
            d['avatar_url'] = oss_sign_get(d['avatar_oss_key'], expires=6 * 3600)
        except Exception:
            d['avatar_url'] = ''
    else:
        d['avatar_url'] = ''
    # 手机号脱敏 (前 3 + 后 4)
    if d.get('phone'):
        p = d['phone']
        d['phone_masked'] = p[:3] + '****' + p[-4:] if len(p) == 11 else p
    else:
        d['phone_masked'] = ''
    return d


class UpdateProfileRequest(BaseModel):
    username: Optional[str] = None
    avatar_oss_key: Optional[str] = None


@app.post("/api/me/update")
def update_profile(req: UpdateProfileRequest, request: Request):
    """改用户名 / 头像. 邮箱手机号走单独的换绑流程."""
    user_id = _user_id_from_request(request)
    updates = []
    params = []
    if req.username is not None:
        if len(req.username) < 2:
            raise HTTPException(400, "用户名至少 2 个字符")
        updates.append("username = ?")
        params.append(req.username)
    if req.avatar_oss_key is not None:
        updates.append("avatar_oss_key = ?")
        params.append(req.avatar_oss_key)
    if not updates:
        raise HTTPException(400, "没有需要更新的字段")
    params.append(user_id)
    conn = get_db()
    try:
        conn.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", params)
        conn.commit()
    except sqlite3.IntegrityError:
        raise HTTPException(400, "用户名已被占用")
    finally:
        conn.close()
    return {"success": True}


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


@app.post("/api/me/change-password")
def change_password(req: ChangePasswordRequest, request: Request):
    user_id = _user_id_from_request(request)
    if len(req.new_password) < 6:
        raise HTTPException(400, "新密码至少 6 位")
    conn = get_db()
    try:
        row = conn.execute("SELECT password FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row or not verify_password(req.old_password, row[0]):
            raise HTTPException(400, "原密码错误")
        new_hash = hash_password(req.new_password)
        conn.execute("UPDATE users SET password = ? WHERE id = ?", (new_hash, user_id))
        conn.commit()
    finally:
        conn.close()
    return {"success": True, "message": "密码已修改"}


class RebindPhoneRequest(BaseModel):
    new_phone: str
    new_phone_code: str        # 新手机号收到的验证码
    old_phone_code: str        # 旧手机号收到的验证码 (双因素, 防被盗)


@app.post("/api/me/rebind-phone")
def rebind_phone(req: RebindPhoneRequest, request: Request):
    user_id = _user_id_from_request(request)
    if not _validate_phone(req.new_phone):
        raise HTTPException(400, "新手机号格式不对")
    conn = get_db()
    row = conn.execute("SELECT phone FROM users WHERE id = ?", (user_id,)).fetchone()
    old_phone = row[0] if row else None
    conn.close()

    # 验证两个验证码
    if not _verify_sms_code(req.new_phone, req.new_phone_code, 'rebind_phone'):
        raise HTTPException(400, "新手机验证码错误或已过期")
    if old_phone and not _verify_sms_code(old_phone, req.old_phone_code, 'rebind_phone'):
        raise HTTPException(400, "旧手机验证码错误或已过期")

    # 检查新手机号未被其他用户占用
    conn = get_db()
    existing = conn.execute(
        "SELECT id FROM users WHERE phone = ? AND id != ?", (req.new_phone, user_id)
    ).fetchone()
    if existing:
        conn.close()
        raise HTTPException(400, "新手机号已被其他账号绑定")
    conn.execute("UPDATE users SET phone = ? WHERE id = ?", (req.new_phone, user_id))
    conn.commit()
    conn.close()
    return {"success": True, "message": "手机号已换绑"}

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


NARRATION_OUTPUT_DIR = r"D:\monoi-server\models\cosyvoice\narration_outputs"


@app.get("/api/voice/narration-audio/{name}")
def proxy_narration_audio(name: str):
    """剪辑后的录音文件 (直接读 voice-server 输出目录, FileResponse 自动支持 HTTP Range)"""
    from fastapi.responses import FileResponse
    safe = os.path.basename(name)
    file_path = os.path.join(NARRATION_OUTPUT_DIR, safe)
    if not os.path.exists(file_path):
        raise HTTPException(404, "音频未找到")
    return FileResponse(file_path, media_type="audio/wav")


# ============== OSS 直传签名 (浏览器 → OSS, 绕开 NATAPP) ==============


class OssSignUploadRequest(BaseModel):
    filename: str = "video.mp4"
    content_type: str = "video/mp4"


@app.post("/api/oss/sign-upload")
def oss_sign_upload(req: OssSignUploadRequest):
    """生成 OSS PUT 签名 URL. 前端用这个 URL 直接 PUT 文件到 OSS,
    不再走 NATAPP. 拿到 oss_key 后再调 clean-narration-video."""
    from oss_helper import oss_make_upload_key, oss_sign_put, oss_is_configured
    if not oss_is_configured():
        raise HTTPException(503, "OSS 未配置, 请在 .env 设 OSS_ENDPOINT/OSS_BUCKET/OSS_ACCESS_KEY_ID/OSS_ACCESS_KEY_SECRET")
    oss_key = oss_make_upload_key(req.filename, prefix="uploads")
    put_url = oss_sign_put(oss_key, content_type=req.content_type, expires=3600)
    return {
        "oss_key": oss_key,
        "put_url": put_url,
        "content_type": req.content_type,
        "expires_in": 3600,
    }


# ============== 口播视频剪辑代理 (转发到 voice-server) ==============


class CleanNarrationVideoOssRequest(BaseModel):
    oss_key: str
    filename: Optional[str] = "video.mp4"


@app.post("/api/voice/clean-narration-video-oss")
def clean_narration_video_oss_proxy(req: CleanNarrationVideoOssRequest):
    """OSS 模式 (推荐): 浏览器已直传到 OSS, 这里转发 oss_key 给 voice-server,
    voice-server 从 OSS 拉源 → 处理 → 上传输出 → 返回 OSS 签名 GET URL."""
    import requests as _req
    try:
        resp = _req.post(
            f"{VOICE_SERVER_URL}/clean-narration-video-oss",
            json={"oss_key": req.oss_key, "filename": req.filename or "video.mp4"},
            timeout=1800,
        )
        if resp.status_code != 200:
            raise HTTPException(resp.status_code, f"voice-server 错误: {resp.text[:200]}")
        return resp.json()
    except _req.exceptions.ConnectionError:
        raise HTTPException(503, "voice-server (9001) 未启动")


@app.post("/api/voice/clean-narration-video")
async def clean_narration_video_proxy(file: UploadFile = File(...)):
    """旧 NATAPP 模式 (兼容 OSS 没配的情况): multipart 转发到 voice-server."""
    import requests as _req

    raw = await file.read()
    try:
        files = {"file": (file.filename or "video.mp4", raw, file.content_type or "video/mp4")}
        resp = _req.post(f"{VOICE_SERVER_URL}/clean-narration-video", files=files, timeout=900)
        if resp.status_code != 200:
            raise HTTPException(resp.status_code, f"voice-server 错误: {resp.text[:200]}")
        result = resp.json()
        if result.get("source_file"):
            result["video_url_path"] = f"/api/voice/narration-video/{result['source_file']}"
        return result
    except _req.exceptions.ConnectionError:
        raise HTTPException(503, "voice-server (9001) 未启动")


class FinalizeNarrationVideoRequest(BaseModel):
    source_file: Optional[str] = None       # 旧: 本地文件名
    source_oss_key: Optional[str] = None    # 新: OSS 上 clean 阶段保留的源 key
    keep_ranges: list[list[float]]


@app.post("/api/voice/finalize-narration-video")
def finalize_narration_video_proxy(req: FinalizeNarrationVideoRequest):
    """转发到 voice-server: 接 keep_ranges → 剪视频. OSS 模式下输出也存 OSS, 直接返签名 URL."""
    import requests as _req
    try:
        # OSS 模式
        if req.source_oss_key:
            resp = _req.post(
                f"{VOICE_SERVER_URL}/finalize-narration-video-oss",
                json={"source_oss_key": req.source_oss_key, "keep_ranges": req.keep_ranges},
                timeout=1800,
            )
            if resp.status_code != 200:
                raise HTTPException(resp.status_code, f"voice-server 错误: {resp.text[:200]}")
            return resp.json()
        # 旧的本地模式
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


@app.get("/api/voice/cover-font-file/{filename}")
def cover_font_file_proxy(filename: str):
    """转发: 字体文件 (前端 FontFace API 加载)"""
    import requests as _req
    from fastapi.responses import StreamingResponse
    safe = os.path.basename(filename)
    try:
        resp = _req.get(f"{VOICE_SERVER_URL}/cover-font-file/{safe}", stream=True, timeout=60)
        if resp.status_code != 200:
            raise HTTPException(resp.status_code, '字体文件未找到')
        media = 'font/otf' if safe.lower().endswith('.otf') else 'font/ttf'
        return StreamingResponse(resp.iter_content(8192), media_type=media,
                                  headers={'Cache-Control': 'public, max-age=2592000'})
    except _req.exceptions.ConnectionError:
        raise HTTPException(503, "voice-server (9001) 未启动")


@app.get("/api/voice/cover-fonts")
def cover_fonts_proxy():
    """转发: 列出 server 可用字体"""
    import requests as _req
    try:
        resp = _req.get(f"{VOICE_SERVER_URL}/cover-fonts", timeout=10)
        if resp.status_code != 200:
            raise HTTPException(resp.status_code, f"voice-server 错误: {resp.text[:200]}")
        return resp.json()
    except _req.exceptions.ConnectionError:
        raise HTTPException(503, "voice-server (9001) 未启动")


@app.post("/api/voice/generate-cover")
def generate_cover_proxy(req: dict):
    """转发到 voice-server: 截帧 + 模板叠字生成多比例封面"""
    import requests as _req
    try:
        resp = _req.post(f"{VOICE_SERVER_URL}/generate-cover", json=req, timeout=300)
        if resp.status_code != 200:
            raise HTTPException(resp.status_code, f"voice-server 错误: {resp.text[:300]}")
        return resp.json()
    except _req.exceptions.ConnectionError:
        raise HTTPException(503, "voice-server (9001) 未启动")


@app.post("/api/voice/compose-footage")
def compose_footage_proxy(req: dict):
    """转发到 voice-server: 合成 口播 + b-roll + PIP overlay → 成品 mp4"""
    import requests as _req
    try:
        resp = _req.post(
            f"{VOICE_SERVER_URL}/compose-footage",
            json=req,
            timeout=1800,
        )
        if resp.status_code != 200:
            raise HTTPException(resp.status_code, f"voice-server 错误: {resp.text[:300]}")
        return resp.json()
    except _req.exceptions.ConnectionError:
        raise HTTPException(503, "voice-server (9001) 未启动")


@app.post("/api/voice/compose-jianying-draft")
def compose_jianying_draft_proxy(req: dict):
    """转发到 voice-server: 拼剪映草稿 zip + 上传 OSS 返签名 URL"""
    import requests as _req
    try:
        resp = _req.post(f"{VOICE_SERVER_URL}/compose-jianying-draft", json=req, timeout=900)
        if resp.status_code != 200:
            raise HTTPException(resp.status_code, f"voice-server 错误: {resp.text[:300]}")
        return resp.json()
    except _req.exceptions.ConnectionError:
        raise HTTPException(503, "voice-server (9001) 未启动")


@app.post("/api/voice/remove-vocals")
async def remove_vocals_proxy(request: Request):
    """转发到 voice-server: demucs 去人声. multipart 文件上传, 透传 body + content-type."""
    import requests as _req
    body = await request.body()
    content_type = request.headers.get('content-type', 'application/octet-stream')
    try:
        resp = _req.post(
            f"{VOICE_SERVER_URL}/remove-vocals",
            data=body,
            headers={'Content-Type': content_type},
            timeout=900,    # 15 min, 长歌 CPU 模式可能要
        )
        if resp.status_code != 200:
            raise HTTPException(resp.status_code, f"voice-server 错误: {resp.text[:300]}")
        return resp.json()
    except _req.exceptions.ConnectionError:
        raise HTTPException(503, "voice-server (9001) 未启动")


@app.post("/api/voice/trim-audio")
def trim_audio_proxy(req: dict):
    """转发到 voice-server: ffmpeg 裁剪音频"""
    import requests as _req
    try:
        resp = _req.post(f"{VOICE_SERVER_URL}/trim-audio", json=req, timeout=180)
        if resp.status_code != 200:
            raise HTTPException(resp.status_code, f"voice-server 错误: {resp.text[:300]}")
        return resp.json()
    except _req.exceptions.ConnectionError:
        raise HTTPException(503, "voice-server (9001) 未启动")


@app.get("/api/voice/bgm-library")
def bgm_library_proxy():
    """转发到 voice-server: 内置商用 BGM 库列表 (登录用户可访问)"""
    import requests as _req
    try:
        resp = _req.get(f"{VOICE_SERVER_URL}/bgm-library", timeout=15)
        if resp.status_code != 200:
            raise HTTPException(resp.status_code, f"voice-server 错误: {resp.text[:300]}")
        return resp.json()
    except _req.exceptions.ConnectionError:
        raise HTTPException(503, "voice-server (9001) 未启动")


@app.get("/api/voice/cover-templates")
def cover_templates_proxy():
    """转发到 voice-server: 封面模板库列表 (用户在合成封面时拉)"""
    import requests as _req
    try:
        resp = _req.get(f"{VOICE_SERVER_URL}/cover-templates", timeout=15)
        if resp.status_code != 200:
            raise HTTPException(resp.status_code, f"voice-server 错误: {resp.text[:300]}")
        return resp.json()
    except _req.exceptions.ConnectionError:
        raise HTTPException(503, "voice-server (9001) 未启动")


@app.get("/api/voice/narration-video/{name}")
def proxy_narration_video(name: str):
    """剪辑后的视频文件 (直接读 voice-server 输出目录, FileResponse 自动支持 HTTP Range,
    video tag 才能正常 seek + 流式播放)"""
    from fastapi.responses import FileResponse
    safe = os.path.basename(name)
    file_path = os.path.join(NARRATION_OUTPUT_DIR, safe)
    if not os.path.exists(file_path):
        raise HTTPException(404, "视频未找到")
    return FileResponse(file_path, media_type="video/mp4")


# ============== 自动发布代理 (转发到 voice-server 的 /publish/* ) ==============


@app.post("/api/publish/start")
def publish_start_proxy(req: dict):
    """转发到 voice-server: 起 Edge persistent profile 自动上传 + 填表, 立刻返 job_id"""
    import requests as _req
    try:
        resp = _req.post(f"{VOICE_SERVER_URL}/publish/start", json=req, timeout=60)
        if resp.status_code != 200:
            raise HTTPException(resp.status_code, f"voice-server 错误: {resp.text[:300]}")
        return resp.json()
    except _req.exceptions.ConnectionError:
        raise HTTPException(503, "voice-server (9001) 未启动")


@app.get("/api/publish/status/{job_id}")
def publish_status_proxy(job_id: str):
    """查发布 job 状态 (前端轮询用)"""
    import requests as _req
    try:
        resp = _req.get(f"{VOICE_SERVER_URL}/publish/status/{job_id}", timeout=10)
        if resp.status_code != 200:
            raise HTTPException(resp.status_code, f"voice-server 错误: {resp.text[:300]}")
        return resp.json()
    except _req.exceptions.ConnectionError:
        raise HTTPException(503, "voice-server (9001) 未启动")


@app.get("/api/publish/check-login/{platform}")
def publish_check_login_proxy(platform: str):
    """探测平台登录态. 没登录前端引导用户去 Windows 上手动 login"""
    import requests as _req
    try:
        resp = _req.get(f"{VOICE_SERVER_URL}/publish/check-login/{platform}", timeout=120)
        if resp.status_code != 200:
            raise HTTPException(resp.status_code, f"voice-server 错误: {resp.text[:300]}")
        return resp.json()
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


# ============== 支付集成 (V2: 微信扫码 + 支付宝 stub) ==============


PAYMENT_ORDER_TTL = 5 * 60   # 订单 5 分钟超时, 跟微信 Native 默认一致


class CreatePayRequest(BaseModel):
    plan_id: str                          # subscription: pro_monthly/max_monthly/flagship_yearly; credit_pack: pack_99/pack_49/pack_199/pack_499
    channel: str = 'wechat'               # 'wechat' / 'alipay'
    product_type: str = 'subscription'    # 'subscription' / 'credit_pack'


@app.post("/api/pay/create")
def create_payment_order(req: CreatePayRequest, request: Request):
    """创建待支付订单 + 调对应通道下单 → 返二维码 URL 给前端渲染.
    支持 subscription (套餐) 和 credit_pack (积分包) 两种 product_type."""
    # 限流: 同 IP 1 分钟最多创 10 个订单, 防恶意刷创订单 (虽然不付款但白消耗微信 API 配额)
    security.guard_rate_limit(request, 'pay_create', max_calls=10, window_sec=60)
    user_id = _user_id_from_request(request)

    # 根据 product_type 路由到不同 catalog
    if req.product_type == 'subscription':
        if req.plan_id not in billing.PLANS:
            raise HTTPException(400, f"未知套餐: {req.plan_id}")
        item = billing.PLANS[req.plan_id]
        item_name = item['name']
        amount_yuan = item['price_yuan']
        credits_added = 0
    elif req.product_type == 'credit_pack':
        if req.plan_id not in billing.CREDIT_PACKS:
            raise HTTPException(400, f"未知积分包: {req.plan_id}")
        # 积分包准入: 必须 Pro 及以上会员 (免费用户先开通会员才能加买积分包)
        user_sub = billing.get_user_subscription(user_id)
        user_tier = user_sub.get('tier') or 'free'
        if user_tier == 'free':
            raise HTTPException(403, "积分包仅限 Pro / Max / 旗舰 会员购买, 请先开通会员")
        item = billing.CREDIT_PACKS[req.plan_id]
        item_name = f"{item['name']} ({item['credits']} 积分)"
        amount_yuan = item['price_yuan']
        credits_added = item['credits']
    else:
        raise HTTPException(400, f"不支持的 product_type: {req.product_type}")
    amount_cents = int(round(amount_yuan * 100))
    if amount_cents <= 0:
        raise HTTPException(400, "免费商品不需要支付")

    now = _time.time()
    out_trade_no = f"ord_{int(now*1000)}_{uuid.uuid4().hex[:8]}"
    expires_at = now + PAYMENT_ORDER_TTL
    referrer_id = billing.get_referrer_id(user_id)

    description = f"monoi {item_name}"
    if req.channel == 'wechat':
        try:
            wx_res = _wxpay.create_native_order(
                out_trade_no=out_trade_no,
                amount_cents=amount_cents,
                description=description,
            )
        except Exception as e:
            import traceback
            err_full = traceback.format_exc()
            print(f"[pay] 微信下单失败 order={out_trade_no} 完整 traceback:\n{err_full}", flush=True)
            raise HTTPException(500, f"微信下单失败: {e}")
        code_url = wx_res['code_url']
        prepay_id = wx_res.get('prepay_id')
    elif req.channel == 'alipay':
        if not _ALIPAY_REAL:
            raise HTTPException(501, "支付宝商户审核中, 暂未开通")
        try:
            ap_res = _alipay.create_pc_order(out_trade_no, amount_cents, description)
        except Exception as e:
            raise HTTPException(500, f"支付宝下单失败: {e}")
        code_url = ap_res.get('qr_code') or ap_res.get('pay_url')
        prepay_id = None
    else:
        raise HTTPException(400, f"不支持的支付通道: {req.channel}")

    # 写订单到 billing_orders (order_type 区分 subscription / credit_pack)
    conn = billing.get_db()
    conn.execute("""
        INSERT INTO billing_orders (id, user_id, order_type, product_code, amount_yuan,
                                     credits_added, status, payment_method, payment_channel,
                                     wx_prepay_id, wx_code_url, referrer_id,
                                     created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)
    """, (out_trade_no, user_id, req.product_type, req.plan_id, amount_yuan, credits_added,
          req.channel, req.channel, prepay_id, code_url, referrer_id, now, expires_at))
    conn.commit()
    conn.close()

    return {
        'success': True,
        'order_id': out_trade_no,
        'code_url': code_url,
        'amount_yuan': amount_yuan,
        'plan_name': item_name,
        'expires_at': expires_at,
        'channel': req.channel,
    }


@app.get("/api/pay/query/{order_id}")
def query_payment_order(order_id: str, request: Request):
    """前端轮询订单状态. 主动调微信 API 查 (兜 notify 失败 / 慢)."""
    user_id = _user_id_from_request(request)
    conn = billing.get_db()
    row = conn.execute(
        "SELECT * FROM billing_orders WHERE id = ? AND user_id = ?",
        (order_id, user_id),
    ).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "订单不存在或不属于你")
    row_d = dict(row)
    # 已 paid 直接返
    if row_d['status'] == 'paid':
        conn.close()
        return {'status': 'paid', 'paid_at': row_d.get('paid_at'),
                'transaction_id': row_d.get('wx_transaction_id')}
    # 已超时
    if row_d.get('expires_at') and _time.time() > row_d['expires_at']:
        # 标记过期
        if row_d['status'] == 'pending':
            conn.execute("UPDATE billing_orders SET status = 'expired' WHERE id = ?", (order_id,))
            conn.commit()
        conn.close()
        return {'status': 'expired'}
    conn.close()

    # 主动查微信 (主要兜 notify 没收到的情况)
    if row_d['payment_channel'] == 'wechat':
        try:
            q = _wxpay.query_order(order_id)
        except Exception as e:
            print(f"[pay] query wxpay {order_id} 失败: {e}", flush=True)
            return {'status': 'pending'}
        if q['status'] == 'paid':
            # 微信侧已支付, 我们 notify 没收到 — 主动 mark paid + 开通
            _mark_order_paid_and_activate(order_id, q.get('transaction_id'))
            return {'status': 'paid', 'transaction_id': q.get('transaction_id'),
                    'paid_at': q.get('paid_at')}
        return {'status': q['status']}
    elif row_d['payment_channel'] == 'alipay' and _ALIPAY_REAL:
        try:
            q = _alipay.query_order(order_id)
        except Exception as e:
            print(f"[pay] query alipay {order_id} 失败: {e}", flush=True)
            return {'status': 'pending'}
        if q['status'] == 'paid':
            _mark_order_paid_and_activate(order_id, q.get('trade_no'))
            return {'status': 'paid'}
        return {'status': q['status']}
    return {'status': row_d['status']}


def _mark_order_paid_and_activate(order_id: str, transaction_id: Optional[str]):
    """订单标记 paid + 开通订阅 / 充值积分. 幂等 (重复调跳过)."""
    now = _time.time()
    conn = billing.get_db()
    row = conn.execute(
        "SELECT user_id, order_type, product_code, credits_added, status, referrer_id FROM billing_orders WHERE id = ?",
        (order_id,)
    ).fetchone()
    if not row:
        conn.close()
        return
    if row['status'] == 'paid':
        conn.close()
        return  # 幂等
    conn.execute(
        "UPDATE billing_orders SET status = 'paid', paid_at = ?, wx_transaction_id = ? WHERE id = ?",
        (now, transaction_id, order_id),
    )
    conn.commit()
    conn.close()

    order_type = row['order_type']
    user_id = row['user_id']
    product_code = row['product_code']
    print(f"[pay] 订单 {order_id} 标记 paid, type={order_type} user={user_id} product={product_code}", flush=True)

    try:
        if order_type == 'subscription':
            billing.activate_subscription(
                user_id, product_code,
                payment_method='wechat',
                referrer_id=row['referrer_id'],
                order_id=order_id,
            )
        elif order_type == 'credit_pack':
            credits = row['credits_added'] or billing.CREDIT_PACKS.get(product_code, {}).get('credits', 0)
            billing.add_credits(user_id, credits, 'purchase', ref_id=order_id, feature=product_code)
            # 触发推广佣金 (跟 buy_credits 老 endpoint 行为一致)
            if row['referrer_id']:
                pack = billing.CREDIT_PACKS.get(product_code)
                if pack:
                    billing.write_first_order_commission(order_id, row['referrer_id'], user_id,
                                                          pack['price_yuan'], product_code)
        else:
            print(f"[pay] 未知 order_type={order_type}, 跳过激活", flush=True)
    except Exception as e:
        print(f"[pay] 激活失败 order={order_id} type={order_type}: {e}", flush=True)


@app.post("/api/pay/wx/notify")
async def wxpay_notify(request: Request):
    """微信支付成功回调. 验签 → 标记 paid → 开通订阅. 返 {code: SUCCESS} 给微信."""
    body = await request.body()
    headers = dict(request.headers)
    try:
        parsed = _wxpay.verify_notify(headers, body)
    except Exception as e:
        print(f"[pay] wx notify 验签异常: {e}", flush=True)
        return {'code': 'FAIL', 'message': '验签失败'}
    if not parsed:
        print("[pay] wx notify 不是 TRANSACTION.SUCCESS 或验签失败", flush=True)
        return {'code': 'FAIL', 'message': '验签失败或非成功事件'}
    out_trade_no = parsed.get('out_trade_no')
    txn_id = parsed.get('transaction_id')
    if not out_trade_no:
        return {'code': 'FAIL', 'message': '缺 out_trade_no'}
    _mark_order_paid_and_activate(out_trade_no, txn_id)
    # 微信约定返 {code: SUCCESS} 表示已收, 否则会重试
    return {'code': 'SUCCESS', 'message': 'OK'}


@app.get("/api/digital-human/video/{name}")
def serve_digital_human_video(name: str):
    """提供数字人输出视频文件"""
    from fastapi.responses import FileResponse

    safe = os.path.basename(name)  # 防路径穿越
    file_path = os.path.join(DUIX_DATA_DIR, safe)
    if not os.path.exists(file_path):
        raise HTTPException(404, "视频未找到")
    return FileResponse(file_path, media_type="video/mp4")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=18765)
