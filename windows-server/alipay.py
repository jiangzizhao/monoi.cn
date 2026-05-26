"""支付宝当面付 (扫码支付) 封装 — 用 python-alipay-sdk-no-crypto 走 RSA2.

依赖: pip install python-alipay-sdk-no-crypto  (无 C 扩展, Windows 也能直接装)
不能用 alipay-sdk-python (官方那个名字, 但 Python 支持差, 维护少)

env 4 个齐了走真支付, 不齐 → is_configured() 返 False → main.py 那边返 501:
- ALIPAY_APP_ID            开放平台应用 AppID (2021/2024... 16 位数字)
- ALIPAY_APP_PRIVATE_KEY   应用私钥 (RSA2 2048, 自己生成 / 工具生成的私钥, 一整段 PEM)
- ALIPAY_PUBLIC_KEY        支付宝公钥 (开放平台 → 你的应用 → 密钥管理 → 支付宝公钥, 一整段 PEM)
- ALIPAY_NOTIFY_URL        默认 https://monoi.cn/api/pay/alipay/notify
  (可选) ALIPAY_RETURN_URL  默认 https://monoi.cn/account#membership — 当面付不强制用

工作流 (当面付 / alipay.trade.precreate, 扫码):
1. 用户点支付 → 后端 create_pc_order → 调支付宝 precreate → 返 qr_code (alipays://... 或 https://qr.alipay.com/...)
2. 前端拿 qr_code 直接渲染二维码 (跟微信 Native 一样的 UI 路径)
3. 用户手机支付宝扫码 → 付款
4. 支付宝 POST notify_url → 后端 verify_notify → 改订单状态 → activate_subscription
5. 前端轮询 query_order → paid 后刷新会员

为什么用"当面付 (precreate)"不用"电脑网站支付 (page.pay)":
- 当面付直接返 qr_code 字符串, 跟微信 Native 同构, UI 不用分叉
- 电脑网站支付返一个完整跳转 URL, 必须新开 tab 跳支付宝, 体验不一样
- 商户开"网页/移动应用支付"产品的同时, 当面付能力通常一起开

Mock 模式: 跟 wxpay 一致, env 不齐时不调真接口, 15s 后内存模拟 paid (开发环境用).
"""
import os
import time
from typing import Optional

_REQUIRED = ('ALIPAY_APP_ID', 'ALIPAY_APP_PRIVATE_KEY', 'ALIPAY_PUBLIC_KEY')
_DEFAULT_NOTIFY_URL = 'https://monoi.cn/api/pay/alipay/notify'
_MOCK_PAID_AFTER = 15.0

_client = None
_mock_orders: dict = {}   # out_trade_no -> {created_at, amount, status, paid_at, trade_no}


def is_configured() -> bool:
    return all(os.getenv(k) for k in _REQUIRED)


def missing_env_vars() -> list:
    """诊断: 启动 log 打印缺哪个 env, 帮快速定位."""
    return [k for k in _REQUIRED if not os.getenv(k)]


def _normalize_pem(s: str) -> str:
    """env 里写 PEM 经常一行平铺 / 用 \\n 转义 / 缺 BEGIN/END 头尾.
    SDK 要求标准 PEM 多行格式, 这里兼容几种常见错法:
    1. 一整段单行 → 加 64 字符分组 + BEGIN/END
    2. \\n 字面 → 换真 \n
    3. 已经是多行 → 直接返
    """
    s = (s or '').strip()
    if not s:
        return s
    # \\n 字面 → \n
    if '\\n' in s and '\n' not in s:
        s = s.replace('\\n', '\n')
    # 已有 BEGIN 头, 信任格式
    if '-----BEGIN' in s:
        return s
    # 裸 base64, 自动包头尾 — 默认按"应用私钥 PKCS#1"包. 支付宝公钥也走这个分支
    # 注意: 用户应该原样粘贴带头尾的, 这是兜底
    s = s.replace('\n', '').replace(' ', '').replace('\r', '')
    chunks = '\n'.join(s[i:i + 64] for i in range(0, len(s), 64))
    return f"-----BEGIN PRIVATE KEY-----\n{chunks}\n-----END PRIVATE KEY-----"


def _get_client():
    global _client
    if _client is not None:
        return _client
    from alipay import AliPay  # python-alipay-sdk-no-crypto

    app_private_key = _normalize_pem(os.getenv('ALIPAY_APP_PRIVATE_KEY', ''))
    alipay_public_key = _normalize_pem(os.getenv('ALIPAY_PUBLIC_KEY', ''))

    _client = AliPay(
        appid=os.getenv('ALIPAY_APP_ID'),
        app_notify_url=os.getenv('ALIPAY_NOTIFY_URL', _DEFAULT_NOTIFY_URL),
        app_private_key_string=app_private_key,
        alipay_public_key_string=alipay_public_key,
        sign_type='RSA2',
        debug=False,   # 正式环境固定 False — 沙箱测试要切, 但我们直接走真支付
    )
    return _client


def create_pc_order(out_trade_no: str, amount_cents: int, description: str) -> dict:
    """当面付下单. 返 {qr_code, pay_url}.

    qr_code: 支付宝返的二维码内容字符串 (如 https://qr.alipay.com/bavh4wjlxf12tper3a),
      前端直接用 QRCode 库生成二维码图.
    pay_url: 当面付没有"跳转支付 URL"概念, 跟 qr_code 一样 (前端可能 fallback 用).
    """
    amount_yuan = f'{amount_cents / 100:.2f}'   # 支付宝接口 total_amount 要"元", 字符串两位小数

    if not is_configured():
        _mock_orders[out_trade_no] = {
            'created_at': time.time(),
            'amount': amount_cents,
            'status': 'pending',
            'description': description,
        }
        print(f"[alipay-mock] 下单 {out_trade_no} ¥{amount_yuan} (15s 后 mock paid)", flush=True)
        return {
            'qr_code': f'MOCK_ALIPAY_QR:{out_trade_no}',
            'pay_url': f'MOCK_ALIPAY_QR:{out_trade_no}',
        }

    client = _get_client()
    result = client.api_alipay_trade_precreate(
        out_trade_no=out_trade_no,
        total_amount=amount_yuan,
        subject=description,
    )
    code = result.get('code', '')
    if code != '10000':
        # 支付宝错误码: 40004 业务参数 / 40006 权限不足 (应用没绑当面付能力) / 20000 系统错
        raise RuntimeError(f"支付宝下单失败 code={code} msg={result.get('msg')} sub={result.get('sub_msg')}")
    qr_code = result.get('qr_code', '')
    print(f"[alipay-real] 下单 {out_trade_no} 成功, qr_code={qr_code[:60]}...", flush=True)
    return {'qr_code': qr_code, 'pay_url': qr_code}


def query_order(out_trade_no: str) -> dict:
    """查单. 返 {status, trade_no, paid_at}.
    status: 'pending' | 'paid' | 'expired'
    trade_no: 支付宝交易号 (支付成功后才有)
    """
    if not is_configured():
        order = _mock_orders.get(out_trade_no)
        if not order:
            return {'status': 'expired'}
        if order['status'] == 'paid':
            return {'status': 'paid',
                    'trade_no': f'mock_alipay_{out_trade_no}',
                    'paid_at': order.get('paid_at', time.time())}
        if time.time() - order['created_at'] > _MOCK_PAID_AFTER:
            order['status'] = 'paid'
            order['paid_at'] = time.time()
            print(f"[alipay-mock] 订单 {out_trade_no} mock 自动支付成功", flush=True)
            return {'status': 'paid',
                    'trade_no': f'mock_alipay_{out_trade_no}',
                    'paid_at': order['paid_at']}
        return {'status': 'pending'}

    client = _get_client()
    result = client.api_alipay_trade_query(out_trade_no=out_trade_no)
    code = result.get('code', '')
    if code != '10000':
        # ACQ.TRADE_NOT_EXIST = 还没扫码 / 订单不存在 (precreate 之后, 用户没付钱前是这状态)
        sub = result.get('sub_code', '')
        if sub in ('ACQ.TRADE_NOT_EXIST',):
            return {'status': 'pending'}
        # 其它错误当查询失败, 别误判为过期
        raise RuntimeError(f"支付宝查单失败 code={code} sub={sub} msg={result.get('sub_msg')}")
    trade_status = result.get('trade_status', '')
    status_map = {
        'TRADE_SUCCESS': 'paid',
        'TRADE_FINISHED': 'paid',
        'WAIT_BUYER_PAY': 'pending',
        'TRADE_CLOSED': 'expired',
    }
    return {
        'status': status_map.get(trade_status, 'pending'),
        'trade_no': result.get('trade_no'),
        'paid_at': time.time() if trade_status in ('TRADE_SUCCESS', 'TRADE_FINISHED') else None,
    }


def verify_notify(form_data: dict) -> Optional[dict]:
    """验签 + 解析 notify. 返 {out_trade_no, trade_no, amount, success_time} 或 None.

    支付宝 notify 是 application/x-www-form-urlencoded POST.
    form_data 是已经解析过的字典 (含 sign 字段).
    支付宝主动通知不止"支付成功"一种事件 (还有退款、关闭等),
    这里只认 trade_status in (TRADE_SUCCESS, TRADE_FINISHED).
    """
    if not is_configured():
        return None
    if not form_data:
        return None

    client = _get_client()
    # 验签前要把 sign 跟 sign_type 拿出来再传
    sign = form_data.get('sign')
    if not sign:
        return None
    # SDK 的 verify 接受 data dict (不含 sign) + sign 字符串
    data_to_verify = {k: v for k, v in form_data.items() if k not in ('sign', 'sign_type')}
    try:
        ok = client.verify(data_to_verify, sign)
    except Exception as e:
        print(f"[alipay] notify 验签异常: {e}", flush=True)
        return None
    if not ok:
        print("[alipay] notify 验签失败", flush=True)
        return None

    trade_status = form_data.get('trade_status', '')
    if trade_status not in ('TRADE_SUCCESS', 'TRADE_FINISHED'):
        print(f"[alipay] notify 非成功事件 trade_status={trade_status}", flush=True)
        return None
    return {
        'out_trade_no': form_data.get('out_trade_no'),
        'trade_no': form_data.get('trade_no'),
        'amount': form_data.get('total_amount'),   # 元字符串
        'success_time': form_data.get('gmt_payment'),
    }
