"""测试 social_publisher 模块 — 用户在 Windows 上跑这个验证 Edge persistent profile 能起来.

用法:
    cd D:\\monoi-server
    python test_publisher.py            # 弹 Edge 窗口让你登录小红书, 5 分钟后自动关
    python test_publisher.py check xhs  # 已登录? 探测一下当前状态
    python test_publisher.py check douyin

第一次跑: 弹出 Edge 后, 在浏览器里用你日常的方式登录小红书 (账号密码或手机扫码).
登录完关掉那个 Edge 窗口, 程序就退出. 之后再跑 `check xhs` 应该会显示 logged_in=True.
"""

import asyncio
import sys
from social_publisher import EDGE_PROFILE_DIR, check_login, open_login_window


async def main():
    print(f"[publisher] profile 目录: {EDGE_PROFILE_DIR}")
    cmd = sys.argv[1] if len(sys.argv) > 1 else "login"

    if cmd == "check":
        platform = sys.argv[2] if len(sys.argv) > 2 else "xhs"
        print(f"[publisher] 探测 {platform} 登录态 (headless)...")
        result = await check_login(platform)
        print(f"[publisher] 结果: {result}")
    elif cmd == "login":
        platform = sys.argv[2] if len(sys.argv) > 2 else "xhs"
        print(f"[publisher] 弹 Edge 窗口让你登录 {platform}, 登录完关窗口即可")
        print(f"[publisher] 最多等 5 分钟, 超时自动关")
        await open_login_window(platform, timeout_seconds=300)
        print(f"[publisher] 窗口已关. 现在跑 'python test_publisher.py check {platform}' 验证登录态")
    else:
        print(f"未知命令: {cmd}")
        print(__doc__)


if __name__ == "__main__":
    asyncio.run(main())
