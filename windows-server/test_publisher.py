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
from social_publisher import EDGE_PROFILE_DIR, check_login, open_login_window, debug_page, inspect_upload_page, inspect_after_upload, publish_xhs, publish_douyin


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
    elif cmd == "debug":
        platform = sys.argv[2] if len(sys.argv) > 2 else "xhs"
        print(f"[publisher] 诊断 {platform}: 弹 Edge headed + 截图 + dump 关键元素")
        await debug_page(platform)
    elif cmd == "inspect":
        platform = sys.argv[2] if len(sys.argv) > 2 else "xhs"
        print(f"[publisher] 探测 {platform} 上传页 DOM (给我看 dump 输出, 我写实际 selector)")
        await inspect_upload_page(platform)
    elif cmd == "inspect-after":
        platform = sys.argv[2] if len(sys.argv) > 2 else "xhs"
        video = sys.argv[3] if len(sys.argv) > 3 else None
        if not video:
            print("用法: python test_publisher.py inspect-after xhs D:\\path\\to\\video.mp4")
            return
        print(f"[publisher] 上传 {video} 到 {platform}, 等表单渲染再 dump (不点发布)")
        await inspect_after_upload(platform, video)
    elif cmd == "publish":
        platform = sys.argv[2] if len(sys.argv) > 2 else "xhs"
        video = sys.argv[3] if len(sys.argv) > 3 else None
        title = sys.argv[4] if len(sys.argv) > 4 else "测试标题"
        desc = sys.argv[5] if len(sys.argv) > 5 else "测试描述"
        tags_str = sys.argv[6] if len(sys.argv) > 6 else ""
        tags = [t.strip() for t in tags_str.split(",") if t.strip()]
        if not video:
            print('用法: python test_publisher.py publish xhs D:\\v.mp4 "标题" "描述" "标签1,标签2"')
            return
        print(f"[publisher] 发布到 {platform}: {video}")
        if platform == "xhs":
            result = await publish_xhs(video, title, desc, tags)
        elif platform == "douyin":
            result = await publish_douyin(video, title, desc, tags)
        else:
            print(f"未知平台: {platform}")
            return
        print(f"\n[result] {result}")
    else:
        print(f"未知命令: {cmd}")
        print(__doc__)


if __name__ == "__main__":
    asyncio.run(main())
