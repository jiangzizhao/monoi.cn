"""monoi 管理员后台 API

只允许 users.is_admin = 1 的用户访问. 路径 /api/admin/*

V1 功能:
- GET /users — 用户列表 (分页 + 搜索)
- GET /users/{id} — 用户详情 (订单/积分/推广关系)
- POST /users/{id}/grant-subscription — 手工开套餐
- POST /users/{id}/grant-credits — 加减积分
- POST /users/{id}/set-referrer-level — 升认证/合伙人
- GET /orders — 订单列表
- GET /withdrawals — 提现申请
- POST /withdrawals/{id}/approve — 批准提现
- GET /stats — 数据看板

V2 留: 退款 / 系统配置热改 / 公告栏 / 黑名单关键词
"""

import os
import re
import sqlite3
import time
from typing import Optional
from fastapi import APIRouter, HTTPException, Request, Query, UploadFile, File, Form
from pydantic import BaseModel

DB_PATH = "monoi.db"

router = APIRouter(prefix="/api/admin")


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


# 必须跟 main.py 用同一个 JWT 密钥, 否则主程序签发的 token 在这里解不开 → "token 无效"。
# 之前写死成默认值, 一旦 main.py 配了强随机 JWT_SECRET_KEY 就对不上。改成读同一个 env。
SECRET_KEY = os.getenv('JWT_SECRET_KEY') or "monoi-secret-key-2025"
ALGORITHM = "HS256"


def require_admin(request: Request) -> int:
    """JWT 验证 + admin 检查 + (可选) IP 白名单. 返回 user_id."""
    # 可选 IP 白名单 (env ADMIN_IP_WHITELIST 配了才启用)
    try:
        import security
        security.guard_admin_ip(request)
    except ImportError:
        pass    # security 模块没装, 跳过
    auth = request.headers.get('authorization') or request.headers.get('Authorization') or ''
    if not auth.startswith('Bearer '):
        raise HTTPException(401, '未登录')
    try:
        from jose import jwt
        payload = jwt.decode(auth[7:], SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload['sub'])
    except Exception:
        raise HTTPException(401, 'token 无效')
    conn = get_db()
    row = conn.execute("SELECT is_admin FROM users WHERE id = ?", (user_id,)).fetchone()
    conn.close()
    if not row or not row['is_admin']:
        raise HTTPException(403, '权限不足: 仅管理员可访问')
    return user_id


def mask_phone(p: Optional[str]) -> str:
    if not p:
        return ''
    return p[:3] + '****' + p[-4:] if len(p) == 11 else p


# ============== 用户列表 ==============


@router.get("/users")
def list_users(request: Request,
               q: str = Query('', description='搜索 username/email/phone'),
               tier: str = Query('', description='筛选套餐 free/pro/max/flagship'),
               limit: int = Query(50, ge=1, le=200),
               offset: int = Query(0, ge=0)):
    require_admin(request)
    conn = get_db()
    where = []
    params = []
    if q:
        like = f"%{q}%"
        where.append("(u.username LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)")
        params.extend([like, like, like])
    if tier:
        if tier == 'free':
            where.append("(us.tier IS NULL OR us.current_period_end < ?)")
            params.append(time.time())
        else:
            where.append("us.tier = ? AND us.current_period_end >= ?")
            params.append(tier)
            params.append(time.time())
    where_sql = ('WHERE ' + ' AND '.join(where)) if where else ''

    total = conn.execute(f"""
        SELECT COUNT(*) FROM users u
        LEFT JOIN user_subscription us ON us.user_id = u.id
        {where_sql}
    """, params).fetchone()[0]

    rows = conn.execute(f"""
        SELECT
            u.id, u.username, u.email, u.phone, u.created_at, u.is_admin,
            us.tier, us.current_period_end,
            cb.monthly_credits, cb.purchased_credits,
            rs.level as referrer_level, rs.total_paying_users, rs.total_revenue_brought
        FROM users u
        LEFT JOIN user_subscription us ON us.user_id = u.id
        LEFT JOIN credit_balance cb ON cb.user_id = u.id
        LEFT JOIN referrer_status rs ON rs.user_id = u.id
        {where_sql}
        ORDER BY u.id DESC
        LIMIT ? OFFSET ?
    """, params + [limit, offset]).fetchall()
    conn.close()

    now = time.time()
    return {
        'total': total,
        'users': [{
            'id': r['id'], 'username': r['username'], 'email': r['email'],
            'phone_masked': mask_phone(r['phone']),
            'created_at': r['created_at'], 'is_admin': r['is_admin'],
            'tier': r['tier'] if r['tier'] and r['current_period_end'] and r['current_period_end'] >= now else 'free',
            'sub_end': r['current_period_end'],
            'credits_total': (r['monthly_credits'] or 0) + (r['purchased_credits'] or 0),
            'referrer_level': r['referrer_level'] or 'normal',
            'total_paying_users_brought': r['total_paying_users'] or 0,
            'total_revenue_brought': r['total_revenue_brought'] or 0,
        } for r in rows]
    }


# ============== 用户详情 ==============


@router.get("/users/{user_id}")
def user_detail(user_id: int, request: Request):
    require_admin(request)
    conn = get_db()
    user = conn.execute(
        "SELECT id, username, email, phone, avatar_oss_key, is_admin, created_at FROM users WHERE id = ?",
        (user_id,)
    ).fetchone()
    if not user:
        conn.close()
        raise HTTPException(404, '用户不存在')
    sub = conn.execute("SELECT * FROM user_subscription WHERE user_id = ?", (user_id,)).fetchone()
    bal = conn.execute("SELECT * FROM credit_balance WHERE user_id = ?", (user_id,)).fetchone()
    rs = conn.execute("SELECT * FROM referrer_status WHERE user_id = ?", (user_id,)).fetchone()
    rb = conn.execute("SELECT * FROM referrer_balance WHERE user_id = ?", (user_id,)).fetchone()
    rbind = conn.execute("SELECT * FROM referral_binding WHERE user_id = ?", (user_id,)).fetchone()
    orders = conn.execute("""
        SELECT * FROM billing_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 50
    """, (user_id,)).fetchall()
    credit_logs = conn.execute("""
        SELECT * FROM credit_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 50
    """, (user_id,)).fetchall()
    referred = conn.execute("""
        SELECT COUNT(*) as cnt FROM referral_binding WHERE referrer_id = ?
    """, (user_id,)).fetchone()
    conn.close()

    return {
        'user': {**dict(user), 'phone_masked': mask_phone(user['phone'])},
        'subscription': dict(sub) if sub else None,
        'credit_balance': dict(bal) if bal else None,
        'referrer_status': dict(rs) if rs else None,
        'referrer_balance': dict(rb) if rb else None,
        'referred_by': dict(rbind) if rbind else None,
        'orders': [dict(o) for o in orders],
        'credit_logs': [dict(l) for l in credit_logs],
        'referred_count': referred['cnt'] if referred else 0,
    }


# ============== 手工操作 ==============


class GrantSubscriptionRequest(BaseModel):
    tier: str
    period_days: int = 30
    note: str = ''


@router.post("/users/{user_id}/grant-subscription")
def grant_subscription(user_id: int, req: GrantSubscriptionRequest, request: Request):
    admin_id = require_admin(request)
    if req.tier not in ('pro_monthly', 'max_monthly', 'flagship_yearly'):
        raise HTTPException(400, f"未知套餐: {req.tier}")

    import sys, os
    sys.path.insert(0, os.path.dirname(__file__))
    from billing import PLANS, activate_subscription, add_credits

    plan = PLANS[req.tier]
    # 用 billing.activate_subscription 走标准流程 (会自动写订阅 + 加月度积分)
    activate_subscription(user_id, req.tier)

    # 记录管理员操作 (写订单做账)
    import uuid
    order_id = f"adm_{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}"
    conn = get_db()
    conn.execute("""
        INSERT INTO billing_orders (id, user_id, order_type, product_code, amount_yuan,
                                      status, payment_method, paid_at, created_at)
        VALUES (?, ?, 'subscription', ?, ?, 'paid', ?, ?, ?)
    """, (order_id, user_id, req.tier, plan['price_yuan'], f'admin_grant:{admin_id}:{req.note}',
          time.time(), time.time()))
    conn.commit()
    conn.close()
    return {'success': True, 'order_id': order_id, 'message': f'已开通 {plan["name"]}'}


class GrantCreditsRequest(BaseModel):
    amount: int                # 正数加积分, 负数扣积分
    note: str = ''


@router.post("/users/{user_id}/grant-credits")
def grant_credits(user_id: int, req: GrantCreditsRequest, request: Request):
    admin_id = require_admin(request)
    if req.amount == 0:
        raise HTTPException(400, '积分变动不能为 0')

    import sys, os
    sys.path.insert(0, os.path.dirname(__file__))
    from billing import add_credits, consume_credits

    if req.amount > 0:
        add_credits(user_id, req.amount, 'admin_grant', ref_id=f'admin_{admin_id}', feature=req.note or 'admin_grant')
    else:
        # 扣积分 (用 consume_credits, 不够会 raise)
        try:
            consume_credits(user_id, req.note or 'admin_deduct', -req.amount, ref_id=f'admin_{admin_id}')
        except HTTPException as e:
            raise e
    return {'success': True, 'message': f'已{ "加" if req.amount > 0 else "扣"} {abs(req.amount)} 积分'}


class SetReferrerLevelRequest(BaseModel):
    level: str                 # normal / certified / partner


@router.post("/users/{user_id}/set-referrer-level")
def set_referrer_level(user_id: int, req: SetReferrerLevelRequest, request: Request):
    require_admin(request)
    if req.level not in ('normal', 'certified', 'partner'):
        raise HTTPException(400, f"未知等级: {req.level}")
    conn = get_db()
    existing = conn.execute("SELECT user_id FROM referrer_status WHERE user_id = ?", (user_id,)).fetchone()
    if not existing:
        # 自动建一个 (走 billing.ensure_referrer_status 拿到推广码)
        import sys, os
        sys.path.insert(0, os.path.dirname(__file__))
        from billing import ensure_referrer_status
        ensure_referrer_status(user_id)
    conn.execute("""
        UPDATE referrer_status SET level = ?, level_upgraded_at = ?, updated_at = ?
        WHERE user_id = ?
    """, (req.level, time.time(), time.time(), user_id))
    conn.commit()
    conn.close()
    return {'success': True, 'message': f'已设为 {req.level}'}


class SetAdminRequest(BaseModel):
    is_admin: int              # 0 / 1


@router.post("/users/{user_id}/set-admin")
def set_admin(user_id: int, req: SetAdminRequest, request: Request):
    require_admin(request)
    conn = get_db()
    conn.execute("UPDATE users SET is_admin = ? WHERE id = ?", (1 if req.is_admin else 0, user_id))
    conn.commit()
    conn.close()
    return {'success': True}


# ============== 订单列表 ==============


@router.get("/orders")
def list_orders(request: Request,
                status: str = Query('', description="筛选状态 paid/pending/refunded"),
                limit: int = Query(50, ge=1, le=200),
                offset: int = Query(0, ge=0)):
    require_admin(request)
    conn = get_db()
    where = []
    params = []
    if status:
        where.append("o.status = ?")
        params.append(status)
    where_sql = ('WHERE ' + ' AND '.join(where)) if where else ''
    total = conn.execute(f"SELECT COUNT(*) FROM billing_orders o {where_sql}", params).fetchone()[0]
    rows = conn.execute(f"""
        SELECT o.*, u.username, u.phone
        FROM billing_orders o
        LEFT JOIN users u ON u.id = o.user_id
        {where_sql}
        ORDER BY o.created_at DESC
        LIMIT ? OFFSET ?
    """, params + [limit, offset]).fetchall()
    conn.close()
    return {
        'total': total,
        'orders': [{
            **{k: r[k] for k in ['id', 'user_id', 'order_type', 'product_code', 'amount_yuan',
                                   'status', 'payment_method', 'paid_at', 'created_at',
                                   'referrer_id', 'credits_added']},
            'username': r['username'],
            'phone_masked': mask_phone(r['phone']),
        } for r in rows]
    }


# ============== 提现申请 ==============


@router.get("/withdrawals")
def list_withdrawals(request: Request,
                     status: str = Query('', description="pending/approved/rejected/paid"),
                     limit: int = Query(50)):
    require_admin(request)
    conn = get_db()
    where = []
    params = []
    if status:
        where.append("w.status = ?")
        params.append(status)
    where_sql = ('WHERE ' + ' AND '.join(where)) if where else ''
    rows = conn.execute(f"""
        SELECT w.*, u.username, u.phone
        FROM withdrawal_request w
        LEFT JOIN users u ON u.id = w.user_id
        {where_sql}
        ORDER BY w.created_at DESC LIMIT ?
    """, params + [limit]).fetchall()
    conn.close()
    return [{
        **{k: r[k] for k in ['id', 'user_id', 'amount_yuan', 'payment_method',
                              'account_info', 'status', 'admin_note',
                              'created_at', 'processed_at']},
        'username': r['username'],
        'phone_masked': mask_phone(r['phone']),
    } for r in rows]


class ProcessWithdrawRequest(BaseModel):
    action: str        # 'approve' / 'reject' / 'mark_paid'
    note: str = ''


@router.post("/withdrawals/{wid}/process")
def process_withdrawal(wid: int, req: ProcessWithdrawRequest, request: Request):
    require_admin(request)
    conn = get_db()
    row = conn.execute("SELECT * FROM withdrawal_request WHERE id = ?", (wid,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, '提现申请不存在')
    now = time.time()
    new_status = ''
    if req.action == 'approve':
        new_status = 'approved'
    elif req.action == 'mark_paid':
        new_status = 'paid'
    elif req.action == 'reject':
        # 拒绝退回余额
        new_status = 'rejected'
        conn.execute(
            "UPDATE referrer_balance SET cash_balance = cash_balance + ?, updated_at = ? WHERE user_id = ?",
            (row['amount_yuan'], now, row['user_id'])
        )
    else:
        conn.close()
        raise HTTPException(400, f"未知操作: {req.action}")
    conn.execute("""
        UPDATE withdrawal_request SET status = ?, admin_note = ?, processed_at = ?
        WHERE id = ?
    """, (new_status, req.note, now, wid))
    # 如果是 mark_paid, 更新累计已提现
    if req.action == 'mark_paid':
        conn.execute(
            "UPDATE referrer_balance SET cash_withdrawn_total = cash_withdrawn_total + ?, updated_at = ? WHERE user_id = ?",
            (row['amount_yuan'], now, row['user_id'])
        )
    conn.commit()
    conn.close()
    return {'success': True, 'message': f'已 {req.action}'}


# ============== 数据看板 ==============


@router.get("/stats")
def stats(request: Request):
    require_admin(request)
    import datetime
    conn = get_db()
    now = time.time()
    today = datetime.date.today()
    start_of_today = datetime.datetime.combine(today, datetime.time.min).timestamp()
    start_of_month = datetime.datetime.combine(today.replace(day=1), datetime.time.min).timestamp()
    week_ago = now - 7 * 86400

    # ============ 用户 ============
    total_users = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    new_today = conn.execute(
        "SELECT COUNT(*) FROM users WHERE created_at >= datetime(?, 'unixepoch')",
        (start_of_today,)
    ).fetchone()[0]
    new_week = conn.execute("SELECT COUNT(*) FROM users WHERE created_at >= datetime('now', '-7 day')").fetchone()[0]

    # 付费用户细分 (Pro/Max/旗舰), 当前订阅未过期
    tier_dist_rows = conn.execute("""
        SELECT tier, COUNT(*) as cnt FROM user_subscription
        WHERE tier IN ('pro_monthly', 'max_monthly', 'flagship_yearly')
          AND current_period_end >= ?
        GROUP BY tier
    """, (now,)).fetchall()
    tier_counts = {r['tier']: r['cnt'] for r in tier_dist_rows}
    paying_users = sum(tier_counts.values())

    # 套餐分布: 每个 tier 数量 + 占付费 % + 占注册 %
    tier_stats = {}
    for tier_key in ('pro_monthly', 'max_monthly', 'flagship_yearly'):
        cnt = tier_counts.get(tier_key, 0)
        tier_stats[tier_key] = {
            'count': cnt,
            'pct_of_paying': round(cnt / paying_users * 100, 1) if paying_users else 0,
            'pct_of_total': round(cnt / total_users * 100, 1) if total_users else 0,
        }

    # ============ 营收 ============
    revenue_total = conn.execute("SELECT COALESCE(SUM(amount_yuan), 0) FROM billing_orders WHERE status = 'paid'").fetchone()[0]
    revenue_today = conn.execute(
        "SELECT COALESCE(SUM(amount_yuan), 0) FROM billing_orders WHERE status = 'paid' AND paid_at >= ?",
        (start_of_today,)
    ).fetchone()[0]
    revenue_week = conn.execute("SELECT COALESCE(SUM(amount_yuan), 0) FROM billing_orders WHERE status = 'paid' AND paid_at >= ?", (week_ago,)).fetchone()[0]
    revenue_month = conn.execute(
        "SELECT COALESCE(SUM(amount_yuan), 0) FROM billing_orders WHERE status = 'paid' AND paid_at >= ?",
        (start_of_month,)
    ).fetchone()[0]

    # 最近 7 天每日营收
    daily_revenue = []
    for i in range(7):
        start = now - (i + 1) * 86400
        end = now - i * 86400
        r = conn.execute(
            "SELECT COALESCE(SUM(amount_yuan), 0) FROM billing_orders WHERE status = 'paid' AND paid_at >= ? AND paid_at < ?",
            (start, end)
        ).fetchone()[0]
        daily_revenue.append({'days_ago': i, 'amount': r})
    daily_revenue.reverse()

    # ============ 推广员细分 (3 等级: normal / certified / partner) ============
    referrer_levels = {}
    for level in ('normal', 'certified', 'partner'):
        cnt = conn.execute("SELECT COUNT(*) FROM referrer_status WHERE level = ?", (level,)).fetchone()[0]
        total_brought = conn.execute(
            "SELECT COALESCE(SUM(total_paying_users), 0) FROM referrer_status WHERE level = ?",
            (level,)
        ).fetchone()[0]
        # 今日新拉 = commission_log 里 first_order 今天的, 按推广员 level join
        new_today_brought = conn.execute("""
            SELECT COUNT(DISTINCT cl.order_id) FROM commission_log cl
            JOIN referrer_status rs ON rs.user_id = cl.beneficiary_user_id
            WHERE cl.commission_type = 'first_order'
              AND cl.created_at >= ?
              AND rs.level = ?
        """, (start_of_today, level)).fetchone()[0]
        # 未结算应得分成 (现金 + 积分)
        pending_cash = conn.execute("""
            SELECT COALESCE(SUM(cl.cash_yuan), 0) FROM commission_log cl
            JOIN referrer_status rs ON rs.user_id = cl.beneficiary_user_id
            WHERE cl.status = 'pending' AND rs.level = ?
        """, (level,)).fetchone()[0]
        pending_credits = conn.execute("""
            SELECT COALESCE(SUM(cl.credits), 0) FROM commission_log cl
            JOIN referrer_status rs ON rs.user_id = cl.beneficiary_user_id
            WHERE cl.status = 'pending' AND rs.level = ?
        """, (level,)).fetchone()[0]
        withdrawn = conn.execute("""
            SELECT COALESCE(SUM(rb.cash_withdrawn_total), 0) FROM referrer_balance rb
            JOIN referrer_status rs ON rs.user_id = rb.user_id
            WHERE rs.level = ?
        """, (level,)).fetchone()[0]
        referrer_levels[level] = {
            'count': cnt,
            'total_brought': int(total_brought or 0),
            'new_today': new_today_brought,
            'pending_cash': round(pending_cash, 2),
            'pending_credits': int(pending_credits or 0),
            'total_withdrawn': round(withdrawn, 2),
        }

    pending_withdrawals = conn.execute("SELECT COUNT(*) FROM withdrawal_request WHERE status = 'pending'").fetchone()[0]
    pending_withdraw_amount = conn.execute("SELECT COALESCE(SUM(amount_yuan), 0) FROM withdrawal_request WHERE status = 'pending'").fetchone()[0]

    conn.close()

    return {
        'users': {
            'total': total_users,
            'new_today': new_today,
            'new_week': new_week,
            'paying': paying_users,
            'paying_conversion': round(paying_users / total_users * 100, 1) if total_users else 0,
        },
        'tiers': tier_stats,
        'revenue': {
            'total': round(revenue_total, 2),
            'today': round(revenue_today, 2),
            'week': round(revenue_week, 2),
            'month': round(revenue_month, 2),         # 本月 1 日 0 点起
            'daily_7d': daily_revenue,
        },
        'referrer_levels': referrer_levels,
        'pending_withdrawals': pending_withdrawals,
        'pending_withdraw_amount': round(pending_withdraw_amount, 2),
    }


# ============== BGM 库管理 ==============


class AddBgmRequest(BaseModel):
    name: str
    category: str = 'other'   # upbeat/calm/inspirational/cinematic/electronic/chinese/other
    oss_key: str              # 必须已经上传到 OSS (走 sign-upload), 这里只入库
    duration_seconds: float = 0
    license_note: Optional[str] = None


@router.post("/bgm-library")
def admin_add_bgm(req: AddBgmRequest, request: Request):
    admin_id = require_admin(request)
    valid_cats = {'upbeat', 'calm', 'inspirational', 'cinematic', 'electronic', 'chinese', 'other'}
    if req.category not in valid_cats:
        raise HTTPException(400, f"category 必须是 {valid_cats}")
    conn = get_db()
    cursor = conn.execute("""
        INSERT INTO bgm_library (name, category, oss_key, duration_seconds, license_note, uploaded_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (req.name, req.category, req.oss_key, req.duration_seconds, req.license_note, admin_id, time.time()))
    new_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return {'success': True, 'id': new_id}


@router.get("/bgm-library")
def admin_list_bgm(request: Request):
    require_admin(request)
    conn = get_db()
    rows = conn.execute("""
        SELECT id, name, category, oss_key, duration_seconds, license_note, uploaded_by, created_at
        FROM bgm_library ORDER BY created_at DESC
    """).fetchall()
    conn.close()
    return {'bgms': [dict(r) for r in rows]}


@router.delete("/bgm-library/{bgm_id}")
def admin_delete_bgm(bgm_id: int, request: Request):
    require_admin(request)
    conn = get_db()
    conn.execute("DELETE FROM bgm_library WHERE id = ?", (bgm_id,))
    conn.commit()
    conn.close()
    # 注意: 不主动删 OSS 文件 (lifecycle 自动清, 或者别的 BGM 用着同一 oss_key)
    return {'success': True}


# ============== 字体库管理 ==============
# admin 上传 .ttf/.otf → 写到 D:\monoi-server\fonts\ → 入库
# voice-server 的 /cover-fonts 同时读 _FONT_CATALOG (内置) + font_library 表 (admin 加的)

# 字体目录: 跟 voice-server.py 的 _FONT_DIR_PROJECT 保持一致
_FONT_DIR = r'D:\monoi-server\fonts'


@router.get("/fonts")
def admin_list_fonts(request: Request):
    """列出所有 admin 上传的字体 (内置那 10 个不算, 在 voice-server.py 硬编码)"""
    require_admin(request)
    conn = get_db()
    rows = conn.execute("""
        SELECT id, label, file, tag, license_note, uploaded_by, created_at
        FROM font_library ORDER BY created_at DESC
    """).fetchall()
    conn.close()
    # 顺便检查文件是不是真在磁盘上 (没在标记一下, 可能上传后被手删了)
    result = []
    for r in rows:
        d = dict(r)
        d['file_exists'] = os.path.exists(os.path.join(_FONT_DIR, r['file']))
        result.append(d)
    return {'fonts': result}


@router.post("/fonts")
async def admin_upload_font(
    request: Request,
    file: UploadFile = File(...),
    label: str = Form(...),
    tag: str = Form(''),
    license_note: str = Form(''),
):
    """上传 .ttf/.otf 字体文件到 D:\\monoi-server\\fonts\\ + 入库"""
    admin_id = require_admin(request)

    if not label.strip():
        raise HTTPException(400, '字体名 (label) 不能为空')

    # 校验扩展名
    fname = file.filename or ''
    ext_match = re.search(r'\.(ttf|otf|ttc)$', fname.lower())
    if not ext_match:
        raise HTTPException(400, '只支持 .ttf / .otf / .ttc 字体')

    # 规范文件名: 去掉中文 / 空格 / 特殊符, 防止文件系统 / URL 问题
    safe_base = re.sub(r'[^A-Za-z0-9_.-]', '_', fname).strip('_')
    if not safe_base:
        safe_base = f"font_{int(time.time())}{ext_match.group(0)}"

    # 写到 fonts 目录, 防同名覆盖 (加时间戳)
    os.makedirs(_FONT_DIR, exist_ok=True)
    target = os.path.join(_FONT_DIR, safe_base)
    if os.path.exists(target):
        # 同名已存在 — 加时间戳后缀
        stem, ext = os.path.splitext(safe_base)
        safe_base = f"{stem}_{int(time.time())}{ext}"
        target = os.path.join(_FONT_DIR, safe_base)

    # 流式写入 (大字体可能 10MB+)
    content = await file.read()
    if len(content) > 30 * 1024 * 1024:
        raise HTTPException(413, '字体文件太大 (>30MB)')
    with open(target, 'wb') as f:
        f.write(content)

    # 转 WOFF2 — 浏览器通用格式, 比 raw TTF/OTF 兼容性好得多
    # (某些 TTF 有 OS/2 sxHeight, vhea version 等 metadata 问题, Chrome/Firefox 拒绝加载)
    # PIL 后端继续用原 TTF (PIL 比浏览器宽松, 能解析).
    # 失败不阻塞上传 — 没装 fonttools / brotli 就跳过, 前端会自动 fallback 原文件
    try:
        from fontTools.ttLib import TTFont
        ttx = TTFont(target)
        ttx.flavor = 'woff2'
        woff2_path = os.path.splitext(target)[0] + '.woff2'
        ttx.save(woff2_path)
        print(f"[font-upload] WOFF2 转出成功: {woff2_path}", flush=True)
    except ImportError:
        print("[font-upload] fonttools 没装, 跳过 WOFF2 转换 (pip install fonttools brotli)", flush=True)
    except Exception as e:
        # 字体文件坏的情况下 fonttools 也会失败, 这时只能用原文件凑合
        print(f"[font-upload] WOFF2 转换失败 (不影响上传): {e}", flush=True)

    # 入库
    conn = get_db()
    try:
        cursor = conn.execute("""
            INSERT INTO font_library (label, file, tag, license_note, uploaded_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (label.strip(), safe_base, tag.strip() or None, license_note.strip() or None, admin_id, time.time()))
        new_id = cursor.lastrowid
        conn.commit()
    except sqlite3.IntegrityError:
        # 文件名冲突 (UNIQUE 约束): 删文件 + 提示
        try: os.remove(target)
        except: pass
        raise HTTPException(409, '字体已存在 (file 字段重复)')
    finally:
        conn.close()

    return {
        'success': True,
        'id': new_id,
        'file': safe_base,
        'label': label.strip(),
        'size_kb': round(len(content) / 1024, 1),
    }


@router.delete("/fonts/{font_id}")
def admin_delete_font(font_id: int, request: Request):
    """删字体: 从库里去掉, 同时删磁盘文件 (彻底)"""
    require_admin(request)
    conn = get_db()
    row = conn.execute("SELECT file FROM font_library WHERE id = ?", (font_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, '字体不存在')
    conn.execute("DELETE FROM font_library WHERE id = ?", (font_id,))
    conn.commit()
    conn.close()

    # 删磁盘文件
    fpath = os.path.join(_FONT_DIR, row['file'])
    if os.path.exists(fpath):
        try:
            os.remove(fpath)
        except Exception as e:
            return {'success': True, 'warn': f'db 记录已删, 但磁盘文件没删干净: {e}'}
    return {'success': True}


# ============== 封面模板库管理 ==============
# admin 上传 底图 PNG (已传到 OSS) + 文字字段配置 → 入库
# 用户合成封面时按模板渲染


class CoverTextField(BaseModel):
    """一个文字字段的所有渲染配置. 模板可以有 N 个字段, 用户填 N 个文本框"""
    label: str                            # 给 admin/用户看的字段名 例 "主标题"
    x: int                                # 文本框左上角 (像素, 相对底图)
    y: int
    w: int                                # 文本框最大宽 (超出自动换行/缩字)
    h: int                                # 文本框最大高
    font_file: str = 'SourceHanSansCN-Heavy.otf'  # 字体文件名 (字体库里的)
    font_size: int = 120                  # 字号 (像素)
    color: str = '#FFFFFF'                # 主文字色
    highlight_color: Optional[str] = None # 大括号包的字用这个色 (例 用户填 "封面{邪修}" → 邪修染色)
    stroke_color: Optional[str] = None    # 描边色 (None 不描边)
    stroke_width: int = 0
    shadow_color: Optional[str] = None    # 阴影色 (None 不阴影)
    shadow_offset_x: int = 0
    shadow_offset_y: int = 0
    shadow_blur: int = 0
    underline_style: str = 'none'         # none / solid / wavy / double 下划线样式
    underline_color: Optional[str] = None # 下划线色 (None = 用主色)
    underline_length_pct: int = 100       # 下划线长度 = 文字宽的百分比 (20-100), 居中
    text_arc: float = 0                   # 弧形/扇形: 度数. 0=直, >0 上弧 ∩, <0 下弧 ∪ (逐字沿弧摆放)
    text_trapezoid: float = 0             # 梯形变型: -100~100. >0 上窄下宽 /\, <0 上宽下窄 \/ (透视warp). 跟弧形互斥
    text_trapezoid_skew: float = 0        # 梯形左右不对称 (不规则梯形): -100~100
    align: str = 'left'                   # left / center / right
    rotation: float = 0                   # 旋转角度 (°), -45 ~ +45. 0 = 不旋转
    layer: str = 'front'                  # 相对人物图层: front=人物前(默认) / behind=人物后(人物压字)
    max_chars: int = 0                    # 0 = 不限. 超过提示用户裁剪
    placeholder: str = ''                 # 给用户的提示文字 例 "封面{邪修}"


class CoverPersonSlot(BaseModel):
    """模板里给用户人物图预留的坑位. 用户上传一张人物图 → rembg 抠图 → 按 fit_mode
    塞进这个坑. 可选描边让人物从背景分离更显眼."""
    x: int
    y: int
    w: int
    h: int
    stroke_enabled: bool = True
    stroke_color: str = '#FFFFFF'
    stroke_width: int = 12                 # 像素, 1080×1440 上 12px 比较合适
    fit_mode: str = 'cover'                # cover (按比例填满裁多余) / contain (按比例完整显示)
    rotation: float = 0                    # 旋转角度 (°), 用户可调


class CoverLineField(BaseModel):
    """独立装饰线条元素 (不依赖文字). 盒子 x/y/w/h, 线横贯盒宽画在垂直中心,
    样式 solid/wavy/double, 可旋转, 可在人物前/后. 由 '下划线要能自由移动' 演化来."""
    x: int = 0
    y: int = 0
    w: int = 300
    h: int = 40
    style: str = 'solid'                   # solid / wavy / double
    color: str = '#FFFFFF'
    thickness: int = 8                     # 线粗 (px)
    rotation: float = 0                    # 旋转角度 (°)
    layer: str = 'front'                   # front=人物前 / behind=人物后


class AddCoverTemplateRequest(BaseModel):
    name: str
    category: str = 'other'
    ratio: str = '3:4'                    # 9:16 / 3:4 / 16:9 / 1:1
    bg_oss_key: str                       # admin 已经把底图 PNG 传到 OSS, 给 key
    text_fields: list[CoverTextField]     # 至少 1 个
    line_fields: list[CoverLineField] = []          # 装饰线条 (可空)
    person_slot: Optional[CoverPersonSlot] = None   # 没人物的模板留 None
    # 示例人物图 (已抠图的透明 PNG, OSS key 在 cover_persons/ 持久前缀里).
    # 用途: admin 编辑时看效果 + 用户在 TemplateCoverPicker 看缩略图能预览成品.
    # 用户上传自己的人物图后会替换它.
    sample_person_oss_key: Optional[str] = None


@router.post("/cover-templates")
def admin_add_cover_template(req: AddCoverTemplateRequest, request: Request):
    admin_id = require_admin(request)
    if req.ratio not in {'9:16', '3:4', '16:9', '1:1'}:
        raise HTTPException(400, f'ratio 必须是 9:16/3:4/16:9/1:1')
    valid_cats = {'kepu', 'zhenjing', 'gushi', 'jiaocheng', 'jianji', 'zhichang', 'xuexi', 'licai', 'other'}
    if req.category not in valid_cats:
        raise HTTPException(400, f'category 必须是 {valid_cats}')
    if req.text_fields and len(req.text_fields) > 10:
        raise HTTPException(400, '最多 10 个文字字段')
    # 字段为空也允许 — 用户能在用户端自己加自定义文字, 模板可以是"纯底图"

    import json as _json
    text_fields_json = _json.dumps([f.model_dump() for f in req.text_fields], ensure_ascii=False)
    line_fields_json = _json.dumps([f.model_dump() for f in req.line_fields], ensure_ascii=False)
    person_slot_json = _json.dumps(req.person_slot.model_dump(), ensure_ascii=False) if req.person_slot else None

    conn = get_db()
    # sample_person_oss_key 字段不存在时先 ALTER 加 (老库一次性兼容)
    _ensure_sample_person_column(conn)
    cursor = conn.execute("""
        INSERT INTO cover_template (name, category, ratio, bg_oss_key, text_fields_json, line_fields_json, person_slot_json, sample_person_oss_key, uploaded_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (req.name, req.category, req.ratio, req.bg_oss_key, text_fields_json, line_fields_json, person_slot_json, req.sample_person_oss_key, admin_id, time.time()))
    new_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return {'success': True, 'id': new_id}


def _ensure_sample_person_column(conn):
    """老库迁移: cover_template 没 sample_person_oss_key 列就 ALTER 加上.
    幂等 — 已经有列就什么都不做."""
    try:
        cols = [r[1] for r in conn.execute("PRAGMA table_info(cover_template)").fetchall()]
        if 'sample_person_oss_key' not in cols:
            conn.execute("ALTER TABLE cover_template ADD COLUMN sample_person_oss_key TEXT")
            conn.commit()
            print("[admin] cover_template 加 sample_person_oss_key 列成功", flush=True)
    except Exception as e:
        print(f"[admin] _ensure_sample_person_column 失败 (忽略): {e}", flush=True)


def _parse_template_row(r):
    """sqlite Row → dict, 把 text_fields_json / person_slot_json 解出来,
    顺手签底图 bg_url (1h 签名), admin 端缩略图能直接展示"""
    import json as _json
    d = dict(r)
    try:
        d['text_fields'] = _json.loads(d.pop('text_fields_json') or '[]')
    except Exception:
        d['text_fields'] = []
    try:
        d['line_fields'] = _json.loads(d.pop('line_fields_json', None) or '[]')
    except Exception:
        d['line_fields'] = []
    raw_person = d.pop('person_slot_json', None)
    if raw_person:
        try:
            d['person_slot'] = _json.loads(raw_person)
        except Exception:
            d['person_slot'] = None
    else:
        d['person_slot'] = None
    # 签底图 URL (admin 后台缩略图用)
    bg_key = d.get('bg_oss_key')
    sample_person_key = d.get('sample_person_oss_key')
    if bg_key or sample_person_key:
        try:
            import sys, os as _os
            sys.path.insert(0, _os.path.dirname(__file__))
            from oss_helper import oss_sign_get
            if bg_key:
                d['bg_url'] = oss_sign_get(bg_key, expires=3600)
            else:
                d['bg_url'] = ''
            if sample_person_key:
                d['sample_person_url'] = oss_sign_get(sample_person_key, expires=3600)
            else:
                d['sample_person_url'] = ''
        except Exception as e:
            print(f"[admin] OSS 签名失败 id={d.get('id')}: {e}", flush=True)
            d.setdefault('bg_url', '')
            d.setdefault('sample_person_url', '')
    else:
        d['bg_url'] = ''
        d['sample_person_url'] = ''
    return d


@router.get("/cover-templates")
def admin_list_cover_templates(request: Request):
    """admin 后台列表: 带 OSS key 不签 URL (admin 端要 OSS 控制台看就自己看)"""
    require_admin(request)
    conn = get_db()
    _ensure_sample_person_column(conn)
    rows = conn.execute("""
        SELECT id, name, category, ratio, bg_oss_key, text_fields_json, line_fields_json, person_slot_json, sample_person_oss_key, preview_oss_key, uploaded_by, created_at
        FROM cover_template ORDER BY created_at DESC
    """).fetchall()
    conn.close()
    return {'templates': [_parse_template_row(r) for r in rows]}


@router.get("/cover-templates/{template_id}")
def admin_get_cover_template(template_id: int, request: Request):
    require_admin(request)
    conn = get_db()
    _ensure_sample_person_column(conn)
    row = conn.execute("""
        SELECT id, name, category, ratio, bg_oss_key, text_fields_json, line_fields_json, person_slot_json, sample_person_oss_key, preview_oss_key, uploaded_by, created_at
        FROM cover_template WHERE id = ?
    """, (template_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, '模板不存在')
    return _parse_template_row(row)


class UpdateCoverTemplateRequest(BaseModel):
    """编辑模板. bg_oss_key 可不传 (不换底图就保留旧值), 传了就换新的"""
    name: str
    category: str = 'other'
    ratio: str = '3:4'
    bg_oss_key: Optional[str] = None       # None = 不换底图
    text_fields: list[CoverTextField]
    line_fields: list[CoverLineField] = []
    person_slot: Optional[CoverPersonSlot] = None
    # sample_person_oss_key 三态: 不传字段 (None) = 保留旧值; "" = 清掉; "kkk" = 换新值
    sample_person_oss_key: Optional[str] = None
    keep_sample_person: bool = True        # 默认保留旧 sample_person; 改成 False 才走 sample_person_oss_key


@router.put("/cover-templates/{template_id}")
def admin_update_cover_template(template_id: int, req: UpdateCoverTemplateRequest, request: Request):
    require_admin(request)
    if req.ratio not in {'9:16', '3:4', '16:9', '1:1'}:
        raise HTTPException(400, f'ratio 必须是 9:16/3:4/16:9/1:1')
    valid_cats = {'kepu', 'zhenjing', 'gushi', 'jiaocheng', 'jianji', 'zhichang', 'xuexi', 'licai', 'other'}
    if req.category not in valid_cats:
        raise HTTPException(400, f'category 必须是 {valid_cats}')
    if req.text_fields and len(req.text_fields) > 10:
        raise HTTPException(400, '最多 10 个文字字段')

    import json as _json
    conn = get_db()
    _ensure_sample_person_column(conn)
    existing = conn.execute(
        "SELECT bg_oss_key, sample_person_oss_key FROM cover_template WHERE id = ?",
        (template_id,)
    ).fetchone()
    if not existing:
        conn.close()
        raise HTTPException(404, '模板不存在')

    # bg_oss_key: None 保留旧值
    new_bg = req.bg_oss_key or existing['bg_oss_key']
    # sample_person_oss_key: keep_sample_person=True 保留旧值; False 用请求体里的 (可空)
    if req.keep_sample_person:
        new_sample = existing['sample_person_oss_key']
    else:
        new_sample = req.sample_person_oss_key or None
    text_fields_json = _json.dumps([f.model_dump() for f in req.text_fields], ensure_ascii=False)
    line_fields_json = _json.dumps([f.model_dump() for f in req.line_fields], ensure_ascii=False)
    person_slot_json = _json.dumps(req.person_slot.model_dump(), ensure_ascii=False) if req.person_slot else None

    conn.execute("""
        UPDATE cover_template
        SET name = ?, category = ?, ratio = ?, bg_oss_key = ?, text_fields_json = ?, line_fields_json = ?, person_slot_json = ?, sample_person_oss_key = ?
        WHERE id = ?
    """, (req.name, req.category, req.ratio, new_bg, text_fields_json, line_fields_json, person_slot_json, new_sample, template_id))
    conn.commit()
    conn.close()
    return {'success': True}


class SetSamplePersonRequest(BaseModel):
    """专门设置/清空示例人物图的请求 — 跟主模板 update 解耦, 上传完直接调."""
    sample_person_oss_key: Optional[str] = None   # None 或 "" 清空; 有值就设


@router.post("/cover-templates/{template_id}/sample-person")
def admin_set_sample_person(template_id: int, req: SetSamplePersonRequest, request: Request):
    """单字段更新: 只动 sample_person_oss_key, 不碰其他字段.
    用于 admin 上传完示例人物 → 抠图完 → 直接调这个, 不依赖完整 PUT update."""
    require_admin(request)
    conn = get_db()
    _ensure_sample_person_column(conn)
    existing = conn.execute("SELECT id FROM cover_template WHERE id = ?", (template_id,)).fetchone()
    if not existing:
        conn.close()
        raise HTTPException(404, '模板不存在')
    new_val = (req.sample_person_oss_key or '').strip() or None
    print(f"[admin] sample-person set: template_id={template_id} new_value={new_val!r}", flush=True)
    conn.execute(
        "UPDATE cover_template SET sample_person_oss_key = ? WHERE id = ?",
        (new_val, template_id)
    )
    conn.commit()
    conn.close()
    print(f"[admin] sample-person 保存成功 template_id={template_id}", flush=True)
    return {'success': True, 'sample_person_oss_key': new_val}


@router.delete("/cover-templates/{template_id}")
def admin_delete_cover_template(template_id: int, request: Request):
    require_admin(request)
    conn = get_db()
    conn.execute("DELETE FROM cover_template WHERE id = ?", (template_id,))
    conn.commit()
    conn.close()
    # 注意: 不主动删 OSS 文件 (lifecycle 自动清, 已渲染的封面不受影响)
    return {'success': True}


# ============== Landing 主页示例视频管理 ==============


class AddLandingDemoRequest(BaseModel):
    title: str = ''
    video_oss_key: str                       # admin 先调 sign-upload (prefix=landing_demos) 上传到 OSS, 给 key
    thumb_oss_key: Optional[str] = None      # 封面图 OSS key, 不传后端可以 ffmpeg 截首帧 (未实现)
    order_index: int = 0
    visible: int = 1


@router.get("/landing-demos")
def admin_list_landing_demos(request: Request):
    """admin 列出所有示例视频 (含隐藏的)"""
    require_admin(request)
    conn = get_db()
    rows = conn.execute("""
        SELECT id, title, video_oss_key, thumb_oss_key, order_index, visible, uploaded_by, created_at
        FROM landing_demo ORDER BY order_index ASC, created_at DESC
    """).fetchall()
    conn.close()
    # 签 1h URL (admin 后台缩略图用)
    import sys, os as _os
    sys.path.insert(0, _os.path.dirname(__file__))
    from oss_helper import oss_sign_get
    items = []
    for r in rows:
        d = dict(r)
        try:
            d['video_url'] = oss_sign_get(d['video_oss_key'], expires=3600)
        except Exception:
            d['video_url'] = ''
        if d.get('thumb_oss_key'):
            try:
                d['thumb_url'] = oss_sign_get(d['thumb_oss_key'], expires=3600)
            except Exception:
                d['thumb_url'] = ''
        else:
            d['thumb_url'] = ''
        items.append(d)
    return {'demos': items}


@router.post("/landing-demos")
def admin_add_landing_demo(req: AddLandingDemoRequest, request: Request):
    """admin 添加一条示例视频. 前端先调 /api/oss/sign-upload (prefix=landing_demos) 上传, 拿 key 再调这里."""
    admin_id = require_admin(request)
    if not req.video_oss_key.strip():
        raise HTTPException(400, 'video_oss_key 不能为空')
    conn = get_db()
    cursor = conn.execute("""
        INSERT INTO landing_demo (title, video_oss_key, thumb_oss_key, order_index, visible, uploaded_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (
        req.title.strip(), req.video_oss_key.strip(), req.thumb_oss_key,
        req.order_index, req.visible, admin_id, time.time(),
    ))
    new_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return {'success': True, 'id': new_id}


class UpdateLandingDemoRequest(BaseModel):
    title: Optional[str] = None
    thumb_oss_key: Optional[str] = None      # None 不变, '' 清掉, 字符串 = 新值
    order_index: Optional[int] = None
    visible: Optional[int] = None


@router.put("/landing-demos/{demo_id}")
def admin_update_landing_demo(demo_id: int, req: UpdateLandingDemoRequest, request: Request):
    """admin 改示例视频的元数据 (改不了视频文件本身, 想换重新创建)."""
    require_admin(request)
    conn = get_db()
    exists = conn.execute("SELECT 1 FROM landing_demo WHERE id = ?", (demo_id,)).fetchone()
    if not exists:
        conn.close()
        raise HTTPException(404, '不存在')
    sets = []
    vals = []
    if req.title is not None:
        sets.append('title = ?'); vals.append(req.title.strip())
    if req.thumb_oss_key is not None:
        sets.append('thumb_oss_key = ?'); vals.append(req.thumb_oss_key or None)
    if req.order_index is not None:
        sets.append('order_index = ?'); vals.append(req.order_index)
    if req.visible is not None:
        sets.append('visible = ?'); vals.append(req.visible)
    if not sets:
        conn.close()
        return {'success': True}
    vals.append(demo_id)
    conn.execute(f"UPDATE landing_demo SET {', '.join(sets)} WHERE id = ?", vals)
    conn.commit()
    conn.close()
    return {'success': True}


@router.delete("/landing-demos/{demo_id}")
def admin_delete_landing_demo(demo_id: int, request: Request):
    require_admin(request)
    conn = get_db()
    conn.execute("DELETE FROM landing_demo WHERE id = ?", (demo_id,))
    conn.commit()
    conn.close()
    return {'success': True}


# ============== 白板背景库管理 ==============


class AddWhiteboardBackgroundRequest(BaseModel):
    name: str = ''
    oss_key: str                             # admin 先调 sign-upload (prefix=whiteboard_bg) 上传 PNG/JPG, 拿 key
    category: str = ''                       # 分类标签 (网格/纯色/纸张...)
    order_index: int = 0
    visible: int = 1


@router.get("/whiteboard-backgrounds")
def admin_list_whiteboard_backgrounds(request: Request):
    """admin 列出所有白板背景 (含隐藏的)."""
    require_admin(request)
    conn = get_db()
    rows = conn.execute("""
        SELECT id, name, oss_key, category, order_index, visible, uploaded_by, created_at
        FROM whiteboard_background ORDER BY order_index ASC, created_at DESC
    """).fetchall()
    conn.close()
    import sys, os as _os
    sys.path.insert(0, _os.path.dirname(__file__))
    from oss_helper import oss_sign_get
    items = []
    for r in rows:
        d = dict(r)
        try:
            d['url'] = oss_sign_get(d['oss_key'], expires=3600)
        except Exception:
            d['url'] = ''
        items.append(d)
    return {'backgrounds': items}


@router.post("/whiteboard-backgrounds")
def admin_add_whiteboard_background(req: AddWhiteboardBackgroundRequest, request: Request):
    """admin 添加一个白板背景图. 前端先调 /api/oss/sign-upload (prefix=whiteboard_bg) 上传 PNG/JPG, 拿 key 再调这里."""
    admin_id = require_admin(request)
    if not req.oss_key.strip():
        raise HTTPException(400, 'oss_key 不能为空')
    conn = get_db()
    cursor = conn.execute("""
        INSERT INTO whiteboard_background (name, oss_key, category, order_index, visible, uploaded_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (
        req.name.strip(), req.oss_key.strip(), req.category.strip(),
        req.order_index, req.visible, admin_id, time.time(),
    ))
    new_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return {'success': True, 'id': new_id}


class UpdateWhiteboardBackgroundRequest(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    order_index: Optional[int] = None
    visible: Optional[int] = None


@router.put("/whiteboard-backgrounds/{bg_id}")
def admin_update_whiteboard_background(bg_id: int, req: UpdateWhiteboardBackgroundRequest, request: Request):
    """admin 改白板背景元数据 (改不了图片本身, 想换重新创建)."""
    require_admin(request)
    conn = get_db()
    exists = conn.execute("SELECT 1 FROM whiteboard_background WHERE id = ?", (bg_id,)).fetchone()
    if not exists:
        conn.close()
        raise HTTPException(404, '不存在')
    sets = []
    vals = []
    if req.name is not None:
        sets.append('name = ?'); vals.append(req.name.strip())
    if req.category is not None:
        sets.append('category = ?'); vals.append(req.category.strip())
    if req.order_index is not None:
        sets.append('order_index = ?'); vals.append(req.order_index)
    if req.visible is not None:
        sets.append('visible = ?'); vals.append(req.visible)
    if not sets:
        conn.close()
        return {'success': True}
    vals.append(bg_id)
    conn.execute(f"UPDATE whiteboard_background SET {', '.join(sets)} WHERE id = ?", vals)
    conn.commit()
    conn.close()
    return {'success': True}


@router.delete("/whiteboard-backgrounds/{bg_id}")
def admin_delete_whiteboard_background(bg_id: int, request: Request):
    require_admin(request)
    conn = get_db()
    conn.execute("DELETE FROM whiteboard_background WHERE id = ?", (bg_id,))
    conn.commit()
    conn.close()
    return {'success': True}


# ============== API 用量 ==============


@router.get("/api-usage")
def admin_api_usage(request: Request, days: int = 7):
    """API 用量汇总. 默认看最近 7 天.

    返:
    - by_provider: 按 provider 聚合 (count/cost_yuan/duration_ms 累计)
    - daily: 最近 N 天每天的累计 (画趋势图)
    - recent: 最近 50 条原始日志
    """
    require_admin(request)
    conn = get_db()
    since = time.time() - days * 86400

    # 按 provider 聚合
    by_provider = conn.execute("""
        SELECT provider,
               COUNT(*) as calls,
               SUM(count) as total_count,
               SUM(tokens) as total_tokens,
               SUM(bytes) as total_bytes,
               SUM(duration_ms) as total_duration_ms,
               SUM(cost_yuan) as total_cost,
               SUM(gpu_used) as gpu_calls
        FROM api_usage_log
        WHERE created_at >= ?
        GROUP BY provider
        ORDER BY total_cost DESC, calls DESC
    """, (since,)).fetchall()

    # 每天聚合
    daily = conn.execute("""
        SELECT date(created_at, 'unixepoch', 'localtime') as day,
               provider,
               SUM(count) as count,
               SUM(cost_yuan) as cost,
               SUM(duration_ms) as duration_ms
        FROM api_usage_log
        WHERE created_at >= ?
        GROUP BY day, provider
        ORDER BY day DESC
    """, (since,)).fetchall()

    # 最近 50 条 (排错用)
    recent = conn.execute("""
        SELECT id, provider, action, user_id, count, tokens, bytes,
               duration_ms, cost_yuan, gpu_used, note, created_at
        FROM api_usage_log
        ORDER BY created_at DESC LIMIT 50
    """).fetchall()

    # 总成本 + 总调用数 (顶部汇总)
    total = conn.execute("""
        SELECT COUNT(*) as calls,
               COALESCE(SUM(cost_yuan), 0) as cost,
               COALESCE(SUM(duration_ms), 0) as duration_ms,
               COALESCE(SUM(gpu_used), 0) as gpu_calls
        FROM api_usage_log WHERE created_at >= ?
    """, (since,)).fetchone()

    conn.close()
    return {
        'days': days,
        'total': dict(total) if total else {},
        'by_provider': [dict(r) for r in by_provider],
        'daily': [dict(r) for r in daily],
        'recent': [dict(r) for r in recent],
    }
