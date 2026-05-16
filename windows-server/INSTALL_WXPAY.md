# 微信支付集成 (Native PC 扫码 V3)

> 当前默认是 **mock 模式**: 用户点支付看到一个假二维码, 15 秒后后端自动 mark paid + 开通对应会员. 上线给真用户用时按本文档接微信商户.

## 准备工作 (用户那边)

1. **微信开放平台 "网站应用" 通过审核** — 拿到 **AppID**
2. **微信支付商户号申请通过** — 拿到 **mch_id**, 商户后台已绑刚才那个 AppID
3. **monoi.cn ICP 备案** — 微信支付强校验支付授权目录的域名必须备案
4. 商户后台 → API 安全:
   - 设置 **API v3 密钥** (自己输入 32 位字符, 记下)
   - 申请 **API 证书** — 浏览器扫码下载, 拿到 `apiclient_cert.pem` 跟 `apiclient_key.pem`
   - 拿 **证书序列号** (商户后台 → API 安全 → 证书管理那条上方有序列号)
5. 商户后台 → 产品中心 → **Native 支付** → 开通
6. 商户后台 → 开发配置:
   - **支付授权目录**: 加 `https://monoi.cn/`
   - **支付回调 URL**: `https://monoi.cn/api/pay/wx/notify`

## 1. 装 SDK

在 `D:\monoi-server` 跑:

```bat
pip install wechatpayv3
```

依赖小 (~2 MB).

## 2. 把商户证书放到服务器

把 `apiclient_key.pem` (商户私钥) 复制到 `D:\monoi-server\cert\apiclient_key.pem`. **绝对不要 commit 到 git**.

```bat
mkdir D:\monoi-server\cert
:: 把下载的 apiclient_key.pem 拖到 D:\monoi-server\cert\ 下
```

## 3. 配 .env (放在 D:\monoi-server\.env)

6 个变量都要填:

```env
WX_APP_ID=wx12345678            # 微信开放平台网站应用 AppID
WX_MCH_ID=1612345678            # 商户号
WX_API_V3_KEY=你设置的32位字符    # 商户后台 API 安全 → 设置 API v3 密钥
WX_CERT_SERIAL_NO=你的证书序列号  # 商户后台 API 安全 → 证书管理那条上方的序列号
WX_PRIVATE_KEY_PATH=D:\monoi-server\cert\apiclient_key.pem
WX_NOTIFY_URL=https://monoi.cn/api/pay/wx/notify
```

## 4. 拉新版代码 + 重启

```bat
cd /d D:\monoi-server
curl -L -O https://raw.githubusercontent.com/jiangzizhao/monoi.cn/main/windows-server/wxpay.py
curl -L -O https://raw.githubusercontent.com/jiangzizhao/monoi.cn/main/windows-server/alipay.py
curl -L -O https://raw.githubusercontent.com/jiangzizhao/monoi.cn/main/windows-server/main.py
curl -L -O https://raw.githubusercontent.com/jiangzizhao/monoi.cn/main/windows-server/billing.py
:: 重启 main.py
```

启动应该看到这一行:

```
[wxpay] mode = REAL (微信商户)
```

如果看到 `MOCK (15s 后自动支付)` 说明 env 没填齐, 检查 .env 6 个变量.

## 5. 验证

1. 注册账号登录 monoi.cn
2. 账户中心 → 会员中心 → 选 Pro → 点 "开通 Pro"
3. 弹出支付弹窗, 选 "微信支付", 同意协议, 点 "确认支付"
4. 二维码出现 → 用手机微信扫码 → 付款 (¥99)
5. 主 cmd 控制台应该打印:
   ```
   [wxpay-real] 下单 ord_xxx 成功, code_url=weixin://wxpay/bizpayurl?pr=...
   [pay] 订单 ord_xxx 标记 paid, 触发 activate_subscription(user=1, tier=pro_monthly)
   ```
6. 弹窗自动显示 "已开通 Pro 会员", 3 秒后关闭
7. 账户中心刷新会显示 "当前套餐: Pro · 到期 2026-06-XX"

## 6. 排错

### "微信 Native 下单失败"
- 检查 mch_id / app_id 是否绑定
- 商户后台 → 产品中心 → Native 支付是否开通
- 支付授权目录是否加了 `https://monoi.cn/`

### "FAIL 验签失败" (notify 回来报这个)
- WX_API_V3_KEY 写错 (跟商户后台设置的不一致)
- WX_CERT_SERIAL_NO 写错 (跟商户证书不匹配)

### 二维码扫了显示 "商户号未授权"
- 商户号申请下来但**没绑定 AppID**, 去商户后台 → 账户中心 → AppID 账号管理 关联一下

### 用户扫码付完, 但前端弹窗一直转 "等待支付..."
- 微信 notify 可能没打到我们服务器 (检查 NATAPP 转发是否正常)
- 但前端轮询会主动查微信 (q.status), 通常 2-5 秒内能拿到 paid
- 如果还是不行, 看 cmd 控制台有没有 `[pay] query wxpay ... 失败` log

### 已付款但订阅没开通
- `_mark_order_paid_and_activate` 是幂等的, 重复调用不影响
- 直接管理员后台手工开通 (admin 页面 / billing.activate_subscription)

## 7. 成本

- 微信支付费率: 0.6% 手续费 (T+1 结算到对公账户)
- ¥99 Pro 月卡 → 商户实收 ¥98.41 (微信扣 ¥0.59)
- 我们不收用户额外费用

## 8. 退款 (V2)

V1 不做退款入口, 用户要退款找客服微信. 后续 V2 加 `wxpay.refund()` API.

## 9. 自动续费 (V2)

V1 单次支付, 用户到期前 3 天会收短信 "续费提醒".
V2 申请微信代扣权限通过后, 加 `wxpay.contract()` API + 自动扣款 cron.
