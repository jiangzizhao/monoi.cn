"""微信支付 Native (PC 扫码) V3 封装.

依赖: pip install wechatpayv3  (可选, 没装时 is_configured() 返 False, 走 mock)

env 6 个齐了走真支付:
- WX_APP_ID            微信开放平台"网站应用"AppID
- WX_MCH_ID            微信支付商户号
- WX_API_V3_KEY        商户后台 → API 安全 设置的 32 位 v3 密钥
- WX_CERT_SERIAL_NO    商户证书序列号 (商户后台 → API 安全 → 证书管理)
- WX_PRIVATE_KEY_PATH  apiclient_key.pem 商户私钥文件路径 (绝对路径)
- WX_NOTIFY_URL        支付成功回调 URL (默认 https://monoi.cn/api/pay/wx/notify)

工作流 (Native PC 扫码):
1. 用户点支付 → 后端 create_native_order → 调微信 → 返 code_url (weixin://wxpay/bizpayurl?pr=xxx)
2. 前端用 code_url 渲染二维码
3. 用户手机微信扫码 → 付款
4. 微信主动 POST notify_url → 后端 verify_notify → 改订单状态 → activate_subscription
5. 前端轮询 query_order → paid 后刷新会员

Mock 模式 (没配 env): create 在内存记账, query 15 秒后返 paid, notify 不接收 (query 兜底).
"""
import os
import time
from typing import Optional

_REQUIRED = (
    'WX_APP_ID', 'WX_MCH_ID', 'WX_API_V3_KEY',
    'WX_CERT_SERIAL_NO', 'WX_PRIVATE_KEY_PATH',
)
_DEFAULT_NOTIFY_URL = 'https://monoi.cn/api/pay/wx/notify'
_MOCK_PAID_AFTER = 15.0  # 秒

_client = None
_mock_orders: dict = {}   # out_trade_no -> {created_at, amount, status, paid_at}


def is_configured() -> bool:
    return all(os.getenv(k) for k in _REQUIRED)


def missing_env_vars() -> list:
    """列出当前没设的必填 env (诊断用), 启动 log 里会打印, 帮快速定位."""
    return [k for k in _REQUIRED if not os.getenv(k)]


def _get_client():
    global _client
    if _client is not None:
        return _client
    from wechatpayv3 import WeChatPay, WeChatPayType  # type: ignore

    pkey_path = os.getenv('WX_PRIVATE_KEY_PATH')
    with open(pkey_path, 'r', encoding='utf-8') as f:
        private_key = f.read()

    _client = WeChatPay(
        wechatpay_type=WeChatPayType.NATIVE,
        mchid=os.getenv('WX_MCH_ID'),
        private_key=private_key,
        cert_serial_no=os.getenv('WX_CERT_SERIAL_NO'),
        apiv3_key=os.getenv('WX_API_V3_KEY'),
        appid=os.getenv('WX_APP_ID'),
        notify_url=os.getenv('WX_NOTIFY_URL', _DEFAULT_NOTIFY_URL),
    )
    return _client


def create_native_order(out_trade_no: str, amount_cents: int, description: str) -> dict:
    """返 {code_url, prepay_id}. 失败 raise. amount_cents 是分 (¥99 = 9900)."""
    if not is_configured():
        _mock_orders[out_trade_no] = {
            'created_at': time.time(),
            'amount': amount_cents,
            'status': 'pending',
            'description': description,
        }
        print(f"[wxpay-mock] 下单 {out_trade_no} 金额={amount_cents/100:.2f} 元 (15s 后 mock paid)", flush=True)
        return {
            'code_url': f'MOCK_QR:{out_trade_no}',
            'prepay_id': f'mock_prepay_{out_trade_no}',
        }
    import json
    from wechatpayv3 import WeChatPayType  # type: ignore
    client = _get_client()
    code, message = client.pay(
        description=description,
        out_trade_no=out_trade_no,
        amount={'total': amount_cents},
        pay_type=WeChatPayType.NATIVE,
    )
    if code != 200:
        raise RuntimeError(f'微信 Native 下单失败 ({code}): {message}')
    resp = json.loads(message)
    print(f"[wxpay-real] 下单 {out_trade_no} 成功, code_url={resp.get('code_url', '')[:50]}...", flush=True)
    return {
        'code_url': resp.get('code_url'),
        'prepay_id': resp.get('prepay_id'),
    }


def query_order(out_trade_no: str) -> dict:
    """返 {status, transaction_id, paid_at}.
    status: 'pending' | 'paid' | 'expired'"""
    if not is_configured():
        order = _mock_orders.get(out_trade_no)
        if not order:
            return {'status': 'expired'}
        if order['status'] == 'paid':
            return {'status': 'paid',
                    'transaction_id': f'mock_txn_{out_trade_no}',
                    'paid_at': order.get('paid_at', time.time())}
        if time.time() - order['created_at'] > _MOCK_PAID_AFTER:
            order['status'] = 'paid'
            order['paid_at'] = time.time()
            print(f"[wxpay-mock] 订单 {out_trade_no} mock 自动支付成功", flush=True)
            return {'status': 'paid',
                    'transaction_id': f'mock_txn_{out_trade_no}',
                    'paid_at': order['paid_at']}
        return {'status': 'pending'}
    import json
    client = _get_client()
    code, message = client.query(out_trade_no=out_trade_no)
    if code != 200:
        if 'ORDERNOTEXIST' in (message or '') or 'NOT_FOUND' in (message or ''):
            return {'status': 'expired'}
        raise RuntimeError(f'微信查单失败 ({code}): {message}')
    resp = json.loads(message)
    trade_state = resp.get('trade_state', '')
    status_map = {
        'SUCCESS': 'paid',
        'NOTPAY': 'pending',
        'USERPAYING': 'pending',
        'CLOSED': 'expired',
        'REVOKED': 'expired',
        'REFUND': 'expired',
        'PAYERROR': 'expired',
    }
    return {
        'status': status_map.get(trade_state, 'pending'),
        'transaction_id': resp.get('transaction_id'),
        'paid_at': time.time() if trade_state == 'SUCCESS' else None,
    }


def verify_notify(headers: dict, body: bytes) -> Optional[dict]:
    """验签 + 解密 notify. 返 {out_trade_no, transaction_id, amount} 或 None (验签失败/非成功事件)."""
    if not is_configured():
        return None
    client = _get_client()
    result = client.callback(headers=headers, body=body)
    if not result or result.get('event_type') != 'TRANSACTION.SUCCESS':
        return None
    resource = result.get('resource', {})
    return {
        'out_trade_no': resource.get('out_trade_no'),
        'transaction_id': resource.get('transaction_id'),
        'amount': resource.get('amount', {}).get('total'),
        'success_time': resource.get('success_time'),
    }
