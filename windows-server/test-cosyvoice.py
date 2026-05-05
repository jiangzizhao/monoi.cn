"""
完整测试 CosyVoice 音色：提交 + 轮询查询 + 验证音频地址
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

TEST_VOICES = [
    "longwan_v2", "longxiaochun_v2", "longhua_v2", "longxiaobai",
    "longwan", "longxiaochun", "libai",
    "siqi",  # 对照组：极致音
]


def get_token():
    client = AcsClient(AK_ID, AK_SECRET, "cn-shanghai")
    req = CommonRequest()
    req.set_method("POST")
    req.set_domain("nls-meta.cn-shanghai.aliyuncs.com")
    req.set_version("2019-02-28")
    req.set_action_name("CreateToken")
    return json.loads(client.do_action_with_exception(req))["Token"]["Id"]


def submit(voice, token):
    url = "https://nls-gateway-cn-shanghai.aliyuncs.com/rest/v1/tts/async"
    payload = {
        "payload": {
            "tts_request": {
                "voice": voice, "sample_rate": 16000, "format": "wav",
                "text": "测试一下这个音色", "speech_rate": 0, "volume": 50,
                "enable_subtitle": False
            },
            "enable_notify": False
        },
        "context": {"device_id": "test"},
        "header": {"appkey": APP_KEY, "token": token}
    }
    resp = requests.post(url, json=payload, timeout=10)
    data = resp.json()
    if data.get("status") != 200:
        return None, data.get("error_message", str(data))
    return data["data"]["task_id"], None


def query(task_id, token):
    url = "https://nls-gateway-cn-shanghai.aliyuncs.com/rest/v1/tts/async"
    params = {"appkey": APP_KEY, "token": token, "task_id": task_id}
    resp = requests.get(url, params=params, timeout=10)
    return resp.json()


token = get_token()
print(f"Token OK\n")

for voice in TEST_VOICES:
    print(f"--- {voice} ---")
    task_id, err = submit(voice, token)
    if err:
        print(f"  ❌ submit failed: {err}\n")
        continue
    print(f"  task_id: {task_id}")

    # 轮询最多 60 秒
    audio_url = None
    final_data = None
    for i in range(30):
        time.sleep(2)
        data = query(task_id, token)
        body = data.get("data") or {}
        audio_url = body.get("audio_address")
        final_data = data
        if audio_url:
            print(f"  ✅ ready in {(i+1)*2}s: {audio_url[:80]}...\n")
            break
    if not audio_url:
        print(f"  ⚠️ timeout, last response: {final_data}\n")
