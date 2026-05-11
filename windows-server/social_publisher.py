"""
社交平台发布执行器 — Playwright + Edge persistent profile

设计:
- 不用 social-auto-upload 仓库代码 (无 LICENSE, 版权不清)
- 用 Playwright 直接驱动系统 Edge (Windows 默认就有, 不需要装 Chrome 不需要翻墙)
- Persistent context: profile 存到磁盘, 用户在 Edge 里手动登录一次, 之后保留登录态
- 一个 profile 目录够多平台用 (XHS / 抖音 是不同 domain, cookie 互不干扰)

Stage 1 (本文件目前阶段): 只做 launch_edge + login_probe — 不上传
Stage 2: 加 publish_xhs / publish_douyin
"""

import os
from pathlib import Path

# Edge profile 目录: 放在 voice-server 旁边 (D:\monoi-server\edge-profile)
# 跟用户日常 Edge 完全隔离, 不会污染日常浏览/收藏
EDGE_PROFILE_DIR = os.environ.get(
    "MONOI_EDGE_PROFILE",
    str(Path(__file__).parent / "edge-profile"),
)

# 平台首页 (登录探测用)
PLATFORM_URLS = {
    "xhs": "https://creator.xiaohongshu.com/publish/publish?source=official",
    "douyin": "https://creator.douyin.com/creator-micro/content/upload",
}

# 已登录的判别条件 (DOM 出现这些元素之一 = 登录态)
# 注意: 平台 DOM 会改, 这里只是 V1 启发式, 后续验证
LOGIN_PROBES = {
    "xhs": [
        # 创作者中心已登录时, 顶部会有用户头像 + "发布笔记" 按钮可用
        "text=发布笔记",
        ".upload-content",  # 上传区域 (未登录会被登录覆盖)
    ],
    "douyin": [
        "text=发布视频",
        ".upload-container",
    ],
}

# 未登录的判别 (出现这些 = 需要扫码/登录)
LOGOUT_PROBES = {
    "xhs": [
        "text=登录小红书",
        ".login-container",
    ],
    "douyin": [
        "text=扫码登录",
        ".login-mask",
    ],
}


async def launch_edge_persistent(headless: bool = False):
    """启动 Edge persistent context. 返回 (playwright, context).
    调用方记得 await context.close() 和 await playwright.stop().

    headless=False: 弹出真窗口 (首次登录用)
    headless=True:  后台跑 (cookie 已存的情况, 自动发布用)
    """
    from playwright.async_api import async_playwright

    os.makedirs(EDGE_PROFILE_DIR, exist_ok=True)
    pw = await async_playwright().start()
    context = await pw.chromium.launch_persistent_context(
        user_data_dir=EDGE_PROFILE_DIR,
        channel="msedge",            # 系统 Edge (Windows 自带)
        headless=headless,
        viewport={"width": 1440, "height": 900},
        args=[
            "--disable-blink-features=AutomationControlled",  # 反 webdriver 检测兜底
        ],
        # 不传 user_agent: 让 Edge 用真实 UA, 避免被识别
    )
    return pw, context


async def check_login(platform: str) -> dict:
    """探测某平台当前登录态. 返回:
      { "logged_in": bool, "platform": str, "url_probed": str, "detail": str }

    流程: 启 headless Edge → 打开平台创作页 → 等 8 秒 → 看 DOM 命中登录探针还是登录页探针.
    """
    if platform not in PLATFORM_URLS:
        return {"logged_in": False, "platform": platform, "detail": f"未知平台 {platform}"}

    pw, context = await launch_edge_persistent(headless=True)
    try:
        page = await context.new_page()
        url = PLATFORM_URLS[platform]
        await page.goto(url, wait_until="domcontentloaded", timeout=30000)
        # 给前端 SPA 留点时间渲染 (XHS / 抖音都是 React)
        await page.wait_for_timeout(8000)

        # 优先查"未登录"探针 (出现 = 100% 没登录)
        for sel in LOGOUT_PROBES.get(platform, []):
            try:
                if await page.locator(sel).count() > 0:
                    return {
                        "logged_in": False,
                        "platform": platform,
                        "url_probed": url,
                        "detail": f"页面出现未登录元素: {sel}",
                    }
            except Exception:
                pass

        # 再查"已登录"探针
        for sel in LOGIN_PROBES.get(platform, []):
            try:
                if await page.locator(sel).count() > 0:
                    return {
                        "logged_in": True,
                        "platform": platform,
                        "url_probed": url,
                        "detail": f"页面出现已登录元素: {sel}",
                    }
            except Exception:
                pass

        # 探针都没命中: 给个不确定结论, 返回当前 URL 让调用方诊断
        final_url = page.url
        return {
            "logged_in": False,
            "platform": platform,
            "url_probed": url,
            "detail": f"探针都没命中, 当前 URL={final_url}. selector 可能过时, 需要更新.",
        }
    finally:
        await context.close()
        await pw.stop()


async def open_login_window(platform: str, timeout_seconds: int = 300):
    """弹出 Edge 窗口让用户手动登录. 用户登录完关窗口或超时退出.

    用法: 后端 API 调这个, 返回前不等 (异步任务), 给用户开个窗口去登录.
    Profile 持久化, 登录完关掉这个窗口下次自动复用.
    """
    if platform not in PLATFORM_URLS:
        raise ValueError(f"未知平台 {platform}")

    pw, context = await launch_edge_persistent(headless=False)
    try:
        page = await context.new_page()
        await page.goto(PLATFORM_URLS[platform], wait_until="domcontentloaded", timeout=30000)
        # 等用户操作, 最多 timeout_seconds 秒 (默认 5 分钟)
        # 期间用户在弹出的 Edge 窗口里登录 (账号密码 / 微信扫码 / 手机号验证码 都行)
        # 不主动判断"登录成功", 用户登录完自己关窗口 (或等超时)
        try:
            await page.wait_for_event("close", timeout=timeout_seconds * 1000)
        except Exception:
            pass  # 超时: 强制关
    finally:
        await context.close()
        await pw.stop()
