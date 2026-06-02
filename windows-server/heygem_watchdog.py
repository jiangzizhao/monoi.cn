"""
家里数字人看门狗 —— 跑在家里 Win, 守着 HeyGem 容器。

逻辑:
  每 60s 探一次本地 HeyGem (:8383) 是否响应。
  连续 3 次不通 → docker restart 容器 (它崩了/挂了)。
  重启容器后仍连续不通 (累计 6 次) → 重启电脑 (彻底卡死, 开机自启会把一切拉回来)。

注意: 这只抓"HeyGem 进程无响应"。任务卡死(GPU 0% 但 HTTP 还活)由云端 main.py
任务超时时调 agent /restart 处理, 两边互补。

开机自启: 由 monoi_dh_backend.bat 拉起 (放 Windows 启动文件夹)。
依赖: requests + docker (家里都有)。
"""
import os
import time
import subprocess

import requests

CONTAINER = os.environ.get("HEYGEM_CONTAINER", "duix-avatar-gen-video")
HEYGEM_QUERY = "http://127.0.0.1:8383/easy/query"
INTERVAL = 60          # 每 60s 检查
FAIL_RESTART = 3       # 连续 3 次不通 → 重启容器
FAIL_REBOOT = 6        # 重启容器后仍累计 6 次不通 → 重启电脑


def _alive() -> bool:
    try:
        requests.get(HEYGEM_QUERY, params={"code": "_watchdog_"}, timeout=8)
        return True   # 任何 HTTP 响应都算活 (查不到这个假 code 也会返回, 说明服务在)
    except Exception:
        return False


def main():
    print(f"[watchdog] 启动, 守着容器 {CONTAINER}, 每 {INTERVAL}s 探一次", flush=True)
    fails = 0
    restarted = False
    while True:
        time.sleep(INTERVAL)
        if _alive():
            if fails:
                print("[watchdog] HeyGem 恢复正常", flush=True)
            fails = 0
            restarted = False
            continue
        fails += 1
        print(f"[watchdog] HeyGem 无响应 x{fails}", flush=True)
        if fails >= FAIL_REBOOT and restarted:
            print("[watchdog] 重启容器后仍无响应 → 重启电脑 (开机自启会恢复)", flush=True)
            subprocess.run(["shutdown", "/r", "/t", "10", "/c", "monoi 数字人后台卡死, 自动重启恢复"])
            return
        if fails == FAIL_RESTART:
            print(f"[watchdog] 连续 {FAIL_RESTART} 次无响应 → 重启容器 {CONTAINER}", flush=True)
            subprocess.run(["docker", "restart", CONTAINER], capture_output=True, timeout=90)
            restarted = True


if __name__ == "__main__":
    main()
