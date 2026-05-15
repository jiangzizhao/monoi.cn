"""阿里云人机验证 (Captcha 2.0) 后端校验封装.

依赖: pip install alibabacloud_captcha20230305 alibabacloud_tea_openapi (可选, 没装时 is_configured() 返 False)

env 变量 (3 个齐了才启用):
- ALIYUN_CAPTCHA_ACCESS_KEY_ID      (RAM 用户 AccessKey, 加 AliyunCaptchaFullAccess 权限)
- ALIYUN_CAPTCHA_ACCESS_KEY_SECRET
- ALIYUN_CAPTCHA_SCENE_ID           (在 阿里云控制台 → 人机验证 → 场景管理 创建后拿到, 前端也要用同一个)

工作流:
1. 用户在前端滑完滑块 → SDK 给一个字符串 captcha_verify_param
2. 前端把 captcha_verify_param 跟业务请求 (如 send-sms) 一起 POST 给后端
3. 后端调本模块 verify(captcha_verify_param) → 返 (ok, err_msg)
4. ok=True 才执行业务 (发短信), False 就 403
"""
import os
from typing import Optional

_REQUIRED = (
    'ALIYUN_CAPTCHA_ACCESS_KEY_ID',
    'ALIYUN_CAPTCHA_ACCESS_KEY_SECRET',
    'ALIYUN_CAPTCHA_SCENE_ID',
)

_client = None


def is_configured() -> bool:
    return all(os.getenv(k) for k in _REQUIRED)


def _get_client():
    global _client
    if _client is not None:
        return _client
    # 惰性 import: 没装 SDK 时 is_configured() 已经挡掉了, 这里再 import 报错 = 配了 env 但没装包
    from alibabacloud_captcha20230305.client import Client as CaptchaClient
    from alibabacloud_tea_openapi import models as open_api_models

    config = open_api_models.Config(
        access_key_id=os.getenv('ALIYUN_CAPTCHA_ACCESS_KEY_ID'),
        access_key_secret=os.getenv('ALIYUN_CAPTCHA_ACCESS_KEY_SECRET'),
        endpoint='captcha.cn-shanghai.aliyuncs.com',
    )
    _client = CaptchaClient(config)
    return _client


def verify(captcha_verify_param: str) -> tuple[bool, Optional[str]]:
    """校验前端传来的 captcha_verify_param. 返 (ok, err_msg)."""
    if not captcha_verify_param:
        return False, '滑块参数为空'
    if not is_configured():
        # 没配 env 不该走到这里 (调用方应该先 is_configured() 判). 安全起见: 默认放过.
        return True, None
    try:
        from alibabacloud_captcha20230305 import models as captcha_models
        client = _get_client()
        req = captcha_models.VerifyIntelligentCaptchaRequest(
            scene_id=os.getenv('ALIYUN_CAPTCHA_SCENE_ID'),
            captcha_verify_param=captcha_verify_param,
        )
        resp = client.verify_intelligent_captcha(req)
        # 阿里云返回结构: resp.body.result.verify_result (bool) + resp.body.result.verify_code (str)
        body = getattr(resp, 'body', None)
        result = getattr(body, 'result', None) if body else None
        if result is None:
            return False, '阿里云返回结构异常'
        ok = bool(getattr(result, 'verify_result', False))
        if ok:
            return True, None
        code = getattr(result, 'verify_code', '') or ''
        return False, f'校验未通过 (code={code})'
    except Exception as e:
        # 阿里云校验本身挂了 — 安全起见拒绝 (而不是放过), 否则故障期会被绕过
        return False, f'阿里云校验调用失败: {str(e)[:200]}'
