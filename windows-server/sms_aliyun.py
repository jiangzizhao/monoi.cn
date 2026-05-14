"""阿里云短信服务集成

不需要时 (开发环境 / 审批没通过) 让 main.py 把 SMS_MOCK_MODE 保持 True;
准备好上线时, .env 填齐 7 个变量, SMS_MOCK_MODE=False, 自动走真发送.

依赖:
  pip install alibabacloud_dysmsapi20170525 alibabacloud_tea_openapi

env 变量:
  ALIYUN_SMS_ACCESS_KEY_ID
  ALIYUN_SMS_ACCESS_KEY_SECRET
  ALIYUN_SMS_SIGN_NAME              例: monoi
  SMS_TEMPLATE_REGISTER             SMS_xxxxxxxx
  SMS_TEMPLATE_LOGIN                SMS_xxxxxxxx
  SMS_TEMPLATE_RESET_PASSWORD       SMS_xxxxxxxx
  SMS_TEMPLATE_REBIND_PHONE         SMS_xxxxxxxx
"""

import os
import json
from typing import Optional


# purpose → env 变量名 的映射
_TEMPLATE_ENV_BY_PURPOSE = {
    'register':       'SMS_TEMPLATE_REGISTER',
    'login':          'SMS_TEMPLATE_LOGIN',
    'reset_password': 'SMS_TEMPLATE_RESET_PASSWORD',
    'rebind_phone':   'SMS_TEMPLATE_REBIND_PHONE',
}


_client = None


def _get_client():
    """惰性初始化阿里云短信 client (避免无 env 也加载 SDK)"""
    global _client
    if _client is not None:
        return _client
    try:
        from alibabacloud_dysmsapi20170525.client import Client as Dysmsapi20170525Client
        from alibabacloud_tea_openapi import models as open_api_models
    except ImportError as e:
        raise RuntimeError(
            "阿里云短信 SDK 未安装. 跑: pip install alibabacloud_dysmsapi20170525 alibabacloud_tea_openapi"
        ) from e

    ak_id = os.getenv('ALIYUN_SMS_ACCESS_KEY_ID', '').strip()
    ak_secret = os.getenv('ALIYUN_SMS_ACCESS_KEY_SECRET', '').strip()
    if not ak_id or not ak_secret:
        raise RuntimeError(
            "阿里云短信 AccessKey 未配置. .env 缺 ALIYUN_SMS_ACCESS_KEY_ID / SECRET"
        )

    config = open_api_models.Config(access_key_id=ak_id, access_key_secret=ak_secret)
    config.endpoint = 'dysmsapi.aliyuncs.com'
    _client = Dysmsapi20170525Client(config)
    return _client


def is_configured() -> bool:
    """检查 env 是否齐全 (AccessKey + 签名 + 至少 1 个模板)"""
    if not os.getenv('ALIYUN_SMS_ACCESS_KEY_ID'):
        return False
    if not os.getenv('ALIYUN_SMS_ACCESS_KEY_SECRET'):
        return False
    if not os.getenv('ALIYUN_SMS_SIGN_NAME'):
        return False
    # 至少要有 register 模板
    if not os.getenv('SMS_TEMPLATE_REGISTER'):
        return False
    return True


def send_sms_code(phone: str, code: str, purpose: str) -> tuple[bool, Optional[str]]:
    """发送验证码短信.

    Args:
        phone: 11 位手机号
        code: 6 位验证码 (主程序生成的)
        purpose: 'register' / 'login' / 'reset_password' / 'rebind_phone'

    Returns:
        (success, error_message). 成功 (True, None); 失败 (False, "原因").
    """
    env_var = _TEMPLATE_ENV_BY_PURPOSE.get(purpose)
    if not env_var:
        return False, f"未知 purpose: {purpose}"
    template_code = os.getenv(env_var, '').strip()
    if not template_code:
        return False, f"模板未配置: env {env_var} 为空"

    sign_name = os.getenv('ALIYUN_SMS_SIGN_NAME', '').strip()
    if not sign_name:
        return False, "ALIYUN_SMS_SIGN_NAME 未配置"

    try:
        from alibabacloud_dysmsapi20170525 import models as dysmsapi_models
        from alibabacloud_tea_util import models as util_models

        client = _get_client()
        request = dysmsapi_models.SendSmsRequest(
            phone_numbers=phone,
            sign_name=sign_name,
            template_code=template_code,
            template_param=json.dumps({"code": code}),
        )
        runtime = util_models.RuntimeOptions()
        resp = client.send_sms_with_options(request, runtime)

        body = resp.body
        if body.code == 'OK':
            return True, None
        else:
            return False, f"阿里云返回 {body.code}: {body.message}"
    except Exception as e:
        return False, f"阿里云调用异常: {type(e).__name__}: {e}"
