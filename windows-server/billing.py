"""monoi 商业化模块: 会员套餐 + 积分扣减 + 三级推广

设计文档: docs/business-model.md

模块结构:
- 套餐 / 积分包 / 扣减规则 配置 (PLANS / CREDIT_PACKS / CONSUME_RATES)
- 9 张新表初始化 (init_billing_tables)
- 积分 helpers (get_balance / consume_credits / add_credits)
- 订阅 helpers (get_user_subscription / activate_subscription)
- 推广 helpers (bind_referrer / get_referrer_level / write_commission)
- FastAPI router (/api/billing/*, /api/referral/*)

V1 阶段:
- 数据库: SQLite (跟 main.py monoi.db 同库, 等迁 RDS MySQL 时一起改 SQL 占位符)
- 支付: 暂时 mock (admin 后台手工开通), V2 接微信/支付宝
- 退款: 不退款 (设计已定)
"""

import sqlite3
import time
import uuid
import secrets
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel


DB_PATH = "monoi.db"


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


# ============================== 套餐 / 积分包 / 扣减规则 配置 ==============================


# 套餐 (tier → 配置). free 用户不需要在 DB 里建订阅 row, 默认就是 free
PLANS = {
    'pro_monthly': {
        'name': 'Pro',
        'price_yuan': 99,
        'period_days': 30,
        'monthly_credits': 1500,
        'credit_pack_rate': 15,                       # 加买积分 ¥1=15 (1.5x 标准)
        'digital_human_quota': 30,                    # 月配额
        'max_avatars': 5,                             # 数字人形象数量上限
        'max_video_minutes': 15,                      # 单视频最长时长
        'max_resolution': '720p',                     # 视频导出最高清晰度
        'clone_voice_slots': 1,
        'multi_platform_accounts': 2,                 # 抖音 1 + 小红书 1
        'team_seats': 0,
        'priority_gpu': False,
        'commercial_license': False,
        'transferable_license': False,                # 转售/代理授权
        'vip_support': False,
        'early_access': False,                        # 提前体验新功能
        'api_access': False,
        'unlimited_duration': False,                  # 不限时长
        'referral_boost': False,                      # 推广分成提升 (旗舰跨过认证门槛)
        'watermark': False,
        'support_response_hours': 24,
    },
    'max_monthly': {
        'name': 'Max',
        'price_yuan': 199,
        'period_days': 30,
        'monthly_credits': 4000,
        'credit_pack_rate': 20,                       # ¥1=20 (2x)
        'digital_human_quota': 100,
        'max_avatars': 10,                            # 数字人形象数量上限
        'max_video_minutes': 30,
        'max_resolution': '1080p',
        'clone_voice_slots': 3,
        'multi_platform_accounts': 4,                 # 抖音 2 + 小红书 2
        'team_seats': 0,
        'priority_gpu': True,
        'commercial_license': True,
        'transferable_license': False,
        'vip_support': False,
        'early_access': False,
        'api_access': False,
        'unlimited_duration': False,
        'referral_boost': False,
        'watermark': False,
        'support_response_hours': 12,
    },
    'flagship_yearly': {
        'name': '旗舰年卡',
        'price_yuan': 2980,
        'period_days': 365,
        'monthly_credits': 5000,                      # 每月入账, 不是一次性 60000
        'yearly_total_credits': 60000,
        'credit_pack_rate': 25,                       # ¥1=25 (2.5x)
        'digital_human_quota': 300,
        'max_avatars': -1,                            # -1 = 不限
        'max_video_minutes': 60,
        'max_resolution': '4K',
        'clone_voice_slots': 5,
        'multi_platform_accounts': 5,                 # 任意平台
        'team_seats': 3,                              # 主账号 + 2 协作
        'priority_gpu': True,
        'commercial_license': True,
        'transferable_license': True,                 # 代理给客户合法
        'vip_support': True,                          # VIP 微信 1v1
        'early_access': True,
        'api_access': True,                           # V2 优先开 API
        'unlimited_duration': True,                   # 不限单视频时长
        'referral_boost': True,                       # 帮推一次性 30% 现金
        'watermark': False,
        'support_response_hours': 1,
    },
}


# 免费用户默认权益 (没记 user_subscription row 时回退)
FREE_PLAN = {
    'name': '免费',
    'price_yuan': 0,
    'monthly_credits': 150,                           # 一次性, 注册时给 (够跑 1-2 个完整流程)
    'credit_pack_rate': 10,                           # ¥1=10 标准
    'digital_human_quota': 3,
    'max_avatars': 1,                                 # 免费只 1 个形象
    'max_video_minutes': 5,
    'max_resolution': '480p',
    'clone_voice_slots': 0,
    'multi_platform_accounts': 1,
    'team_seats': 0,
    'priority_gpu': False,
    'commercial_license': False,
    'transferable_license': False,
    'vip_support': False,
    'early_access': False,
    'api_access': False,
    'unlimited_duration': False,
    'referral_boost': False,
    'watermark': True,                                # 带 monoi 水印
    'support_response_hours': 48,
}


# 单独积分包
CREDIT_PACKS = {
    'pack_99': {'name': '体验包', 'price_yuan': 9.9, 'credits': 100},
    'pack_49': {'name': '小包', 'price_yuan': 49, 'credits': 600},
    'pack_199': {'name': '中包', 'price_yuan': 199, 'credits': 3000},
    'pack_499': {'name': '大包', 'price_yuan': 499, 'credits': 8000},
}


# 积分扣减规则. unit_amount = 积分/秒 或 积分/次
CONSUME_RULES = {
    'voice_preset':     {'per_second': 0.5},        # 预设音色配音
    'voice_clone':      {'per_second': 1.5},        # 克隆音色配音
    'narration_clean':  {'fixed': 5},               # 口播剪辑导出
    'compose_no_dh':    {'fixed': 10},              # 一键合成 (无数字人)
    'digital_human':    {'per_second': 2.0},        # 数字人合成
    'cover_remove_bg':  {'fixed': 2},               # 抠图 (缓存命中不扣)
    # 0 积分功能 (基础福利)
    'script':            {'fixed': 0},              # 文案生成
    'footage_match':     {'fixed': 0},              # 素材匹配
    'cover_generate':    {'fixed': 0},              # 封面生成
    'publish':           {'fixed': 0},              # 自动发布
}


# 推广分成规则 (2026-05-23 重做)
# - 普通用户: 注册推广员 30 积分一次性 (被邀请人 0); 首单 10% 现金; 无续费
# - 认证 / 合伙人: 现金分成, 升级有两条路 — 自动达条件 或 联系客服申请
COMMISSION_RULES = {
    'normal': {                                     # 普通用户
        'register_bonus_credits': 30,               # 仅推广员 +30 积分 (被邀请人 0)
        'first_order_cash_pct': 0.10,               # 首单 10% 现金 (跟认证 30% / 合伙人 50% 形成阶梯)
        'renewal_cash_pct': 0,                      # 普通用户无续费分成 (升认证才有)
        # 注意: 普通用户的首单现金也走 referrer_balance, 跟认证一样, 不另开渠道
    },
    'certified': {                                  # 认证推广员 (现金, 累计 5 人 / ¥500 或客服申请)
        'first_order_cash_pct': 0.30,
        'renewal_cash_pct': 0.10,
        'renewal_months': 3,                        # 续费分成只算前 3 个月
        'min_withdraw_yuan': 100,
        'trigger_paying_users': 5,
        'trigger_revenue_yuan': 500,
    },
    'partner': {                                    # 核心合伙人 (月推 20 人 / ¥3000 或客服申请)
        'first_order_cash_pct': 0.50,
        'renewal_cash_pct': 0.15,
        'renewal_months': 3,
        'min_withdraw_yuan': 100,
        'trigger_monthly_paying_users': 20,
        'trigger_monthly_revenue_yuan': 3000,
    },
}


# ============================== Schema 初始化 ==============================


def init_billing_tables():
    """在 monoi.db 里创建 9 张商业化表 (CREATE TABLE IF NOT EXISTS, 已建跳过)"""
    conn = get_db()
    c = conn.cursor()

    # 1. 用户订阅
    c.execute("""
        CREATE TABLE IF NOT EXISTS user_subscription (
            user_id INTEGER PRIMARY KEY,
            tier TEXT NOT NULL,
            current_period_start REAL NOT NULL,
            current_period_end REAL NOT NULL,
            auto_renew INTEGER DEFAULT 1,
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL
        )
    """)

    # 2. 积分余额 (两个 bucket: 月送 + 加买)
    c.execute("""
        CREATE TABLE IF NOT EXISTS credit_balance (
            user_id INTEGER PRIMARY KEY,
            monthly_credits INTEGER DEFAULT 0,
            monthly_credits_reset_at REAL,
            purchased_credits INTEGER DEFAULT 0,
            updated_at REAL NOT NULL
        )
    """)

    # 3. 积分流水
    c.execute("""
        CREATE TABLE IF NOT EXISTS credit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            feature TEXT,
            delta INTEGER NOT NULL,
            source TEXT NOT NULL,
            ref_id TEXT,
            created_at REAL NOT NULL
        )
    """)
    c.execute("CREATE INDEX IF NOT EXISTS idx_credit_log_user ON credit_log(user_id, created_at DESC)")

    # 4. 订单 (套餐 + 积分包)
    c.execute("""
        CREATE TABLE IF NOT EXISTS billing_orders (
            id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            order_type TEXT NOT NULL,
            product_code TEXT NOT NULL,
            amount_yuan REAL NOT NULL,
            credits_added INTEGER DEFAULT 0,
            status TEXT DEFAULT 'pending',
            payment_method TEXT,
            paid_at REAL,
            refunded_at REAL,
            referrer_id INTEGER,
            created_at REAL NOT NULL
        )
    """)
    c.execute("CREATE INDEX IF NOT EXISTS idx_billing_orders_user ON billing_orders(user_id, created_at DESC)")
    # V2 支付集成: 加 4 个列 (ALTER 失败说明列已存在, 跳过)
    for col_def in [
        "ALTER TABLE billing_orders ADD COLUMN payment_channel TEXT",      # wechat / alipay / manual
        "ALTER TABLE billing_orders ADD COLUMN wx_prepay_id TEXT",
        "ALTER TABLE billing_orders ADD COLUMN wx_code_url TEXT",
        "ALTER TABLE billing_orders ADD COLUMN wx_transaction_id TEXT",
        "ALTER TABLE billing_orders ADD COLUMN expires_at REAL",           # 订单过期时间 (默认 5 分钟)
    ]:
        try: c.execute(col_def)
        except sqlite3.OperationalError: pass
    c.execute("CREATE INDEX IF NOT EXISTS idx_billing_orders_wx_txn ON billing_orders(wx_transaction_id)")

    # BGM 库 (admin 上传的无版权 BGM, 用户合成视频时选用)
    c.execute("""
        CREATE TABLE IF NOT EXISTS bgm_library (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,                    -- 显示名 例 "阳光夏日"
            category TEXT NOT NULL DEFAULT 'other',  -- upbeat/calm/inspirational/cinematic/electronic/chinese/other
            oss_key TEXT NOT NULL,                 -- 上传到 OSS 的 key
            duration_seconds REAL DEFAULT 0,
            license_note TEXT,                     -- 例 "Pixabay Free License, 完全可商用"
            uploaded_by INTEGER,                   -- admin user_id
            created_at REAL NOT NULL
        )
    """)
    c.execute("CREATE INDEX IF NOT EXISTS idx_bgm_library_category ON bgm_library(category, created_at DESC)")

    # free 用户每天领取记录 (注册起 7 天每天送 60 积分, 7 天后停)
    c.execute("""
        CREATE TABLE IF NOT EXISTS daily_credit_grant (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            grant_date TEXT NOT NULL,              -- 'YYYY-MM-DD' 本地日期
            amount INTEGER NOT NULL,
            granted_at REAL NOT NULL,
            UNIQUE(user_id, grant_date)            -- 一天最多领一次
        )
    """)
    c.execute("CREATE INDEX IF NOT EXISTS idx_daily_grant_user ON daily_credit_grant(user_id, grant_date DESC)")

    # 字体库 (admin 上传的 ttf/otf, 跟内置 _FONT_CATALOG 合并给前端选)
    c.execute("""
        CREATE TABLE IF NOT EXISTS font_library (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            label TEXT NOT NULL,                   -- 显示名 例 "庞门正道粗书"
            file TEXT NOT NULL UNIQUE,             -- D:\\monoi-server\\fonts\\ 下的文件名 例 "pmzd.ttf"
            tag TEXT,                              -- 风格标签 例 "粗黑·标题首选"
            license_note TEXT,                     -- 例 "免费可商用 — 官方授权"
            uploaded_by INTEGER,                   -- admin user_id
            created_at REAL NOT NULL
        )
    """)

    # API 用量日志 (admin 看 OpenAI/DeepSeek/OSS/SMS/Captcha/Pexels 等各家累计消耗)
    c.execute("""
        CREATE TABLE IF NOT EXISTS api_usage_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            provider TEXT NOT NULL,                -- openai / deepseek / oss / sms / captcha / pexels / pixabay / wxpay / cosyvoice / demucs / rembg
            action TEXT,                           -- chat_completion / sign_get / send / verify / search_video / synthesize / remove_bg ...
            user_id INTEGER,                       -- 哪个用户触发 (None = 系统调用)
            count INTEGER DEFAULT 1,               -- 调用次数 (单次=1, 批量可>1)
            tokens INTEGER DEFAULT 0,              -- LLM tokens (input + output, 仅 LLM API)
            bytes INTEGER DEFAULT 0,               -- 流量 (OSS / 视频下载 etc)
            duration_ms INTEGER DEFAULT 0,         -- 调用耗时 (毫秒, 给 GPU 任务用)
            cost_yuan REAL DEFAULT 0,              -- 估算 ¥成本 (按各家费率算)
            gpu_used INTEGER DEFAULT 0,            -- 是否用 GPU (0/1, 给未来 GPU 服务器埋点)
            note TEXT,                             -- 例: model='gpt-4o-mini' / pack='99张验证码'
            created_at REAL NOT NULL
        )
    """)
    c.execute("CREATE INDEX IF NOT EXISTS idx_api_usage_provider ON api_usage_log(provider, created_at DESC)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_api_usage_user ON api_usage_log(user_id, created_at DESC)")

    # 封面模板库 (admin 上传 PNG 底图 + 文字字段配置, 用户填字 Pillow 渲染)
    c.execute("""
        CREATE TABLE IF NOT EXISTS cover_template (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,                    -- 显示名 例 "震惊体红黄底"
            category TEXT NOT NULL DEFAULT 'other', -- 科普/震惊/故事/教程/极简/职场/学习/理财/other
            ratio TEXT NOT NULL DEFAULT '3:4',     -- 9:16 / 3:4 / 16:9 / 1:1 (底图比例)
            bg_oss_key TEXT NOT NULL,              -- 底图 PNG 上传到 OSS
            text_fields_json TEXT NOT NULL,        -- JSON 数组, 每元素 {label,x,y,w,h,font_file,font_size,color,highlight_color,stroke_*,shadow_*,align,max_chars,placeholder}
            person_slot_json TEXT,                 -- (可选) 人物坑配置 {x,y,w,h,stroke_color,stroke_width,fit_mode} — 不要人物的模板填 NULL
            preview_oss_key TEXT,                  -- (可选) 一张带示例标题的预览图 (admin 上传时 server 渲染好缓存)
            uploaded_by INTEGER,
            created_at REAL NOT NULL
        )
    """)
    c.execute("CREATE INDEX IF NOT EXISTS idx_cover_template_category ON cover_template(category, created_at DESC)")

    # 给老表加 person_slot_json (老 db 跑过没这列时, 加一下)
    try:
        c.execute("ALTER TABLE cover_template ADD COLUMN person_slot_json TEXT")
    except Exception:
        pass    # 已经有了, 跳过

    # 5. 推广绑定 (用户首次注册时记, 终身不变)
    c.execute("""
        CREATE TABLE IF NOT EXISTS referral_binding (
            user_id INTEGER PRIMARY KEY,
            referrer_id INTEGER NOT NULL,
            referral_code_used TEXT,
            bound_at REAL NOT NULL
        )
    """)
    c.execute("CREATE INDEX IF NOT EXISTS idx_referral_binding_referrer ON referral_binding(referrer_id)")

    # 6. 推广员等级状态
    c.execute("""
        CREATE TABLE IF NOT EXISTS referrer_status (
            user_id INTEGER PRIMARY KEY,
            level TEXT DEFAULT 'normal',
            referral_code TEXT UNIQUE NOT NULL,
            total_paying_users INTEGER DEFAULT 0,
            total_revenue_brought REAL DEFAULT 0,
            month_paying_users INTEGER DEFAULT 0,
            month_revenue_brought REAL DEFAULT 0,
            month_stats_reset_at REAL,
            alipay_account TEXT,
            wechat_account TEXT,
            level_upgraded_at REAL,
            updated_at REAL NOT NULL
        )
    """)

    # 7. 佣金流水
    c.execute("""
        CREATE TABLE IF NOT EXISTS commission_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id TEXT NOT NULL,
            beneficiary_user_id INTEGER NOT NULL,
            beneficiary_level TEXT NOT NULL,
            commission_type TEXT NOT NULL,
            renewal_month_index INTEGER,
            credits INTEGER DEFAULT 0,
            cash_yuan REAL DEFAULT 0,
            status TEXT DEFAULT 'pending',
            settled_at REAL,
            created_at REAL NOT NULL
        )
    """)
    c.execute("CREATE INDEX IF NOT EXISTS idx_commission_log_beneficiary ON commission_log(beneficiary_user_id, created_at DESC)")

    # 8. 推广员余额
    c.execute("""
        CREATE TABLE IF NOT EXISTS referrer_balance (
            user_id INTEGER PRIMARY KEY,
            cash_balance REAL DEFAULT 0,
            cash_withdrawn_total REAL DEFAULT 0,
            updated_at REAL NOT NULL
        )
    """)

    # 9. 提现申请
    c.execute("""
        CREATE TABLE IF NOT EXISTS withdrawal_request (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            amount_yuan REAL NOT NULL,
            payment_method TEXT NOT NULL,
            account_info TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            admin_note TEXT,
            created_at REAL NOT NULL,
            processed_at REAL
        )
    """)

    # 10. rembg 抠图缓存 — 同一张图 + 同一组 stroke 参数命中就复用, 不重跑 rembg 不再次扣积分
    c.execute("""
        CREATE TABLE IF NOT EXISTS rembg_cache (
            cache_key TEXT PRIMARY KEY,        -- sha256(file_bytes) + ":" + stroke 三参数
            oss_key TEXT NOT NULL,             -- 抠图结果 OSS key (cover_person/ 前缀)
            created_at REAL NOT NULL,
            hit_count INTEGER DEFAULT 0,       -- 命中次数 (运营观察)
            file_size INTEGER,                 -- 原图大小, 统计用
            user_id INTEGER                    -- 首次上传的用户 (统计用, 不用来权限)
        )
    """)
    c.execute("CREATE INDEX IF NOT EXISTS idx_rembg_cache_created ON rembg_cache(created_at DESC)")

    # 12. Landing 主页示例视频 — admin 上传, 公开展示给所有访客看 (转化用)
    c.execute("""
        CREATE TABLE IF NOT EXISTS landing_demo (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL DEFAULT '',           -- 视频标题, 鼠标悬停显示
            video_oss_key TEXT NOT NULL,              -- 视频文件 OSS key (landing_demos/)
            thumb_oss_key TEXT,                       -- 封面图 OSS key (可选, 不传后端用 ffmpeg 截首帧)
            order_index INTEGER DEFAULT 0,            -- 显示顺序 (小的在前)
            visible INTEGER DEFAULT 1,                -- 1 = 显示, 0 = 隐藏 (留库不展示)
            uploaded_by INTEGER,                      -- admin user_id
            created_at REAL NOT NULL
        )
    """)
    c.execute("CREATE INDEX IF NOT EXISTS idx_landing_demo_visible ON landing_demo(visible, order_index)")

    # 11. 用户人物库 — 用户抠过的所有人物图, "我的人物" 列表用
    # 跟 rembg_cache 互补: rembg_cache 是字节级去重 (内部缓存), user_person_cutout 是用户视角的资产列表.
    # 同一个 user 多次抠出来的图都进这里 (即使源图字节一样, 也至少留一条 — 用户可能想多版本对比).
    c.execute("""
        CREATE TABLE IF NOT EXISTS user_person_cutout (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            oss_key TEXT NOT NULL,             -- 抠图结果 OSS key (cover_person/ 前缀)
            original_filename TEXT,            -- 原文件名 (例 "我.jpg"), 列表展示用
            stroke_enabled INTEGER DEFAULT 0,
            stroke_color TEXT,
            stroke_width INTEGER DEFAULT 0,
            created_at REAL NOT NULL,
            last_used_at REAL NOT NULL,
            use_count INTEGER DEFAULT 1
        )
    """)
    c.execute("CREATE INDEX IF NOT EXISTS idx_user_person_cutout_user ON user_person_cutout(user_id, last_used_at DESC)")

    conn.commit()
    conn.close()
    print("[billing] 12 张商业化表已初始化 (CREATE IF NOT EXISTS)", flush=True)


# ============================== 积分 helpers ==============================


DAILY_FREE_GRANT_AMOUNT = 60       # free 用户每天送多少
DAILY_FREE_GRANT_DAYS = 7          # 送几天 (注册起算)


def try_daily_grant(user_id: int) -> Optional[dict]:
    """free 用户每天送 60 积分, 注册起 7 天后停.

    Returns {granted: bool, amount, day_index, days_remaining} 或 None (拿不到 user).
    幂等 — 一天最多 grant 一次 (靠 UNIQUE(user_id, grant_date) 约束).
    """
    conn = get_db()
    try:
        user_row = conn.execute("SELECT created_at FROM users WHERE id = ?", (user_id,)).fetchone()
        if not user_row:
            return None
        # created_at 兼容: 老用户可能存的是 ISO 字符串, 新用户是 Unix 时间戳 float.
        # 拿不到合法时间戳直接跳 grant, 不抠这个 (admin 自己看哪些用户存错了再补).
        raw_created = user_row['created_at']
        try:
            if isinstance(raw_created, (int, float)):
                created_at = float(raw_created)
            elif isinstance(raw_created, str):
                # 尝试 1: 字符串里就是数字
                try:
                    created_at = float(raw_created)
                except ValueError:
                    # 尝试 2: ISO 8601 格式 "2024-05-19T10:00:00" 之类
                    import datetime as _dt
                    created_at = _dt.datetime.fromisoformat(raw_created.replace('Z', '+00:00')).timestamp()
            else:
                return None
        except Exception:
            return None
        # 注册的几天后了 (注册当天 = day 1)
        days_since = (time.time() - created_at) / 86400
        day_index = int(days_since) + 1     # 1..N

        # 只 free 用户走 (付费用户的月送积分不该每天清)
        sub_row = conn.execute(
            "SELECT tier, current_period_end FROM user_subscription WHERE user_id = ?",
            (user_id,)
        ).fetchone()
        is_free = (not sub_row) or (sub_row['current_period_end'] or 0) < time.time()
        if not is_free:
            return {'granted': False, 'amount': 0, 'day_index': day_index, 'days_remaining': max(0, DAILY_FREE_GRANT_DAYS - day_index)}

        # 曾经付费过 (user_subscription 有 row 就算曾经付过, 哪怕现在过期) → 不再发 daily grant
        # 但 Phase 1 清零照旧, 用户明确选择 "过期回 free 积分也清"
        ever_paid = sub_row is not None

        today = time.strftime('%Y-%m-%d', time.localtime())

        # ============== Phase 1: 只要当前是 free, 每天清 monthly_credits ==============
        # 用户规则: free 状态下积分 "当天不用就没". 不管 free 是因为新注册还是付费过期 — 一视同仁.
        # 付费过期回 free 后, 剩余的积分也会被这里清零 (用户明确选择的策略).
        # monthly_credits_reset_at 防一天清多次.
        cb_row = conn.execute(
            "SELECT monthly_credits, monthly_credits_reset_at FROM credit_balance WHERE user_id = ?",
            (user_id,)
        ).fetchone()
        old_monthly = (cb_row['monthly_credits'] or 0) if cb_row else 0
        last_reset_ts = (cb_row['monthly_credits_reset_at'] or 0) if cb_row else 0
        last_reset_day = time.strftime('%Y-%m-%d', time.localtime(last_reset_ts)) if last_reset_ts else ''
        if last_reset_day != today and old_monthly > 0:
            conn.execute(
                "UPDATE credit_balance SET monthly_credits = 0, monthly_credits_reset_at = ?, updated_at = ? WHERE user_id = ?",
                (time.time(), time.time(), user_id)
            )
            conn.execute(
                """INSERT INTO credit_log (user_id, feature, delta, source, ref_id, created_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (user_id, 'daily_free_expire', -old_monthly, 'daily_expire', today, time.time())
            )
            conn.commit()

        # ============== Phase 2: 超过 7 天 / 曾经付费过 → 不送新积分 ==============
        # daily grant 只送给"首次注册" 的全新用户. 付费过的 (即使现在过期) 不再发.
        if day_index > DAILY_FREE_GRANT_DAYS or ever_paid:
            return {
                'granted': False, 'amount': 0,
                'day_index': day_index, 'days_remaining': 0,
                'expired_yesterday': old_monthly if last_reset_day != today else 0,
                'reason': 'ever_paid' if ever_paid else 'past_7_days',
            }

        # ============== Phase 3: 今天还没送过 → 送 60 ==============
        already = conn.execute(
            "SELECT 1 FROM daily_credit_grant WHERE user_id = ? AND grant_date = ?",
            (user_id, today)
        ).fetchone()
        if already:
            return {'granted': False, 'amount': 0, 'day_index': day_index, 'days_remaining': DAILY_FREE_GRANT_DAYS - day_index, 'reason': 'already_today'}

        try:
            conn.execute("""
                INSERT INTO daily_credit_grant (user_id, grant_date, amount, granted_at)
                VALUES (?, ?, ?, ?)
            """, (user_id, today, DAILY_FREE_GRANT_AMOUNT, time.time()))
            conn.commit()
        except sqlite3.IntegrityError:
            return {'granted': False, 'amount': 0, 'day_index': day_index, 'days_remaining': DAILY_FREE_GRANT_DAYS - day_index, 'reason': 'race'}
    finally:
        conn.close()

    # 加今天的 grant (放 monthly_credits)
    add_credits(user_id, DAILY_FREE_GRANT_AMOUNT, 'daily_free_grant',
                ref_id=today, to_monthly=True, feature='daily_free_grant')
    return {
        'granted': True, 'amount': DAILY_FREE_GRANT_AMOUNT,
        'day_index': day_index, 'days_remaining': DAILY_FREE_GRANT_DAYS - day_index,
        'expired_yesterday': old_monthly if last_reset_day != today else 0,
    }


def log_api_usage(
    provider: str,
    action: str = '',
    user_id: Optional[int] = None,
    count: int = 1,
    tokens: int = 0,
    bytes: int = 0,
    duration_ms: int = 0,
    cost_yuan: float = 0,
    gpu_used: bool = False,
    note: str = '',
) -> None:
    """记一条 API 用量日志. 各 service 在调用第三方 API 后调一下, 给 admin 后台看消耗.

    用法:
        log_api_usage('deepseek', 'chat_completion', user_id=42, tokens=1500, cost_yuan=0.003)
        log_api_usage('oss', 'sign_get', count=1, cost_yuan=0)
        log_api_usage('sms', 'send_verify', user_id=42, count=1, cost_yuan=0.045)
        log_api_usage('cosyvoice', 'synthesize', user_id=42, duration_ms=8000, gpu_used=False)
    """
    try:
        conn = get_db()
        conn.execute("""
            INSERT INTO api_usage_log
                (provider, action, user_id, count, tokens, bytes, duration_ms, cost_yuan, gpu_used, note, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (provider, action, user_id, count, tokens, bytes, duration_ms, cost_yuan, 1 if gpu_used else 0, note, time.time()))
        conn.commit()
        conn.close()
    except Exception as e:
        # 埋点失败不影响主流程, 只打日志
        print(f"[log_api_usage] 失败但忽略: {provider}/{action} - {e}")


def get_balance(user_id: int) -> dict:
    """返回完整额度信息. free 用户走 daily grant (注册起 7 天, 每天 60 积分),
    付费用户走 monthly_credits 套餐配额."""
    conn = get_db()
    row = conn.execute(
        "SELECT monthly_credits, monthly_credits_reset_at, purchased_credits FROM credit_balance WHERE user_id = ?",
        (user_id,)
    ).fetchone()

    monthly = (row['monthly_credits'] or 0) if row else 0
    purchased = (row['purchased_credits'] or 0) if row else 0
    reset_at = (row['monthly_credits_reset_at'] or 0) if row else 0

    # 拿当前订阅
    sub = get_user_subscription(user_id)
    tier = sub.get('tier', 'free')

    daily_grant_info = None
    if tier == 'free':
        # free 用户 quota = 7 × 60 = 420 (总送额), used = 累计已发 - 当前剩余
        granted_total = conn.execute(
            "SELECT COALESCE(SUM(amount), 0) FROM daily_credit_grant WHERE user_id = ?",
            (user_id,)
        ).fetchone()[0] or 0
        quota = DAILY_FREE_GRANT_AMOUNT * DAILY_FREE_GRANT_DAYS
        used = max(0, granted_total - monthly)
        # 算今天能不能领 + 还能领几天
        user_row = conn.execute("SELECT created_at FROM users WHERE id = ?", (user_id,)).fetchone()
        if user_row:
            day_index = int((time.time() - user_row['created_at']) / 86400) + 1
            today = time.strftime('%Y-%m-%d', time.localtime())
            granted_today = conn.execute(
                "SELECT 1 FROM daily_credit_grant WHERE user_id = ? AND grant_date = ?",
                (user_id, today)
            ).fetchone() is not None
            daily_grant_info = {
                'day_index': day_index,
                'days_remaining': max(0, DAILY_FREE_GRANT_DAYS - day_index + 1),
                'granted_today': granted_today,
                'daily_amount': DAILY_FREE_GRANT_AMOUNT,
                'total_days': DAILY_FREE_GRANT_DAYS,
            }
    else:
        quota = int(sub.get('monthly_credits', 0) or 0)
        used = max(0, quota - monthly)

    conn.close()
    used_pct = round(used / quota * 100, 1) if quota > 0 else 0

    return {
        'monthly': monthly,
        'purchased': purchased,
        'total': monthly + purchased,
        'monthly_quota': quota,
        'monthly_used': used,
        'monthly_used_pct': used_pct,
        'reset_at': reset_at,
        'tier': tier,
        'daily_grant': daily_grant_info,    # free 用户有这个, 付费用户 None
    }


def consume_credits(user_id: int, feature: str, amount: int, ref_id: Optional[str] = None):
    """扣积分. 优先扣 monthly, 不够扣 purchased. 不够抛 HTTPException(402)."""
    if amount <= 0:
        return  # 0 积分功能直接放过
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT monthly_credits, purchased_credits FROM credit_balance WHERE user_id = ?",
            (user_id,)
        ).fetchone()
        monthly = row['monthly_credits'] if row else 0
        purchased = row['purchased_credits'] if row else 0
        total = (monthly or 0) + (purchased or 0)
        if total < amount:
            # 不暴露 "需要 X 积分" 具体值, 体验更顺 (后端 credit_log 仍记账给 admin)
            raise HTTPException(402, f"积分余额不足. 当前剩 {total} 积分, 升级套餐获更多月送积分, 或购买积分包补充.")
        from_monthly = min(monthly or 0, amount)
        from_purchased = amount - from_monthly
        now = time.time()
        conn.execute("""
            UPDATE credit_balance
            SET monthly_credits = monthly_credits - ?,
                purchased_credits = purchased_credits - ?,
                updated_at = ?
            WHERE user_id = ?
        """, (from_monthly, from_purchased, now, user_id))
        conn.execute("""
            INSERT INTO credit_log (user_id, feature, delta, source, ref_id, created_at)
            VALUES (?, ?, ?, 'consume', ?, ?)
        """, (user_id, feature, -amount, ref_id, now))
        conn.commit()
    finally:
        conn.close()


def add_credits(user_id: int, amount: int, source: str, ref_id: Optional[str] = None,
                to_monthly: bool = False, feature: Optional[str] = None):
    """加积分.
    - to_monthly=True: 加到 monthly_credits (会员月送)
    - to_monthly=False: 加到 purchased_credits (买的 / 推广奖励 / 退款)
    """
    if amount <= 0:
        return
    conn = get_db()
    now = time.time()
    # 确保 row 存在
    conn.execute("""
        INSERT OR IGNORE INTO credit_balance (user_id, monthly_credits, purchased_credits, updated_at)
        VALUES (?, 0, 0, ?)
    """, (user_id, now))
    col = 'monthly_credits' if to_monthly else 'purchased_credits'
    conn.execute(f"""
        UPDATE credit_balance SET {col} = {col} + ?, updated_at = ? WHERE user_id = ?
    """, (amount, now, user_id))
    conn.execute("""
        INSERT INTO credit_log (user_id, feature, delta, source, ref_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (user_id, feature, amount, source, ref_id, now))
    conn.commit()
    conn.close()


def calculate_consume(feature: str, **params) -> int:
    """根据 CONSUME_RULES 计算应扣积分.
    - per_second 类: 传 duration (秒)
    - fixed 类: 直接返回
    """
    rule = CONSUME_RULES.get(feature)
    if not rule:
        return 0
    if 'fixed' in rule:
        return int(rule['fixed'])
    if 'per_second' in rule:
        duration = params.get('duration', 0)
        return max(1, int(rule['per_second'] * duration))
    return 0


# ============================== 订阅 helpers ==============================


def get_user_subscription(user_id: int) -> dict:
    """返回当前订阅. 没有或过期 = free 默认."""
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM user_subscription WHERE user_id = ?", (user_id,)
    ).fetchone()
    conn.close()
    if not row:
        return {'tier': 'free', 'expired': True, **FREE_PLAN}
    sub = dict(row)
    sub['expired'] = sub['current_period_end'] < time.time()
    if sub['expired']:
        sub['tier'] = 'free'
        sub.update(FREE_PLAN)
    else:
        sub.update(PLANS.get(sub['tier'], {}))
    return sub


def count_feature_usage_this_month(user_id: int, feature: str) -> int:
    """统计本月用户某 feature 的调用次数 (按 credit_log 行数), 用于配额检查 (数字人 / 去人声等).

    本月起算 = 当月 1 号 00:00. credit_log.delta < 0 (扣分) 的 feature 行才算 (排除赠送行).
    """
    import time as _t
    # 本月 1 号 0 点的 Unix 时间戳
    _tm = _t.localtime()
    month_start = _t.mktime((_tm.tm_year, _tm.tm_mon, 1, 0, 0, 0, 0, 0, -1))
    conn = get_db()
    row = conn.execute(
        "SELECT COUNT(*) FROM credit_log WHERE user_id = ? AND feature = ? AND delta < 0 AND created_at >= ?",
        (user_id, feature, month_start)
    ).fetchone()
    conn.close()
    return int(row[0]) if row else 0


# 套餐等级排序 (低到高), 用于 tier 门禁判断
_TIER_ORDER = ['free', 'pro_monthly', 'max_monthly', 'flagship_yearly']
_TIER_DISPLAY = {
    'free': '免费', 'pro_monthly': 'Pro', 'max_monthly': 'Max', 'flagship_yearly': '旗舰',
}


def check_feature_tier(user_id: int, feature_name: str, min_tier: str):
    """检查用户当前 tier 够不够用某个功能. 不够抛 402.

    feature_name: 给用户看的中文功能名 (例 '去人声')
    min_tier: 最低需要的 tier (例 'max_monthly')
    """
    sub = get_user_subscription(user_id)
    user_tier = sub.get('tier', 'free')
    try:
        user_idx = _TIER_ORDER.index(user_tier)
        min_idx = _TIER_ORDER.index(min_tier)
    except ValueError:
        return  # 未知 tier, 不强制
    if user_idx < min_idx:
        raise HTTPException(
            402,
            f"{feature_name} 需要 {_TIER_DISPLAY.get(min_tier, min_tier)} 套餐及以上, 升级后即可使用",
        )


def check_feature_quota(user_id: int, feature: str, quota_field: str):
    """检查用户本月某 feature 配额. 超额抛 402.
    quota_field 是 PLANS / FREE_PLAN 里的字段名 (例 'digital_human_quota').
    quota = -1 表示不限."""
    sub = get_user_subscription(user_id)
    quota = int(sub.get(quota_field, 0) or 0)
    if quota < 0:
        return  # 不限
    used = count_feature_usage_this_month(user_id, feature)
    if used >= quota:
        raise HTTPException(402, f"本月{quota_field} {quota} 已用完, 升级套餐或下个月再试 (已用 {used}/{quota})")


def activate_subscription(user_id: int, tier: str, payment_method: str = 'manual',
                          referrer_id: Optional[int] = None, order_id: Optional[str] = None):
    """开通/续费订阅. 加月度积分, 写订单, 触发推广佣金."""
    if tier not in PLANS:
        raise HTTPException(400, f"未知套餐 {tier}")
    plan = PLANS[tier]
    now = time.time()
    end = now + plan['period_days'] * 86400

    conn = get_db()
    # upsert subscription
    existing = conn.execute(
        "SELECT current_period_end FROM user_subscription WHERE user_id = ?", (user_id,)
    ).fetchone()
    if existing and existing['current_period_end'] > now:
        # 续费: 在原 period_end 基础上加
        end = existing['current_period_end'] + plan['period_days'] * 86400
        conn.execute("""
            UPDATE user_subscription
            SET tier = ?, current_period_end = ?, updated_at = ?
            WHERE user_id = ?
        """, (tier, end, now, user_id))
    else:
        # 新开或过期重开
        conn.execute("""
            INSERT OR REPLACE INTO user_subscription
              (user_id, tier, current_period_start, current_period_end, auto_renew, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, ?, ?)
        """, (user_id, tier, now, end, now, now))
    conn.commit()
    conn.close()

    # 加月度积分
    if plan['monthly_credits'] > 0:
        add_credits(user_id, plan['monthly_credits'], 'subscription_grant',
                    ref_id=order_id, to_monthly=True, feature=tier)

    # 触发推广佣金 (在订单 webhook 里调用更合适, 这里留接口)
    if referrer_id and order_id:
        write_first_order_commission(order_id, referrer_id, user_id, plan['price_yuan'], tier)


# ============================== 推广 helpers ==============================


def gen_referral_code(user_id: int) -> str:
    """生成 6 位推广码, 跟 user_id 关联. 没冲突就直接用."""
    base = secrets.token_urlsafe(4).replace('_', '').replace('-', '')[:6].upper()
    return f"M{user_id}{base[:4]}"  # 前缀 M + user_id + 4 位随机


def ensure_referrer_status(user_id: int) -> dict:
    """保证 referrer_status row 存在 (注册时调用)."""
    conn = get_db()
    row = conn.execute("SELECT * FROM referrer_status WHERE user_id = ?", (user_id,)).fetchone()
    if row:
        conn.close()
        return dict(row)
    code = gen_referral_code(user_id)
    now = time.time()
    conn.execute("""
        INSERT INTO referrer_status (user_id, level, referral_code, total_paying_users,
                                      total_revenue_brought, month_paying_users, month_revenue_brought,
                                      month_stats_reset_at, updated_at)
        VALUES (?, 'normal', ?, 0, 0, 0, 0, ?, ?)
    """, (user_id, code, now, now))
    conn.commit()
    row = conn.execute("SELECT * FROM referrer_status WHERE user_id = ?", (user_id,)).fetchone()
    conn.close()
    return dict(row)


def bind_referrer(user_id: int, referral_code: str) -> bool:
    """用户首次注册时绑定推广关系. 已绑定则 no-op (终身不变).
    奖励规则 (2026-05-23 重做): **仅推广员 +30 积分**, 被邀请人 0."""
    conn = get_db()
    existing = conn.execute(
        "SELECT 1 FROM referral_binding WHERE user_id = ?", (user_id,)
    ).fetchone()
    if existing:
        conn.close()
        print(f"[bind_referrer] skip — user={user_id} 已绑定过推广关系", flush=True)
        return False
    referrer = conn.execute(
        "SELECT user_id FROM referrer_status WHERE referral_code = ?", (referral_code,)
    ).fetchone()
    if not referrer:
        conn.close()
        print(f"[bind_referrer] fail — referral_code={referral_code!r} 找不到对应推广员", flush=True)
        return False
    if referrer['user_id'] == user_id:
        conn.close()
        print(f"[bind_referrer] fail — user={user_id} 用了自己的推广码", flush=True)
        return False
    now = time.time()
    conn.execute("""
        INSERT INTO referral_binding (user_id, referrer_id, referral_code_used, bound_at)
        VALUES (?, ?, ?, ?)
    """, (user_id, referrer['user_id'], referral_code, now))
    conn.commit()
    conn.close()
    # 仅推广员 +30 积分 (被邀请人 0, 跟之前规则不同)
    bonus = COMMISSION_RULES['normal']['register_bonus_credits']
    try:
        add_credits(referrer['user_id'], bonus, 'referral', ref_id=f"register_{user_id}", feature='register_referrer')
        print(f"[bind_referrer] OK — referrer={referrer['user_id']} +{bonus} 积分; invitee={user_id} 0 积分", flush=True)
    except Exception as _e:
        print(f"[bind_referrer] 绑定成功但加积分失败: {_e}", flush=True)
    return True


def get_referrer_id(user_id: int) -> Optional[int]:
    conn = get_db()
    row = conn.execute(
        "SELECT referrer_id FROM referral_binding WHERE user_id = ?", (user_id,)
    ).fetchone()
    conn.close()
    return row['referrer_id'] if row else None


def write_first_order_commission(order_id: str, referrer_id: int, buyer_id: int,
                                  amount_yuan: float, product_code: str):
    """订单首单 → 写推广佣金 + 推广员余额涨 + 检查升级."""
    status = get_referrer_status_dict(referrer_id)
    level = status['level']
    now = time.time()

    conn = get_db()
    # 不再区分 normal vs certified/partner 走积分还是现金 —
    # 所有级别都给现金, 只是 % 不同 (普通 10% / 认证 30% / 合伙人 50%).
    # 跟 2026-05-23 拍板的新规则对齐.
    rules = COMMISSION_RULES[level]
    pct = rules.get('first_order_cash_pct', 0)
    cash = round(amount_yuan * pct, 2)
    # status: pending — 等 T+7 退款窗口过后再 settle 给余额
    # 但普通级历史上是 'settled' 直接到账, 为保守这里也走 pending 跟其他级别一致
    conn.execute("""
        INSERT INTO commission_log (order_id, beneficiary_user_id, beneficiary_level,
                                     commission_type, credits, cash_yuan, status, created_at)
        VALUES (?, ?, ?, 'first_order', 0, ?, 'pending', ?)
    """, (order_id, referrer_id, level, cash, now))
    if cash > 0:
        # 推广员余额涨
        conn.execute("""
            INSERT OR IGNORE INTO referrer_balance (user_id, cash_balance, cash_withdrawn_total, updated_at)
            VALUES (?, 0, 0, ?)
        """, (referrer_id, now))
        conn.execute("""
            UPDATE referrer_balance SET cash_balance = cash_balance + ?, updated_at = ? WHERE user_id = ?
        """, (cash, now, referrer_id))
    conn.commit()
    conn.close()

    # 更新 referrer 累计统计
    update_referrer_stats(referrer_id, amount_yuan, is_new_paying_user=True)


def get_referrer_status_dict(user_id: int) -> dict:
    conn = get_db()
    row = conn.execute("SELECT * FROM referrer_status WHERE user_id = ?", (user_id,)).fetchone()
    conn.close()
    if not row:
        # 自动建一个 normal
        return ensure_referrer_status(user_id)
    return dict(row)


def update_referrer_stats(referrer_id: int, amount_yuan: float, is_new_paying_user: bool):
    """订单后更新 referrer 累计 + 月内统计, 检查升级."""
    now = time.time()
    conn = get_db()
    # 月度统计重置 (跨自然月)
    row = conn.execute("SELECT * FROM referrer_status WHERE user_id = ?", (referrer_id,)).fetchone()
    if not row:
        conn.close()
        ensure_referrer_status(referrer_id)
        return update_referrer_stats(referrer_id, amount_yuan, is_new_paying_user)
    reset_at = row['month_stats_reset_at'] or 0
    if now - reset_at > 30 * 86400:
        conn.execute("""
            UPDATE referrer_status SET month_paying_users = 0, month_revenue_brought = 0,
                month_stats_reset_at = ? WHERE user_id = ?
        """, (now, referrer_id))

    paying_delta = 1 if is_new_paying_user else 0
    conn.execute("""
        UPDATE referrer_status SET
            total_paying_users = total_paying_users + ?,
            total_revenue_brought = total_revenue_brought + ?,
            month_paying_users = month_paying_users + ?,
            month_revenue_brought = month_revenue_brought + ?,
            updated_at = ?
        WHERE user_id = ?
    """, (paying_delta, amount_yuan, paying_delta, amount_yuan, now, referrer_id))
    conn.commit()

    # 检查升级
    after = conn.execute("SELECT * FROM referrer_status WHERE user_id = ?", (referrer_id,)).fetchone()
    new_level = after['level']
    cert = COMMISSION_RULES['certified']
    partner = COMMISSION_RULES['partner']
    if after['level'] == 'normal':
        if (after['total_paying_users'] >= cert['trigger_paying_users'] or
            after['total_revenue_brought'] >= cert['trigger_revenue_yuan']):
            new_level = 'certified'
    if (after['month_paying_users'] >= partner['trigger_monthly_paying_users'] or
        after['month_revenue_brought'] >= partner['trigger_monthly_revenue_yuan']):
        new_level = 'partner'
    if new_level != after['level']:
        conn.execute(
            "UPDATE referrer_status SET level = ?, level_upgraded_at = ?, updated_at = ? WHERE user_id = ?",
            (new_level, now, now, referrer_id)
        )
        conn.commit()
        print(f"[billing] 推广员升级: user_id={referrer_id} {after['level']} → {new_level}", flush=True)
    conn.close()


# ============================== FastAPI Router ==============================


router = APIRouter(prefix="/api/billing")
referral_router = APIRouter(prefix="/api/referral")


class SubscribeRequest(BaseModel):
    tier: str                                       # pro_monthly / max_monthly / flagship_yearly
    payment_method: str = 'manual'                  # V1 走 manual (admin 后台开), V2 接微信/支付宝


class BuyCreditsRequest(BaseModel):
    pack_code: str                                  # pack_99 / pack_49 / pack_199 / pack_499
    payment_method: str = 'manual'


# JWT 配置 (跟 main.py 保持一致, 后续抽到 config 模块)
SECRET_KEY = "monoi-secret-key-2025"
ALGORITHM = "HS256"


def get_current_user_id(request: Request) -> int:
    """从 Authorization: Bearer <jwt> 解析 user_id."""
    auth = request.headers.get('authorization') or request.headers.get('Authorization') or ''
    if not auth.startswith('Bearer '):
        raise HTTPException(401, '未登录: 缺少 Authorization Bearer token')
    token = auth[7:]
    try:
        from jose import jwt
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return int(payload['sub'])
    except Exception as e:
        raise HTTPException(401, f'token 无效: {type(e).__name__}')


@router.get("/plans")
def list_plans():
    """返回所有套餐 + 积分包配置 (前端展示用)"""
    return {
        'plans': PLANS,
        'free': FREE_PLAN,
        'credit_packs': CREDIT_PACKS,
        'consume_rules': CONSUME_RULES,
    }


@router.get("/credits")
def my_credits(request: Request):
    user_id = get_current_user_id(request)
    # free 用户每次访问尝试当天 grant (注册起 7 天每天送 60). 失败吞异常不阻塞.
    try:
        try_daily_grant(user_id)
    except Exception as _e:
        print(f"[daily-grant] 失败但忽略 user={user_id}: {_e}")
    return get_balance(user_id)


@router.get("/subscription")
def my_subscription(request: Request):
    user_id = get_current_user_id(request)
    return get_user_subscription(user_id)


@router.get("/credit-log")
def my_credit_log(request: Request, limit: int = 50):
    user_id = get_current_user_id(request)
    conn = get_db()
    rows = conn.execute("""
        SELECT * FROM credit_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
    """, (user_id, limit)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@router.get("/my-orders")
def my_orders(request: Request, limit: int = 50):
    """当前用户的订单列表 (支付订单 + 手工开通订单, 全状态都返)."""
    user_id = get_current_user_id(request)
    conn = get_db()
    rows = conn.execute("""
        SELECT id, order_type, product_code, amount_yuan, credits_added,
               status, payment_method, payment_channel, paid_at, refunded_at,
               wx_transaction_id, created_at, expires_at
        FROM billing_orders WHERE user_id = ?
        ORDER BY created_at DESC LIMIT ?
    """, (user_id, limit)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


class ChargeRequest(BaseModel):
    feature: str                      # 'ai_writing' / 'footage_match' / 其他 Vercel 端功能
    amount: int                       # 扣多少积分
    ref_id: Optional[str] = None


# 仅允许这些 feature 走前端上报, 防恶意客户端绕过扣费
# footage_download: 用户下载 b-roll 视频包, 按数量扣 (2 积分/视频), 多选时 amount 可能超 50
# cover_download: 用户下载已生成的封面图 (2 积分/张, 按下载按钮一次扣一次)
# cutout_download: 用户下载抠图透明 PNG (2 积分/张)
_ALLOWED_CHARGE_FEATURES = {
    'ai_writing', 'footage_match', 'ai_writing_regen',
    'footage_download', 'cover_download', 'cutout_download',
}


@router.post("/charge")
def charge(req: ChargeRequest, request: Request):
    """前端上报扣费 (用于 Vercel edge function 调用 — DeepSeek 文案 / 素材匹配 AI 拆句).
    后端 main.py 直接调 consume_credits 的端点不走这条路. 限定 feature 白名单防滥用."""
    user_id = get_current_user_id(request)
    if req.feature not in _ALLOWED_CHARGE_FEATURES:
        raise HTTPException(400, f"不允许扣费的 feature: {req.feature}")
    if req.amount <= 0 or req.amount > 200:
        raise HTTPException(400, "amount 必须在 1-200 之间")
    consume_credits(user_id, req.feature, req.amount, ref_id=req.ref_id)
    bal = get_balance(user_id)
    return {'success': True, 'balance': bal}


@router.post("/subscribe")
def subscribe(req: SubscribeRequest, request: Request):
    """开通/续费套餐. V1 手工模式 (admin 后台触发); V2 接支付前会先创建 pending 订单 + 跳支付."""
    user_id = get_current_user_id(request)
    if req.tier not in PLANS:
        raise HTTPException(400, f"未知套餐: {req.tier}")
    if req.payment_method != 'manual':
        raise HTTPException(400, '支付通道还没接, V1 走 admin 手工开通')
    # V1: 直接当作支付成功创建订单 + 开通 (只允许 admin / 测试用)
    # 真上线时这条 endpoint 应该改成创建 pending order 返回支付二维码
    plan = PLANS[req.tier]
    order_id = f"ord_{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}"
    referrer_id = get_referrer_id(user_id)
    now = time.time()
    conn = get_db()
    conn.execute("""
        INSERT INTO billing_orders (id, user_id, order_type, product_code, amount_yuan,
                                      status, payment_method, paid_at, referrer_id, created_at)
        VALUES (?, ?, 'subscription', ?, ?, 'paid', ?, ?, ?, ?)
    """, (order_id, user_id, req.tier, plan['price_yuan'], 'manual', now, referrer_id, now))
    conn.commit()
    conn.close()
    activate_subscription(user_id, req.tier, payment_method='manual',
                           referrer_id=referrer_id, order_id=order_id)
    return {'success': True, 'order_id': order_id, 'tier': req.tier,
            'message': f'已开通 {plan["name"]}'}


@router.post("/buy-credits")
def buy_credits(req: BuyCreditsRequest, request: Request):
    user_id = get_current_user_id(request)
    if req.pack_code not in CREDIT_PACKS:
        raise HTTPException(400, f"未知积分包: {req.pack_code}")
    if req.payment_method != 'manual':
        raise HTTPException(400, '支付通道还没接, V1 走 admin 手工开通')
    pack = CREDIT_PACKS[req.pack_code]
    order_id = f"ord_{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}"
    referrer_id = get_referrer_id(user_id)
    now = time.time()
    conn = get_db()
    conn.execute("""
        INSERT INTO billing_orders (id, user_id, order_type, product_code, amount_yuan,
                                      credits_added, status, payment_method, paid_at,
                                      referrer_id, created_at)
        VALUES (?, ?, 'credit_pack', ?, ?, ?, 'paid', ?, ?, ?, ?)
    """, (order_id, user_id, req.pack_code, pack['price_yuan'], pack['credits'],
          'manual', now, referrer_id, now))
    conn.commit()
    conn.close()
    add_credits(user_id, pack['credits'], 'purchase', ref_id=order_id, feature=req.pack_code)
    # 触发推广佣金
    if referrer_id:
        write_first_order_commission(order_id, referrer_id, user_id, pack['price_yuan'], req.pack_code)
    return {'success': True, 'order_id': order_id, 'credits_added': pack['credits']}


# ============================== Referral router ==============================


@referral_router.get("/my-code")
def my_referral_code(request: Request):
    user_id = get_current_user_id(request)
    status = ensure_referrer_status(user_id)
    # 公网域名: 备案完了用 monoi.cn, 备案前用 Vercel 域名. 通过 env 切换.
    import os as _os
    base = (_os.environ.get('PUBLIC_BASE_URL') or 'https://monoi-cn.vercel.app').rstrip('/')
    return {
        'referral_code': status['referral_code'],
        'link': f"{base}/register?ref={status['referral_code']}",
    }


@referral_router.get("/status")
def my_referrer_status(request: Request):
    user_id = get_current_user_id(request)
    return get_referrer_status_dict(user_id)


@referral_router.post("/upgrade-check")
def upgrade_check(request: Request):
    """用户手动触发升级检查 (一般 update_referrer_stats 已经自动跑过, 这里是兜底).
    返新 status. 没达条件不变, 达了升级."""
    user_id = get_current_user_id(request)
    conn = get_db()
    now = time.time()
    after = conn.execute("SELECT * FROM referrer_status WHERE user_id = ?", (user_id,)).fetchone()
    if not after:
        conn.close()
        raise HTTPException(404, '推广员状态不存在')
    new_level = after['level']
    cert = COMMISSION_RULES['certified']
    partner = COMMISSION_RULES['partner']
    if after['level'] == 'normal':
        if (after['total_paying_users'] >= cert['trigger_paying_users'] or
            after['total_revenue_brought'] >= cert['trigger_revenue_yuan']):
            new_level = 'certified'
    if (after['month_paying_users'] >= partner['trigger_monthly_paying_users'] or
        after['month_revenue_brought'] >= partner['trigger_monthly_revenue_yuan']):
        new_level = 'partner'
    upgraded = (new_level != after['level'])
    if upgraded:
        conn.execute(
            "UPDATE referrer_status SET level = ?, level_upgraded_at = ?, updated_at = ? WHERE user_id = ?",
            (new_level, now, now, user_id),
        )
        conn.commit()
        print(f"[billing] 手动触发升级: user_id={user_id} {after['level']} → {new_level}", flush=True)
    conn.close()
    return {'upgraded': upgraded, 'from': after['level'], 'to': new_level, **get_referrer_status_dict(user_id)}


@referral_router.get("/commissions")
def my_commissions(request: Request, limit: int = 50):
    user_id = get_current_user_id(request)
    conn = get_db()
    rows = conn.execute("""
        SELECT * FROM commission_log WHERE beneficiary_user_id = ?
        ORDER BY created_at DESC LIMIT ?
    """, (user_id, limit)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@referral_router.get("/records")
def my_referral_records(request: Request, limit: int = 100):
    """推广明细: 我推广出去的用户列表 + 每笔佣金详情 (注册/首单/续费)."""
    user_id = get_current_user_id(request)
    conn = get_db()

    # 1. 我推广出去的所有用户
    referred = conn.execute("""
        SELECT rb.user_id, rb.bound_at, u.username, u.phone
        FROM referral_binding rb
        JOIN users u ON u.id = rb.user_id
        WHERE rb.referrer_id = ?
        ORDER BY rb.bound_at DESC
        LIMIT ?
    """, (user_id, limit)).fetchall()

    # 2. 这些用户是否付费过 (统计每人累计金额)
    user_ids = [r['user_id'] for r in referred]
    user_paid: dict = {}
    if user_ids:
        placeholders = ','.join('?' * len(user_ids))
        order_rows = conn.execute(f"""
            SELECT user_id, SUM(amount_yuan) as total_amount, COUNT(*) as order_count
            FROM billing_orders
            WHERE user_id IN ({placeholders}) AND status = 'paid'
            GROUP BY user_id
        """, user_ids).fetchall()
        for r in order_rows:
            user_paid[r['user_id']] = {
                'total_amount': r['total_amount'] or 0,
                'order_count': r['order_count'] or 0,
            }

    # 3. 我的佣金流水 (含买家信息)
    commissions = conn.execute("""
        SELECT cl.id, cl.order_id, cl.commission_type, cl.renewal_month_index,
               cl.credits, cl.cash_yuan, cl.status, cl.created_at,
               bo.product_code, bo.amount_yuan as order_amount, bo.user_id as buyer_id,
               u.username as buyer_username, u.phone as buyer_phone
        FROM commission_log cl
        LEFT JOIN billing_orders bo ON bo.id = cl.order_id
        LEFT JOIN users u ON u.id = bo.user_id
        WHERE cl.beneficiary_user_id = ?
        ORDER BY cl.created_at DESC LIMIT ?
    """, (user_id, limit)).fetchall()

    conn.close()

    def mask(p):
        return (p[:3] + '****' + p[-4:]) if p and len(p) == 11 else (p or '-')

    return {
        'referred_users': [{
            'user_id': r['user_id'],
            'bound_at': r['bound_at'],
            'username': r['username'],
            'phone_masked': mask(r['phone']),
            'total_paid_amount': user_paid.get(r['user_id'], {}).get('total_amount', 0),
            'order_count': user_paid.get(r['user_id'], {}).get('order_count', 0),
        } for r in referred],
        'commissions': [{
            'id': c['id'],
            'order_id': c['order_id'],
            'commission_type': c['commission_type'],
            'renewal_month_index': c['renewal_month_index'],
            'credits': c['credits'],
            'cash_yuan': c['cash_yuan'],
            'status': c['status'],
            'created_at': c['created_at'],
            'product_code': c['product_code'],
            'order_amount': c['order_amount'],
            'buyer_username': c['buyer_username'],
            'buyer_phone_masked': mask(c['buyer_phone']),
        } for c in commissions],
    }


@referral_router.get("/balance")
def my_referrer_balance(request: Request):
    user_id = get_current_user_id(request)
    conn = get_db()
    row = conn.execute("SELECT * FROM referrer_balance WHERE user_id = ?", (user_id,)).fetchone()
    conn.close()
    if not row:
        return {'cash_balance': 0, 'cash_withdrawn_total': 0}
    return dict(row)


class WithdrawRequest(BaseModel):
    amount_yuan: float
    payment_method: str         # 'alipay' / 'wechat'
    account_info: str           # 真实姓名 + 账号


@referral_router.post("/withdraw")
def submit_withdraw(req: WithdrawRequest, request: Request):
    user_id = get_current_user_id(request)
    status = get_referrer_status_dict(user_id)
    if status['level'] == 'normal':
        raise HTTPException(403, '普通用户不能提现现金, 升级为认证推广员 (累计带 5 付费用户 或 ¥500 流水) 才行')
    min_amount = COMMISSION_RULES[status['level']]['min_withdraw_yuan']
    if req.amount_yuan < min_amount:
        raise HTTPException(400, f'最低提现金额 ¥{min_amount}')

    conn = get_db()
    bal = conn.execute("SELECT cash_balance FROM referrer_balance WHERE user_id = ?", (user_id,)).fetchone()
    if not bal or bal['cash_balance'] < req.amount_yuan:
        conn.close()
        raise HTTPException(400, '余额不足')
    now = time.time()
    cursor = conn.execute("""
        INSERT INTO withdrawal_request (user_id, amount_yuan, payment_method, account_info, created_at)
        VALUES (?, ?, ?, ?, ?)
    """, (user_id, req.amount_yuan, req.payment_method, req.account_info, now))
    wid = cursor.lastrowid
    # 余额暂扣 (审核后不通过会回滚)
    conn.execute("""
        UPDATE referrer_balance SET cash_balance = cash_balance - ?, updated_at = ? WHERE user_id = ?
    """, (req.amount_yuan, now, user_id))
    conn.commit()
    conn.close()
    return {'success': True, 'withdrawal_id': wid, 'message': '提现申请已提交, 审核通过后转账到账'}
