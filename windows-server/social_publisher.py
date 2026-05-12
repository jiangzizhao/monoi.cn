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

    输出 3 个文件 (都在脚本同目录):
      - inspect_<platform>.png         全页截图
      - inspect_<platform>_dump.txt   完整 dump 文本 (给我贴这个)
    """
    if platform not in PLATFORM_URLS:
        print(f"未知平台: {platform}")
        return

    # 收集到 list, 最后一次性 print + 写文件 (这样 cmd 里也能看, 文件也有备份)
    lines: list[str] = []

    def log(msg: str = ""):
        print(msg)
        lines.append(msg)

    pw, context = await launch_edge_persistent(headless=False)
    try:
        page = await context.new_page()
        await page.goto(PLATFORM_URLS[platform], wait_until="domcontentloaded", timeout=30000)
        # 上传页 SPA 渲染慢, 给 15 秒充分加载
        await page.wait_for_timeout(15000)

        log(f"========== {platform} 上传页 DOM 探测 ==========")
        log(f"最终 URL: {page.url}")
        log(f"页面标题: {await page.title()}")

        screenshot_path = os.path.join(os.path.dirname(__file__), f"inspect_{platform}.png")
        await page.screenshot(path=screenshot_path, full_page=True)
        log(f"截图 (full page): {screenshot_path}")

        log(f"\n----- 所有 <input> 元素 -----")
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
                log(f"  [{i}] {info}")
            except Exception as e:
                log(f"  [{i}] (读取失败: {e})")

        log(f"\n----- 所有 <textarea> 元素 -----")
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
                log(f"  [{i}] {info}")
            except Exception:
                pass

        log(f"\n----- 所有可见 <button> 元素 (前 30) -----")
        buttons = await page.locator("button:visible").all()
        for i, el in enumerate(buttons[:30]):
            try:
                text = (await el.inner_text() or "").strip()[:30]
                info = {
                    "text": text,
                    "aria-label": await el.get_attribute("aria-label"),
                    "class": (await el.get_attribute("class") or "")[:60],
                }
                log(f"  [{i}] {info}")
            except Exception:
                pass

        log(f"\n----- 含关键词的可见元素 -----")
        keywords = ["上传", "发布", "标题", "描述", "标签", "话题", "添加", "拖拽", "拖到"]
        for kw in keywords:
            try:
                els = await page.locator(f"text={kw}").all()
                if els:
                    log(f"  '{kw}' × {len(els)}:")
                    for j, el in enumerate(els[:5]):
                        try:
                            tag = await el.evaluate("e => e.tagName")
                            text = (await el.inner_text() or "").strip()[:40]
                            log(f"    [{j}] <{tag.lower()}> '{text}'")
                        except Exception:
                            pass
            except Exception:
                pass

        log(f"\n========== 探测结束 ==========")
        # Edge 窗口保持 60 秒 (够你看页面长什么样), 或者你自己关 Edge 提前结束
        log("Edge 窗口 60 秒后自动关, 你也可以提前手动关掉")
        try:
            await page.wait_for_event("close", timeout=60000)
        except Exception:
            pass
    finally:
        await context.close()
        await pw.stop()

    # 写文件 (在 finally 外, 确保即使中途出错也会写已收集的部分)
    dump_path = os.path.join(os.path.dirname(__file__), f"inspect_{platform}_dump.txt")
    try:
        with open(dump_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
        print(f"\n>>> dump 已写入: {dump_path}")
        print(f">>> 把这个文件的内容复制贴给我 (notepad 打开 Ctrl+A Ctrl+C 即可)")
    except Exception as e:
        print(f">>> 写 dump 文件失败: {e}")


async def inspect_after_upload(platform: str, video_path: str):
    """上传一个视频到 creator 页, 等表单渲染完, 再 dump 出现的 input/textarea/button.

    用户跑: python test_publisher.py inspect-after xhs D:\\monoi-server\\some.mp4
    输出: inspect_<platform>_after_dump.txt

    注意: 上传后**不点发布**, 视频会停在平台草稿状态, 用户自己去 creator 后台清掉.
    """
    if platform not in PLATFORM_URLS:
        print(f"未知平台: {platform}")
        return
    if not os.path.exists(video_path):
        print(f"视频文件不存在: {video_path}")
        return

    lines: list[str] = []

    def log(msg: str = ""):
        print(msg)
        lines.append(msg)

    # 提前验视频文件 size: 0 字节直接劝退, 别白等 5 分钟
    try:
        size_mb = os.path.getsize(video_path) / 1024 / 1024
    except Exception:
        size_mb = 0
    if size_mb < 0.1:
        print(f"!! 视频文件太小 ({size_mb:.2f} MB), 可能是空文件 / OSS 下载失败. 换一个再试.")
        return

    pw, context = await launch_edge_persistent(headless=False)
    try:
        page = await context.new_page()
        await page.goto(PLATFORM_URLS[platform], wait_until="domcontentloaded", timeout=30000)
        # 等初始页加载完 (上传按钮出现)
        await page.wait_for_timeout(10000)

        log(f"========== {platform} 上传后 DOM 探测 ==========")
        log(f"视频: {video_path} ({size_mb:.1f} MB)")
        log(f"上传前 URL: {page.url}")

        # set_input_files 直接喂给 file input (隐藏可见都能用)
        file_input = page.locator('input[type="file"]').first
        try:
            await file_input.set_input_files(video_path)
            log("✓ 文件已喂给 file input, 等表单渲染...")
        except Exception as e:
            log(f"✗ set_input_files 失败: {e}")
            return

        # 等上传 + 表单出现 (轮询 textarea 出现 = 上传完进入填表阶段; 最多等 5 分钟)
        log("\n----- 轮询等待表单渲染 (textarea / 多 input 出现) -----")
        upload_ready = False
        for i in range(60):  # 60 × 5s = 5 分钟
            await page.wait_for_timeout(5000)
            ta_count = await page.locator("textarea").count()
            input_count = await page.locator("input:visible").count()
            log(f"  [{i*5+5}s] textarea={ta_count}, visible input={input_count}, url={page.url[:80]}")
            if ta_count >= 1 or input_count >= 3:
                upload_ready = True
                log("  → 表单看起来渲染了, 停止轮询")
                break

        if not upload_ready:
            log("✗ 等了 5 分钟表单还没出来, 可能上传卡了, 把截图给我看")

        # 额外等 5 秒让动画结束
        await page.wait_for_timeout(5000)

        # Dump 完整 DOM (这是核心信息, 优先做; 截图放最后, 失败不影响 dump)
        log(f"\n----- 所有 <input> 元素 -----")
        for i, el in enumerate((await page.locator("input").all())[:40]):
            try:
                info = {
                    "type": await el.get_attribute("type"),
                    "placeholder": await el.get_attribute("placeholder"),
                    "aria-label": await el.get_attribute("aria-label"),
                    "name": await el.get_attribute("name"),
                    "class": (await el.get_attribute("class") or "")[:80],
                    "value": (await el.get_attribute("value") or "")[:40],
                    "visible": await el.is_visible(),
                }
                log(f"  [{i}] {info}")
            except Exception as e:
                log(f"  [{i}] err: {e}")

        log(f"\n----- 所有 <textarea> 元素 -----")
        for i, el in enumerate((await page.locator("textarea").all())[:10]):
            try:
                info = {
                    "placeholder": await el.get_attribute("placeholder"),
                    "aria-label": await el.get_attribute("aria-label"),
                    "name": await el.get_attribute("name"),
                    "class": (await el.get_attribute("class") or "")[:80],
                    "visible": await el.is_visible(),
                }
                log(f"  [{i}] {info}")
            except Exception:
                pass

        # contentEditable div (小红书的描述可能是 div 不是 textarea)
        log(f"\n----- contentEditable 元素 (可能是富文本描述框) -----")
        for i, el in enumerate((await page.locator("[contenteditable='true']:visible").all())[:10]):
            try:
                placeholder = await el.get_attribute("data-placeholder") or await el.get_attribute("placeholder")
                info = {
                    "tag": await el.evaluate("e => e.tagName"),
                    "placeholder/data-placeholder": placeholder,
                    "aria-label": await el.get_attribute("aria-label"),
                    "class": (await el.get_attribute("class") or "")[:80],
                }
                log(f"  [{i}] {info}")
            except Exception:
                pass

        log(f"\n----- 所有可见 <button> 元素 (前 40) -----")
        for i, el in enumerate((await page.locator("button:visible").all())[:40]):
            try:
                text = (await el.inner_text() or "").strip()[:40]
                info = {
                    "text": text,
                    "aria-label": await el.get_attribute("aria-label"),
                    "class": (await el.get_attribute("class") or "")[:60],
                }
                log(f"  [{i}] {info}")
            except Exception:
                pass

        log(f"\n----- 含关键词的可见元素 -----")
        keywords = ["发布", "标题", "描述", "正文", "标签", "话题", "封面", "添加", "更多", "保存", "草稿"]
        for kw in keywords:
            try:
                els = await page.locator(f"text={kw}").all()
                if els:
                    log(f"  '{kw}' × {len(els)}:")
                    for j, el in enumerate(els[:5]):
                        try:
                            tag = await el.evaluate("e => e.tagName")
                            text = (await el.inner_text() or "").strip()[:50]
                            log(f"    [{j}] <{tag.lower()}> '{text}'")
                        except Exception:
                            pass
            except Exception:
                pass

        # 截图放最后, wrap try (抖音字体加载慢, full_page screenshot 容易 timeout)
        try:
            shot_path = os.path.join(os.path.dirname(__file__), f"inspect_{platform}_after.png")
            await page.screenshot(path=shot_path, full_page=False, timeout=10000)
            log(f"\n截图: {shot_path}")
        except Exception as e:
            log(f"\n!! 截图失败 (不影响 dump): {type(e).__name__}: {e}")

        log(f"\n========== 探测结束 ==========")
        log("Edge 窗口 60 秒后自动关 (或你手动关). 视频留在平台草稿, 用完到 creator 后台删")
        try:
            await page.wait_for_event("close", timeout=60000)
        except Exception:
            pass
    except Exception as e:
        # 用户中途关 Edge 会触发 TargetClosedError, 把已收集的 dump 落盘比报错重要
        log(f"\n!! 异常中断: {type(e).__name__}: {e}")
    finally:
        # 先写 dump (即使浏览器还没关), 再清浏览器 — 保证 dump 一定能写出来
        dump_path = os.path.join(os.path.dirname(__file__), f"inspect_{platform}_after_dump.txt")
        try:
            with open(dump_path, "w", encoding="utf-8") as f:
                f.write("\n".join(lines))
            print(f"\n>>> dump 已写入: {dump_path}")
        except Exception as ex:
            print(f">>> 写 dump 文件失败: {ex}")
        try:
            await context.close()
        except Exception:
            pass
        try:
            await pw.stop()
        except Exception:
            pass


# ===================== 真发布流程 (档 B: 自动上传 + 自动填表, 不点发布) =====================


async def publish_xhs(
    video_path: str,
    title: str = "",
    description: str = "",
    tags=None,
    wait_close_timeout: int = 600,
):
    """小红书: 开 Edge → 上传 → 填标题/描述/标签 → 停在发布按钮前 → 等用户审稿点发布或关窗口.

    Args:
      video_path: 视频本地路径
      title: 标题 (建议 < 20 字, 太长 XHS 会截)
      description: 描述
      tags: 标签 list, 会以 ' #tag1 #tag2 ' 追加到描述末尾
      wait_close_timeout: 等用户操作的最长秒数 (默认 10 分钟超时强关)

    返回: { success: bool, detail: str }
    """
    if not os.path.exists(video_path):
        return {"success": False, "detail": f"视频不存在: {video_path}"}
    size_mb = os.path.getsize(video_path) / 1024 / 1024
    if size_mb < 0.1:
        return {"success": False, "detail": f"视频太小 ({size_mb:.2f} MB), 可能空文件"}

    tags = tags or []
    detail_msgs: list = []

    def step(msg: str):
        print(f"[publish_xhs] {msg}")
        detail_msgs.append(msg)

    pw, context = await launch_edge_persistent(headless=False)
    try:
        page = await context.new_page()
        await page.goto(PLATFORM_URLS["xhs"], wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(5000)

        if "login" in page.url.lower():
            step("✗ 跳到登录页, cookie 失效. 在弹出的 Edge 里重新登一次")
            try:
                await page.wait_for_event("close", timeout=wait_close_timeout * 1000)
            except Exception:
                pass
            return {"success": False, "detail": " | ".join(detail_msgs)}

        # 1. 喂视频
        step(f"上传 {os.path.basename(video_path)} ({size_mb:.1f} MB)")
        file_input = page.locator("input.upload-input").first
        await file_input.set_input_files(video_path)

        # 2. 等表单 (标题框出现)
        step("等表单渲染 (最多 5 分钟)...")
        title_input = page.locator('input[placeholder*="标题"]').first
        form_rendered = False
        try:
            await title_input.wait_for(state="visible", timeout=300_000)
            form_rendered = True
            step("✓ 表单已渲染")
        except Exception:
            step("✗ 5 分钟没等到标题框, 视频上传可能失败")

        # 3. 填表 (拟人化)
        if form_rendered and title:
            await random_sleep(800, 2000)
            await mouse_jitter(page)
            await human_type(title_input, title)
            step(f"标题已填: {title}")

        if form_rendered and (description or tags):
            await random_sleep(800, 2000)
            desc_editor = page.locator("div.tiptap.ProseMirror").first
            if await desc_editor.count() > 0:
                await desc_editor.click()
                await random_sleep(300, 700)
                full = description.strip()
                if tags:
                    if full:
                        full += "\n"
                    full += " ".join(f"#{t.strip()}" for t in tags if t.strip())
                # 逐字输入, 换行用 keyboard.press("Enter")
                for ch in full:
                    if ch == "\n":
                        await page.keyboard.press("Enter")
                        await asyncio.sleep(random.uniform(0.05, 0.15))
                    else:
                        await page.keyboard.type(ch, delay=random.uniform(30, 90))
                step(f"描述+标签已填 ({len(full)} 字)")
            else:
                step("✗ 没找到描述编辑器 (div.tiptap.ProseMirror)")

        # 4. 拟人收尾
        if form_rendered:
            await mouse_jitter(page, n=2)
            await random_sleep(1000, 2000)
            step("✓ 已停在发布按钮前. 你在 Edge 窗口审稿 → 点'发布' → 关 Edge")

        # 5. 等用户操作
        step(f"等你操作, 最多 {wait_close_timeout} 秒...")
        try:
            await page.wait_for_event("close", timeout=wait_close_timeout * 1000)
            step("Edge 已关, 流程结束")
        except Exception:
            step(f"等了 {wait_close_timeout} 秒没操作, 强制关 Edge")

        return {"success": True, "detail": " | ".join(detail_msgs)}

    except Exception as e:
        step(f"!! 异常: {type(e).__name__}: {e}")
        return {"success": False, "detail": " | ".join(detail_msgs)}
    finally:
        try:
            await context.close()
        except Exception:
            pass
        try:
            await pw.stop()
        except Exception:
            pass


async def publish_douyin(
    video_path: str,
    title: str = "",
    description: str = "",
    tags=None,
    wait_close_timeout: int = 600,
):
    """抖音: 开 Edge → 上传 → 填标题/描述/标签 → 停在'发布'按钮前 → 等用户审稿点发布或关窗口.

    跟 publish_xhs 同结构, 差异只在 selector:
    - 标题: input[placeholder*='作品标题']
    - 描述: div.editor-comp-publish[contenteditable='true']
    """
    if not os.path.exists(video_path):
        return {"success": False, "detail": f"视频不存在: {video_path}"}
    size_mb = os.path.getsize(video_path) / 1024 / 1024
    if size_mb < 0.1:
        return {"success": False, "detail": f"视频太小 ({size_mb:.2f} MB), 可能空文件"}

    tags = tags or []
    detail_msgs: list = []

    def step(msg: str):
        print(f"[publish_douyin] {msg}")
        detail_msgs.append(msg)

    pw, context = await launch_edge_persistent(headless=False)
    try:
        page = await context.new_page()
        await page.goto(PLATFORM_URLS["douyin"], wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(5000)

        # 抖音登录态判断: URL 含 login 或者跳出 creator 后台
        if "login" in page.url.lower() or "creator.douyin.com" not in page.url:
            step("✗ 跳到登录页或主站, cookie 失效. 在弹出的 Edge 里重新登一次")
            try:
                await page.wait_for_event("close", timeout=wait_close_timeout * 1000)
            except Exception:
                pass
            return {"success": False, "detail": " | ".join(detail_msgs)}

        # 1. 喂视频 (抖音 file input visible=True, 直接 set_input_files)
        step(f"上传 {os.path.basename(video_path)} ({size_mb:.1f} MB)")
        file_input = page.locator('input[type="file"]').first
        await file_input.set_input_files(video_path)

        # 2. 等标题框出现 (跳到 /post/video 后表单渲染)
        step("等表单渲染 (最多 5 分钟)...")
        title_input = page.locator('input[placeholder*="作品标题"]').first
        form_rendered = False
        try:
            await title_input.wait_for(state="visible", timeout=300_000)
            form_rendered = True
            step("✓ 表单已渲染")
        except Exception:
            step("✗ 5 分钟没等到标题框")

        # 3. 填标题
        if form_rendered and title:
            await random_sleep(800, 2000)
            await mouse_jitter(page)
            # 抖音默认标题用文件名填了, 先清空
            try:
                await title_input.click()
                await page.keyboard.press("Control+A")
                await asyncio.sleep(0.2)
                await page.keyboard.press("Delete")
                await asyncio.sleep(0.3)
            except Exception:
                pass
            await human_type(title_input, title)
            step(f"标题已填: {title}")

        # 4. 填描述+标签 (contentEditable div, 抖音用 editor-comp-publish 这个组件)
        if form_rendered and (description or tags):
            await random_sleep(800, 2000)
            desc_editor = page.locator("div.editor-comp-publish[contenteditable='true']").first
            if await desc_editor.count() > 0:
                await desc_editor.click()
                await random_sleep(300, 700)
                full = description.strip()
                if tags:
                    if full:
                        full += "\n"
                    full += " ".join(f"#{t.strip()}" for t in tags if t.strip())
                for ch in full:
                    if ch == "\n":
                        await page.keyboard.press("Enter")
                        await asyncio.sleep(random.uniform(0.05, 0.15))
                    else:
                        await page.keyboard.type(ch, delay=random.uniform(30, 90))
                step(f"描述+标签已填 ({len(full)} 字)")
            else:
                step("✗ 没找到描述编辑器 (div.editor-comp-publish)")

        # 5. 拟人收尾
        if form_rendered:
            await mouse_jitter(page, n=2)
            await random_sleep(1000, 2000)
            step("✓ 已停在'发布'按钮前. 你在 Edge 窗口审稿 → 点'发布' → 关 Edge")

        # 6. 等用户操作
        step(f"等你操作, 最多 {wait_close_timeout} 秒...")
        try:
            await page.wait_for_event("close", timeout=wait_close_timeout * 1000)
            step("Edge 已关, 流程结束")
        except Exception:
            step(f"等了 {wait_close_timeout} 秒没操作, 强制关 Edge")

        return {"success": True, "detail": " | ".join(detail_msgs)}

    except Exception as e:
        step(f"!! 异常: {type(e).__name__}: {e}")
        return {"success": False, "detail": " | ".join(detail_msgs)}
    finally:
        try:
            await context.close()
        except Exception:
            pass
        try:
            await pw.stop()
        except Exception:
            pass
