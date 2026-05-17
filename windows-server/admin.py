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

import sqlite3
import time
from typing import Optional
from fastapi import APIRouter, HTTPException, Request, Query
from pydantic import BaseModel

DB_PATH = "monoi.db"

router = APIRouter(prefix="/api/admin")


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


SECRET_KEY = "monoi-secret-key-2025"
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
    return [dict(r) for r in rows]


@router.delete("/bgm-library/{bgm_id}")
def admin_delete_bgm(bgm_id: int, request: Request):
    require_admin(request)
    conn = get_db()
    conn.execute("DELETE FROM bgm_library WHERE id = ?", (bgm_id,))
    conn.commit()
    conn.close()
    # 注意: 不主动删 OSS 文件 (lifecycle 自动清, 或者别的 BGM 用着同一 oss_key)
    return {'success': True}
