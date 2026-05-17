"""安全模块: 登录失败锁定 + 通用 endpoint 限流 + admin IP 白名单.

设计原则:
- 跟 SMS / Captcha 一样 env-driven, 默认走宽松, 配 env 收紧
- 失败锁定走 DB (sqlite 跨进程), 限流走内存 dict (单进程足够, 跨进程靠 NATAPP 前面 nginx)
- 全部错误返 429 (rate limit) / 403 (locked/blocked), 不返 500 不要 trace
"""
import os
import time
import sqlite3
from typing import Optional
from fastapi import HTTPException, Request


# ============== 1. 登录失败锁定 (持久化到 DB) ==============

# 用 main.py 的 get_db() 同一份 monoi.db
def _get_login_db():
    # timeout=2 防 DB 锁住整个 endpoint, 我们 schema 写得很轻量, 2 秒内必须能拿到
    conn = sqlite3.connect('monoi.db', timeout=2)
    conn.row_factory = sqlite3.Row
    return conn


def init_login_attempts_table():
    """启动时调一次. 表存登录失败记录, 用于锁定判断 + 审计."""
    conn = _get_login_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS login_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            identity TEXT NOT NULL,        -- email 或 phone (按登录通道)
            client_ip TEXT,
            success INTEGER NOT NULL,      -- 0 失败 1 成功
            attempted_at REAL NOT NULL
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_login_attempts_identity ON login_attempts(identity, attempted_at DESC)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(client_ip, attempted_at DESC)")
    conn.commit()
    conn.close()


LOGIN_LOCK_THRESHOLD = int(os.getenv('LOGIN_LOCK_THRESHOLD', '5'))     # 失败 N 次锁
LOGIN_LOCK_WINDOW = int(os.getenv('LOGIN_LOCK_WINDOW_SEC', '900'))      # 15 分钟窗口
LOGIN_LOCK_DURATION = int(os.getenv('LOGIN_LOCK_DURATION_SEC', '900'))  # 锁定时长 15 分钟


def check_login_lock(identity: str) -> Optional[int]:
    """检查该 identity 是不是被锁. 返还剩多少秒解锁, 或 None (没锁)."""
    now = time.time()
    conn = _get_login_db()
    try:
        rows = conn.execute("""
            SELECT attempted_at, success FROM login_attempts
            WHERE identity = ? AND attempted_at > ?
            ORDER BY attempted_at DESC LIMIT ?
        """, (identity, now - LOGIN_LOCK_WINDOW, LOGIN_LOCK_THRESHOLD)).fetchall()
    finally:
        conn.close()
    if len(rows) < LOGIN_LOCK_THRESHOLD:
        return None
    if any(r['success'] for r in rows):
        return None
    earliest_fail = rows[-1]['attempted_at']
    unlock_at = earliest_fail + LOGIN_LOCK_DURATION
    if unlock_at > now:
        return int(unlock_at - now)
    return None


def record_login_attempt(identity: str, client_ip: str, success: bool):
    """记一次登录尝试. 成功后旧的失败记录自动失效 (因为下次 check 看 success=1)."""
    conn = _get_login_db()
    try:
        conn.execute("""
            INSERT INTO login_attempts (identity, client_ip, success, attempted_at)
            VALUES (?, ?, ?, ?)
        """, (identity, client_ip, 1 if success else 0, time.time()))
        conn.commit()
    finally:
        conn.close()


def guard_login(identity: str):
    """在 login endpoint 开头调. 锁定的 raise 403 + 提示剩余时间."""
    remaining = check_login_lock(identity)
    if remaining:
        mins = (remaining + 59) // 60
        raise HTTPException(403, f"登录失败次数过多, 请 {mins} 分钟后再试")


# ============== 2. 通用 endpoint 限流 (内存, 单进程) ==============

_rate_buckets: dict = {}  # key -> [(timestamp, ...)]


def rate_limit(key: str, max_calls: int, window_sec: int) -> Optional[int]:
    """检查 key 是否在 window 内超过 max_calls. 返 retry_after 秒 (超了) 或 None (没超)."""
    now = time.time()
    cutoff = now - window_sec
    bucket = _rate_buckets.get(key, [])
    # 清掉过期的
    bucket = [t for t in bucket if t > cutoff]
    if len(bucket) >= max_calls:
        # 最早那次过期时还 max_calls 次, 等到它过期才能再调
        return int(bucket[0] + window_sec - now) + 1
    bucket.append(now)
    _rate_buckets[key] = bucket
    return None


def guard_rate_limit(request: Request, key_prefix: str, max_calls: int, window_sec: int):
    """endpoint 开头调. 用 client IP 做 key 限流. 超了 429."""
    from main import _client_ip_from_request   # 避免 import 循环
    ip = _client_ip_from_request(request)
    key = f"{key_prefix}:{ip}"
    retry_after = rate_limit(key, max_calls, window_sec)
    if retry_after:
        raise HTTPException(429, f"请求过频, {retry_after} 秒后再试")


# ============== 3. admin IP 白名单 (env-gated, 不配走全开) ==============


def _parse_ip_whitelist() -> list:
    raw = os.getenv('ADMIN_IP_WHITELIST', '').strip()
    return [ip.strip() for ip in raw.split(',') if ip.strip()] if raw else []


_ADMIN_IP_WHITELIST = _parse_ip_whitelist()
if _ADMIN_IP_WHITELIST:
    print(f"[security] admin IP 白名单启用: {_ADMIN_IP_WHITELIST}", flush=True)
else:
    print(f"[security] admin IP 白名单未配 (env ADMIN_IP_WHITELIST), 走 is_admin 字段校验即可", flush=True)


def guard_admin_ip(request: Request):
    """env 配了 ADMIN_IP_WHITELIST 时启用. 没配 = 不强制 (老行为)."""
    if not _ADMIN_IP_WHITELIST:
        return
    from main import _client_ip_from_request
    ip = _client_ip_from_request(request)
    if ip not in _ADMIN_IP_WHITELIST:
        raise HTTPException(403, f"管理员后台 IP 不在白名单")
