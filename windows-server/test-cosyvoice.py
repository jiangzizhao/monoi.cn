"""
临时测试脚本：在长文本 REST 接口里直接调 CosyVoice 音色
看会不会成功
"""
import os
import json
import time
import requests
from aliyunsdkcore.client import AcsClient
from aliyunsdkcore.request import CommonRequest

AK_ID = os.environ.get("ALIYUN_AK_ID", "")
AK_SECRET = os.environ.get("ALIYUN_AK_SECRET", "")
APP_KEY = os.environ.get("ALIYUN_APP_KEY", "")

# 测试这些 CosyVoice 音色 key（v1 + v2）
TEST_VOICES = [
    "longwan_v2", "longxiaochun_v2", "longhua_v2", "longxiaobai",
    "longwan", "longxiaochun", "loongbella", "libai",
]

def get_token():
    client = AcsClient(AK_ID, AK_SECRET, "cn-shanghai")
    req = CommonRequest()
    req.set_method("POST")
    req.set_domain("nls-meta.cn-shanghai.aliyuncs.com")
    req.set_version("2019-02-28")
    req.set_action_name("CreateToken")
    return json.loads(client.do_action_with_exception(req))["Token"]["Id"]

def test_voice(voice, token):
    url = "https://nls-gateway-cn-shanghai.aliyuncs.com/rest/v1/tts/async"
    payload = {
        "payload": {
            "tts_request": {
                "voice": voice, "sample_rate": 16000, "format": "wav",
                "text": "测试", "speech_rate": 0, "volume": 50, "enable_subtitle": False
            },
            "enable_notify": False
        },
        "context": {"device_id": "test"},
        "header": {"appkey": APP_KEY, "token": token}
    }
    resp = requests.post(url, json=payload, timeout=10)
    data = resp.json()
    return data.get("status"), data.get("error_message", "")

token = get_token()
print(f"Token OK\n")
for v in TEST_VOICES:
    status, msg = test_voice(v, token)
    mark = "✅" if status == 200 else "❌"
    print(f"{mark} {v:30s} status={status}  msg={msg}")
