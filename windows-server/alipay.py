"""支付宝电脑网站支付 (PC) 封装 — V1 stub, 等支付宝商户审批通过再实现.

依赖 (后续): pip install alipay-sdk-python

env (后续齐了再启用):
- ALIPAY_APP_ID
- ALIPAY_APP_PRIVATE_KEY  应用私钥 (RSA2 2048, 自己生成)
- ALIPAY_PUBLIC_KEY       支付宝公钥 (开放平台拿)
- ALIPAY_NOTIFY_URL       默认 https://monoi.cn/api/pay/alipay/notify
- ALIPAY_RETURN_URL       默认 https://monoi.cn/account#membership
"""
import os
from typing import Optional

_REQUIRED = ('ALIPAY_APP_ID', 'ALIPAY_APP_PRIVATE_KEY', 'ALIPAY_PUBLIC_KEY')


def is_configured() -> bool:
    return all(os.getenv(k) for k in _REQUIRED)


def create_pc_order(out_trade_no: str, amount_cents: int, description: str) -> dict:
    """V1: stub, 等商户审批后实现. 返 {qr_code: ..., pay_url: ...}."""
    if not is_configured():
        raise NotImplementedError('支付宝商户号审核中, V1 仅支持微信支付')
    raise NotImplementedError('alipay 集成待办')


def query_order(out_trade_no: str) -> dict:
    if not is_configured():
        return {'status': 'expired'}
    raise NotImplementedError('alipay 集成待办')


def verify_notify(form_data: dict) -> Optional[dict]:
    if not is_configured():
        return None
    raise NotImplementedError('alipay 集成待办')
