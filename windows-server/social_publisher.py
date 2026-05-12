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

import asyncio
import os
import random
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
      { "logged_in": bool, "platform": str, "url_probed": str, "url_final": str, "detail": str }

    判断策略 (按可靠性排序):
    1. URL 重定向: 未登录会被 redirect 到登录页 (URL 含 'login' / 出 creator 后台)
    2. DOM 登录蒙层: 极少数平台不 redirect 但用蒙层挡功能

    DOM 文字探针不可靠 (平台改文案就跪), 不再用.
    """
    if platform not in PLATFORM_URLS:
        return {"logged_in": False, "platform": platform, "detail": f"未知平台 {platform}"}

    # 各平台 creator 后台 URL 的稳定前缀 (登录后 URL 必须包含这个)
    creator_prefix = {
        "xhs": "creator.xiaohongshu.com",
        "douyin": "creator.douyin.com",
    }

    pw, context = await launch_edge_persistent(headless=True)
    try:
        page = await context.new_page()
        url = PLATFORM_URLS[platform]
        await page.goto(url, wait_until="domcontentloaded", timeout=30000)
        # 给 SPA 时间渲染 + 可能的二次重定向
        await page.wait_for_timeout(8000)

        final_url = page.url

        # 判断 1: URL 含 'login' → 未登录
        if "login" in final_url.lower() or "passport" in final_url.lower():
            return {
                "logged_in": False,
                "platform": platform,
                "url_probed": url,
                "url_final": final_url,
                "detail": "被重定向到登录页",
            }

        # 判断 2: 出了 creator 后台域名 → 未登录 (抖音特别会跳到 www.douyin.com 主站)
        expected_prefix = creator_prefix.get(platform)
        if expected_prefix and expected_prefix not in final_url:
            return {
                "logged_in": False,
                "platform": platform,
                "url_probed": url,
                "url_final": final_url,
                "detail": f"被重定向出 creator 后台 (期望 {expected_prefix})",
            }

        # 判断 3: DOM 登录蒙层兜底 (有些平台不 redirect 用 modal 挡)
        for sel in LOGOUT_PROBES.get(platform, []):
            try:
                if await page.locator(sel).count() > 0:
                    return {
                        "logged_in": False,
                        "platform": platform,
                        "url_probed": url,
                        "url_final": final_url,
                        "detail": f"DOM 出现登录蒙层: {sel}",
                    }
            except Exception:
                pass

        return {
            "logged_in": True,
            "platform": platform,
            "url_probed": url,
            "url_final": final_url,
            "detail": "URL 仍在 creator 后台, 没有登录蒙层",
        }
    finally:
        await context.close()
        await pw.stop()


async def debug_page(platform: str):
    """诊断: headed 启 Edge 打开 upload 页 + 截图 + dump 关键元素.
    用于将来 selector 失效时定位用. 跑 `python test_publisher.py debug xhs/douyin`.
    """
    if platform not in PLATFORM_URLS:
        print(f"未知平台: {platform}")
        return

    pw, context = await launch_edge_persistent(headless=False)
    try:
        page = await context.new_page()
        await page.goto(PLATFORM_URLS[platform], wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(10000)

        screenshot_path = os.path.join(os.path.dirname(__file__), f"debug_{platform}.png")
        await page.screenshot(path=screenshot_path, full_page=False)
        print(f"[debug] 截图: {screenshot_path}")
        print(f"[debug] 最终 URL: {page.url}")
        print(f"[debug] 页面标题: {await page.title()}")

        # 试探常见标识词
        markers = [
            "发布视频", "发布笔记", "上传视频", "上传作品", "创作中心",
            "作品管理", "我的", "登录", "扫码登录", "退出", "账号",
        ]
        for m in markers:
            try:
                cnt = await page.locator(f"text={m}").count()
                if cnt > 0:
                    print(f"[debug]  ✓ text='{m}' × {cnt}")
            except Exception:
                pass

        # 让用户看 3 秒再关
        await page.wait_for_timeout(3000)
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


# ===================== 拟人化辅助 (反检测) =====================
# 平台风控会看行为节奏: 1 秒填完整个表单 / 0 鼠标轨迹 / fill() 一次塞入 = 高危
# 这组函数加随机延迟 + 逐字输入 + 偶尔的鼠标移动, 让操作节奏接近真人


async def random_sleep(min_ms: int = 600, max_ms: int = 1800):
    """两个动作之间随机停顿"""
    await asyncio.sleep(random.uniform(min_ms / 1000, max_ms / 1000))


async def human_type(locator, text: str, per_char_min: int = 30, per_char_max: int = 90):
    """逐字输入, 每字符随机间隔. 比 page.fill() 慢一截但接近真人打字."""
    await locator.click()
    await asyncio.sleep(random.uniform(0.2, 0.5))
    for ch in text:
        await locator.type(ch, delay=random.uniform(per_char_min, per_char_max))


async def mouse_jitter(page, n: int = 2):
    """随机移动鼠标到画面不同位置, 模拟视线扫读. 调用方在 input 之间穿插用."""
    w = page.viewport_size["width"] if page.viewport_size else 1440
    h = page.viewport_size["height"] if page.viewport_size else 900
    for _ in range(n):
        x = random.randint(int(w * 0.2), int(w * 0.8))
        y = random.randint(int(h * 0.2), int(h * 0.8))
        await page.mouse.move(x, y, steps=random.randint(10, 25))
        await asyncio.sleep(random.uniform(0.1, 0.3))


# ===================== Selector 探测 (给 stage 2.x 选 selector 用) =====================


async def inspect_upload_page(platform: str):
    """Headed 打开 creator 上传页, dump 所有 input/button/textarea 的可识别属性 + 截图.

    给我看 dump 输出, 我才能写准 publish_xhs / publish_douyin 的实际 selector.
    用户在 Windows 上跑: python test_publisher.py inspect xhs (或 douyin)
    """
    if platform not in PLATFORM_URLS:
        print(f"未知平台: {platform}")
        return

    pw, context = await launch_edge_persistent(headless=False)
    try:
        page = await context.new_page()
        await page.goto(PLATFORM_URLS[platform], wait_until="domcontentloaded", timeout=30000)
        # 上传页 SPA 渲染慢, 给 15 秒充分加载
        await page.wait_for_timeout(15000)

        print(f"\n========== {platform} 上传页 DOM 探测 ==========")
        print(f"最终 URL: {page.url}")
        print(f"页面标题: {await page.title()}")

        # 截图 (帮我视觉对照)
        screenshot_path = os.path.join(os.path.dirname(__file__), f"inspect_{platform}.png")
        await page.screenshot(path=screenshot_path, full_page=True)
        print(f"截图 (full page): {screenshot_path}")

        # Dump 所有 input
        print(f"\n----- 所有 <input> 元素 -----")
        inputs = await page.locator("input").all()
        for i, el in enumerate(inputs[:30]):
            try:
                info = {
                    "type": await el.get_attribute("type"),
                    "placeholder": await el.get_attribute("placeholder"),
                    "aria-label": await el.get_attribute("aria-label"),
                    "name": await el.get_attribute("name"),
                    "class": (await el.get_attribute("class") or "")[:80],
                    "visible": await el.is_visible(),
                }
                print(f"  [{i}] {info}")
            except Exception as e:
                print(f"  [{i}] (读取失败: {e})")

        # Dump 所有 textarea
        print(f"\n----- 所有 <textarea> 元素 -----")
        textareas = await page.locator("textarea").all()
        for i, el in enumerate(textareas[:10]):
            try:
                info = {
                    "placeholder": await el.get_attribute("placeholder"),
                    "aria-label": await el.get_attribute("aria-label"),
                    "name": await el.get_attribute("name"),
                    "class": (await el.get_attribute("class") or "")[:80],
                    "visible": await el.is_visible(),
                }
                print(f"  [{i}] {info}")
            except Exception:
                pass

        # Dump 所有可见 button (取前 30 个, 太多会刷屏)
        print(f"\n----- 所有可见 <button> 元素 (前 30) -----")
        buttons = await page.locator("button:visible").all()
        for i, el in enumerate(buttons[:30]):
            try:
                text = (await el.inner_text() or "").strip()[:30]
                info = {
                    "text": text,
                    "aria-label": await el.get_attribute("aria-label"),
                    "class": (await el.get_attribute("class") or "")[:60],
                }
                print(f"  [{i}] {info}")
            except Exception:
                pass

        # Dump 顶级可见的 div 里带 "上传"/"发布"/"标题" 等字眼的 (有些平台用 div + onclick 不是 button)
        print(f"\n----- 含关键词的可见元素 -----")
        keywords = ["上传", "发布", "标题", "描述", "标签", "话题", "添加", "拖拽", "拖到"]
        for kw in keywords:
            try:
                els = await page.locator(f"text={kw}").all()
                if els:
                    print(f"  '{kw}' × {len(els)}:")
                    for j, el in enumerate(els[:5]):
                        try:
                            tag = await el.evaluate("e => e.tagName")
                            text = (await el.inner_text() or "").strip()[:40]
                            print(f"    [{j}] <{tag.lower()}> '{text}'")
                        except Exception:
                            pass
            except Exception:
                pass

        print(f"\n========== 探测结束 (Edge 窗口 5 秒后自动关) ==========\n")
        await page.wait_for_timeout(5000)
    finally:
        await context.close()
        await pw.stop()
