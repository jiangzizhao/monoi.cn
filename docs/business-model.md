# monoi 商业化设计 v1

> 决策时间: 2026-05-13
> 当前阶段: 设计定稿, 待进入数据库 schema 实现

## 1. 套餐结构

| 套餐 | 价格 | 月送积分 | 核心权益 |
|---|---|---|---|
| 免费 | 0 | 50 (一次性体验) | 体验所有功能, 视频带 monoi 水印, 数字人 3 条/月上限 |
| **Pro** | ¥99/月 | 1500 | 无水印, 数字人 30 条/月, 1 克隆音色 slot, 加买积分 ¥1=15 |
| **Max** | ¥199/月 | 4000 | 数字人 100 条/月, 3 克隆 slot, 优先 GPU, 多平台多账号, 商用授权, 加买积分 ¥1=20 |
| **旗舰年卡** | ¥2980/年 | 60000/年 (5000/月均匀) | 数字人 300 条/月, 5 克隆 slot, 团队多席位, 全部权益, 加买积分 ¥1=25 |

**所有用户基础功能不扣积分**: 文案 / 素材匹配 / 封面 / 自动发布

## 2. 积分扣减规则

积分价值锚定: **¥1 = 10 积分** (标准价)

| 功能 | 积分 | 30 秒典型场景 |
|---|---|---|
| 配音 (预设音色) | 0.5/秒 | 15 积分 |
| 配音 (克隆音色) | 1.5/秒 | 45 积分 |
| 口播剪辑 | 5/次 | 5 |
| 一键合成 (无数字人) | 10/次 | 10 |
| 数字人合成 | 2/秒 | 60 |

典型 30 秒数字人视频: 60 (DH) + 45 (克隆配音) + 10 (合成) = **115 积分/条**

- Pro 1500 分够 ~13 条/月
- Max 4000 分够 ~35 条/月
- 旗舰 5000 分/月均够 ~43 条

## 3. 单独积分包

| 包 | 价格 | 积分 | 单价 |
|---|---|---|---|
| 体验 | ¥9.9 | 100 | ¥1=10 |
| 小 | ¥49 | 600 | ¥1=12 (送 20%) |
| 中 | ¥199 | 3000 | ¥1=15 |
| 大 | ¥499 | 8000 | ¥1=16 (送 60%) |

中包 ¥199 = 3000 积分, 比 Max 月卡 4000 积分少, 引导用户买月卡.

会员加买等级折扣: Pro ¥1=15, Max ¥1=20, 旗舰 ¥1=25.

## 4. 推广体系 (三级)

### 级别 1: 普通用户 (人人都是, 积分奖励)

| 行为 | 推荐人得 | 被推荐人得 |
|---|---|---|
| 推荐注册 (未付) | 30 积分 | 30 积分 |
| 推荐买月卡 | 首单 30% 等值积分 | 额外 10% 积分 |
| 推荐买积分包 | 首单 30% 等值积分 | 额外 10% 积分 |
| 推荐买旗舰年卡 | 上限 **3000 积分** (防刷) | 额外 500 积分 |

**续费不给普通用户积分** (避免长期被动收入引诱刷单).

### 级别 2: 认证推广员

**触发**: 累计 ≥5 付费用户 或 累计推广流水 ≥¥500

**佣金 (现金)**:
- 月卡首单 30%
- 月卡续费 10% × **3 个月** (第 4 月起 100% 归平台)
- 旗舰年卡首单 30% (一次性, 不算续费)
- 积分包首单 10%
- 现金 ≥¥100 申请提现

### 级别 3: 核心合伙人

**触发**: 月推 ≥20 付费用户 或 月推广流水 ≥¥3000

**佣金 (现金)**:
- 月卡首单 50%
- 月卡续费 15% × **3 个月**
- 旗舰年卡首单 50% (一次性)
- 积分包首单 15%
- 现金 ≥¥100 申请提现

**风控**: 推荐用户 3 月内退费率 > 30% 则不结算 (防刷单).

## 5. 退款 + 支付

- **退款政策**: 不退款 (一旦付费, 不可退). 让用户认真决策, 降低薅羊毛风险.
- **支付通道**: 微信支付 + 支付宝双通道
- **结算货币**: 人民币

## 6. 数据库 Schema

```sql
-- 用户订阅
user_subscription (
  user_id PK,
  tier ENUM('free','pro','max','flagship'),
  current_period_start, current_period_end,
  auto_renew BOOL,
  created_at, updated_at
)

-- 积分余额 (两个 bucket)
credit_balance (
  user_id PK,
  monthly_credits INT,           -- 会员月送, 月结清零
  monthly_credits_reset_at,
  purchased_credits INT          -- 单独买的, 永不过期
)

-- 积分流水
credit_log (
  id, user_id, feature, delta INT,
  source ENUM('subscription_grant','purchase','referral','consume','refund'),
  ref_id, created_at
)

-- 订单
orders (
  id, user_id,
  type ENUM('subscription','credit_pack'),
  product_code,                  -- pro_monthly / max_monthly / flagship_yearly / pack_199 ...
  amount_yuan, credits_added,
  status ENUM('pending','paid','refunded'),
  paid_at, refunded_at,
  payment_method, referrer_id,
  created_at
)

-- 推广绑定 (首次注册时记, 终身不变)
referral_binding (
  user_id PK, referrer_id, referral_code_used, bound_at
)

-- 推广员状态
referrer_status (
  user_id PK,
  level ENUM('normal','certified','partner'),
  total_paying_users, total_revenue_brought,
  alipay_account, wechat_account,
  level_upgraded_at, updated_at
)

-- 佣金流水
commission_log (
  id, order_id, beneficiary_user_id,
  beneficiary_level ENUM('normal','certified','partner'),
  type ENUM('register_bonus','first_order','renewal'),
  renewal_month_index INT,       -- 1/2/3 (续费只算前 3 个月)
  credits INT, cash_yuan DECIMAL,
  status ENUM('pending','settled','cancelled_refund'),
  settled_at, created_at
)

-- 推广员余额
referrer_balance (
  user_id PK,
  cash_balance, cash_withdrawn_total
)

-- 提现申请
withdrawal_request (
  id, user_id, amount_yuan,
  payment_method ENUM('alipay','wechat'),
  account_info,                  -- 真实姓名 + 账号
  status ENUM('pending','approved','rejected','paid'),
  admin_note, created_at, processed_at
)
```

## 7. API 端点

```
# 套餐 + 支付
GET    /api/billing/plans
POST   /api/billing/subscribe
POST   /api/billing/cancel-renewal
POST   /api/billing/buy-credits

# 积分
GET    /api/billing/credits
GET    /api/billing/credit-log

# 推广
GET    /api/referral/my-code
GET    /api/referral/status
GET    /api/referral/commissions
GET    /api/referral/balance
POST   /api/referral/withdraw

# 内部
POST   /internal/payment-webhook         # 微信/支付宝回调
POST   /internal/monthly-credit-reset    # cron 月 1 号
POST   /internal/check-renewal-commission # cron 每月跑续费分成
```

## 8. 业务流转

```
注册 → (有推广码) → 绑定 referrer_id → 双方 30 积分

下单 → 支付 → webhook 回调
  ↓
1. orders.status = 'paid'
2. credits 入账
3. 查 referrer_id + level → 计算佣金 → commission_log
4. 普通用户 credit_balance 涨 / 推广员+ referrer_balance 涨
5. 检查推广员升级条件 (累计 5 人 / 20 人 / 流水)

续费扣款 → webhook → 同流程, type='renewal'
  - 普通用户不给积分
  - 推广员+ 只前 3 月 (renewal_month_index ≤ 3)

提现申请 → 管理员审核 → 手动转账 → 标记 paid (前期手工)
```

## 9. 后续规划 (V2+)

- 自动打款 (微信商户付款 API, 需营业执照)
- 团队席位管理 UI (旗舰用户邀请子账号)
- 积分订阅 (每月固定加买额, 比单次买便宜)
- 排行榜 / 推广员激励比赛
- 数字人 IP 商店 (用户上传形象, 卖给别人用, 分成)

## 10. 决策日志

- 不做 7 天无理由退款 (2026-05-13)
- 续费分成只算 3 个月 (2026-05-13)
- ¥2980 是年付不是终身买断 (2026-05-13)
- 推广积分给普通用户, 现金给推广员+ (2026-05-13)
- 免费用户 3 条/月 + 水印 (2026-05-13, 暂定可调)
