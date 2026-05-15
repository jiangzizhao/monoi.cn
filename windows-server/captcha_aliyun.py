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
    """校验前端传来的 captcha_verify_param. 返 (ok, err_msg).
    带 10s 超时 + 详细 print, 防 SDK 网络卡住整个请求超过 Vercel 60s 限制."""
    if not captcha_verify_param:
        return False, '滑块参数为空'
    if not is_configured():
        return True, None  # 没配 env 默认放过 (调用方应先 is_configured 判)
    print(f"[captcha] verify 开始, param 长度={len(captcha_verify_param)}", flush=True)
    try:
        from alibabacloud_captcha20230305 import models as captcha_models
        from alibabacloud_tea_util import models as util_models
        client = _get_client()
        req = captcha_models.VerifyIntelligentCaptchaRequest(
            scene_id=os.getenv('ALIYUN_CAPTCHA_SCENE_ID'),
            captcha_verify_param=captcha_verify_param,
        )
        # 10 秒超时 — 阿里云正常 100ms 内返, 卡住 = 网络/服务问题, 不能让它拖死整个 send-sms
        runtime = util_models.RuntimeOptions(read_timeout=10000, connect_timeout=5000)
        resp = client.verify_intelligent_captcha_with_options(req, runtime)
        body = getattr(resp, 'body', None)
        result = getattr(body, 'result', None) if body else None
        if result is None:
            print(f"[captcha] 返回结构异常 body={body}", flush=True)
            return False, '阿里云返回结构异常'
        ok = bool(getattr(result, 'verify_result', False))
        code = getattr(result, 'verify_code', '') or ''
        print(f"[captcha] verify 返回: ok={ok} code={code}", flush=True)
        if ok:
            return True, None
        return False, f'校验未通过 (code={code})'
    except Exception as e:
        # 阿里云校验挂了 — 安全起见拒绝 (而非放过), 防故障期被绕过
        err = str(e)[:300]
        print(f"[captcha] verify 异常: {err}", flush=True)
        return False, f'阿里云校验调用失败: {err}'
