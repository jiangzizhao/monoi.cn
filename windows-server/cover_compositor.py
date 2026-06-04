"""封面模板渲染器 — 用户填字 + 人物坑 → 合成最终封面 PNG

依赖:
- rembg (人物抠图, U2Net 模型, CPU 即可, ~5s/张) — venv 装: pip install rembg[cpu]
- Pillow (Python 图像处理, 已经在用)

数据流:
1. 拉模板配置 (bg_oss_key, text_fields, person_slot)
2. 下载底图 PNG
3. (可选) 下载用户人物图 → rembg 抠图 → 加描边 → 按 fit_mode 塞进 person_slot
4. 按 text_fields 配置, 用户填的文字 Pillow 画上去 (支持 {} 多色)
5. 输出最终 PNG, 上传 OSS

公开函数:
- remove_bg_with_stroke(input_bytes, stroke_color, stroke_width) → 透明 PNG bytes
- render_cover(bg_path, text_fields, user_texts, person_slot, person_png_path) → Image
"""

import os
import re
from io import BytesIO
from typing import Optional

from PIL import Image, ImageDraw, ImageFont, ImageFilter


# ============== 字体加载 (跟 voice-server.py 的逻辑保持一致) ==============

_FONT_DIR_PROJECT = os.environ.get('FONTS_DIR') or (r'D:\monoi-server\fonts' if os.name == 'nt' else '/data/monoi-server/fonts')
# 兜底字体: Windows 用微软雅黑, Linux 用 Noto CJK (apt install fonts-noto-cjk)
_FONT_FALLBACK = 'C:/Windows/Fonts/msyhbd.ttc' if os.name == 'nt' else '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'


def _load_font(filename: str, size: int):
    """从项目 fonts 目录加载, 找不到 fallback 微软雅黑"""
    candidates = [
        os.path.join(_FONT_DIR_PROJECT, filename) if filename else None,
        _FONT_FALLBACK,
    ]
    for path in candidates:
        if path and os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()


# ============== 人物抠图 + 描边 ==============

# 全局缓存 rembg session, 避免每次都加载模型 (200MB)
_rembg_session = None


def _get_rembg_session():
    global _rembg_session
    if _rembg_session is None:
        from rembg import new_session
        _rembg_session = new_session('u2net')   # 默认 U2Net, 人物效果好
    return _rembg_session


def add_stroke_to_image(img, stroke_color: str = '#FFFFFF', stroke_width: int = 12):
    """给已抠好的透明 PNG (RGBA Image) 加描边, 返 RGBA Image.

    描边实现: alpha 通道用 MaxFilter 膨胀 → 拿膨胀外圈 → 染色叠到原图底下.
    给"人物库只存光图、生成封面时按模板 person_slot 配置加描边"用."""
    img = img.convert('RGBA')
    if stroke_width <= 0:
        return img
    alpha = img.split()[-1]
    # MaxFilter 一次膨胀 ~ filter_size//2 像素, 多次迭代
    grown = alpha
    for _ in range(int(stroke_width)):
        grown = grown.filter(ImageFilter.MaxFilter(3))
    stroke_rgb = _hex_to_rgb(stroke_color)
    stroke_layer = Image.new('RGBA', img.size, stroke_rgb + (0,))
    stroke_layer.putalpha(grown)
    # 原图叠在描边层上 (原图盖中心, 描边只剩外圈)
    return Image.alpha_composite(stroke_layer, img)


def remove_bg_with_stroke(
    input_bytes: bytes,
    stroke_enabled: bool = True,
    stroke_color: str = '#FFFFFF',
    stroke_width: int = 12,
) -> bytes:
    """rembg 抠图 → (可选) 加描边 → 返透明 PNG bytes."""
    from rembg import remove

    # rembg 抠图 (输入任意格式, 输出 PNG bytes with alpha)
    output_bytes = remove(input_bytes, session=_get_rembg_session())
    img = Image.open(BytesIO(output_bytes)).convert('RGBA')

    if stroke_enabled and stroke_width > 0:
        img = add_stroke_to_image(img, stroke_color, stroke_width)

    out = BytesIO()
    img.save(out, format='PNG')
    return out.getvalue()


# ============== 颜色工具 ==============

def _hex_to_rgb(h: str) -> tuple:
    """#RRGGBB → (r, g, b)"""
    h = h.lstrip('#')
    if len(h) == 3:
        h = ''.join(c * 2 for c in h)
    if len(h) != 6:
        return (255, 255, 255)
    try:
        return (int(h[:2], 16), int(h[2:4], 16), int(h[4:], 16))
    except Exception:
        return (255, 255, 255)


# ============== 多色标题解析 ==============

_HIGHLIGHT_RE = re.compile(r'\{([^{}]*)\}')


def _parse_segments(text: str) -> list:
    """把 '主文本{高亮}后续' 拆成 [(text, is_highlight), ...]

    例: '封面{邪修}太香' → [('封面', False), ('邪修', True), ('太香', False)]"""
    segments = []
    last = 0
    for m in _HIGHLIGHT_RE.finditer(text or ''):
        if m.start() > last:
            segments.append((text[last:m.start()], False))
        segments.append((m.group(1), True))
        last = m.end()
    if last < len(text or ''):
        segments.append((text[last:], False))
    return segments


# ============== 单字段文字渲染 ==============

def _draw_text_field(img: Image.Image, field: dict, user_text: str):
    """把 user_text 按 field 配置画到 img 上 (in-place).
    支持 {} 多色, 描边, 对齐, 自动缩字号, 旋转. 单行渲染.

    实现: 先画到临时 RGBA layer → 如有 rotation 旋转 → paste 到主图. 这样旋转不会模糊."""
    measure_draw = ImageDraw.Draw(img)    # 借主图做测量

    font_file = field.get('font_file', 'SourceHanSansCN-Heavy.otf')
    font_size = int(field.get('font_size', 80))
    color_rgb = _hex_to_rgb(field.get('color', '#FFFFFF'))
    highlight_rgb = _hex_to_rgb(field.get('highlight_color') or field.get('color', '#FFFFFF'))
    stroke_color = field.get('stroke_color')
    stroke_width = int(field.get('stroke_width', 0))
    align = field.get('align', 'left')
    rotation = float(field.get('rotation') or 0)

    box_x = int(field.get('x', 0))
    box_y = int(field.get('y', 0))
    box_w = int(field.get('w', 200))
    box_h = int(field.get('h', 80))

    segments = _parse_segments(user_text)
    if not segments:
        return

    # 竖排 (竖版): 逐字从上往下排, 单独一条渲染路径 (跟弧形/自由变形互斥)
    if field.get('vertical'):
        _draw_vertical_field(img, field, segments)
        return

    # 自动缩字号: 测量总宽, 超过 box_w 就缩 (描边宽度也算总宽里, stroke 扩两侧)
    cur_size = font_size
    while cur_size > 12:
        font = _load_font(font_file, cur_size)
        total_w = sum(_measure_text(measure_draw, t, font) for t, _ in segments) + stroke_width * 2
        if total_w <= box_w:
            break
        cur_size = int(cur_size * 0.92)

    font = _load_font(font_file, cur_size)
    total_w = sum(_measure_text(measure_draw, t, font) for t, _ in segments)
    asc = font.getmetrics()[0]
    desc = font.getmetrics()[1]
    text_h = asc + desc

    # 弧形/扇形: 逐字沿圆弧摆放 (text_arc 度数, >0 上弧 ∩, <0 下弧 ∪). 单独走一条渲染路径.
    text_arc = float(field.get('text_arc', 0) or 0)
    if abs(text_arc) >= 1:
        _draw_arc_field(img, field, segments, font, cur_size, total_w, text_h,
                        color_rgb, highlight_rgb, stroke_color, stroke_width,
                        box_x, box_y, box_w, box_h, rotation, text_arc)
        return

    # 1. 在临时 layer 上画文字 (layer 比 text 大一点留 margin, 防描边/旋转裁边)
    # 阴影参数 (CoverTextField 已有这些字段, 之前没渲染上)
    shadow_color = field.get('shadow_color')
    shadow_ox = int(field.get('shadow_offset_x', 0) or 0)
    shadow_oy = int(field.get('shadow_offset_y', 0) or 0)
    shadow_blur = int(field.get('shadow_blur', 0) or 0)

    # 文字背景底色块 (圆角矩形垫在文字后, 提升可读性/突出标题)
    bg_color = field.get('bg_color')
    bg_radius = int(field.get('bg_radius', 0) or 0)
    bg_pad_x = int(cur_size * 0.28) if bg_color else 0
    bg_pad_y = int(cur_size * 0.16) if bg_color else 0

    margin = max(stroke_width * 2 + 4, int(cur_size * 0.3),
                 abs(shadow_ox) + shadow_blur * 3 + 4, abs(shadow_oy) + shadow_blur * 3 + 4,
                 bg_pad_x + 4, bg_pad_y + 4)
    layer_w = total_w + margin * 2
    layer_h = text_h + margin * 2
    layer = Image.new('RGBA', (layer_w, layer_h), (0, 0, 0, 0))
    # 1) 最底层: 文字背景色块
    if bg_color:
        bgd = ImageDraw.Draw(layer)
        rx0, ry0 = margin - bg_pad_x, margin - bg_pad_y
        rx1, ry1 = margin + total_w + bg_pad_x, margin + text_h + bg_pad_y
        radius = int((ry1 - ry0) / 2 * max(0, min(100, bg_radius)) / 100)
        try:
            bgd.rounded_rectangle([rx0, ry0, rx1, ry1], radius=radius, fill=_hex_to_rgb(bg_color))
        except Exception:
            bgd.rectangle([rx0, ry0, rx1, ry1], fill=_hex_to_rgb(bg_color))
    # 2) 阴影: 独立层画偏移的阴影文字 → 高斯模糊 → 叠在背景块之上、文字之下
    if shadow_color:
        shadow_layer = Image.new('RGBA', (layer_w, layer_h), (0, 0, 0, 0))
        sdraw = ImageDraw.Draw(shadow_layer)
        sx = margin + shadow_ox
        for _seg, _ in segments:
            if not _seg:
                continue
            sdraw.text((sx, margin + shadow_oy), _seg, font=font, fill=_hex_to_rgb(shadow_color))
            sx += _measure_text(sdraw, _seg, font)
        if shadow_blur > 0:
            shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(shadow_blur))
        layer.alpha_composite(shadow_layer)
    layer_draw = ImageDraw.Draw(layer)

    cur_x_in_layer = margin
    y_in_layer = margin
    for seg_text, is_highlight in segments:
        if not seg_text:
            continue
        fill = highlight_rgb if is_highlight else color_rgb
        if stroke_color and stroke_width > 0:
            stroke_rgb = _hex_to_rgb(stroke_color)
            layer_draw.text((cur_x_in_layer, y_in_layer), seg_text, font=font, fill=fill,
                            stroke_width=stroke_width, stroke_fill=stroke_rgb)
        else:
            layer_draw.text((cur_x_in_layer, y_in_layer), seg_text, font=font, fill=fill)
        cur_x_in_layer += _measure_text(layer_draw, seg_text, font)

    # 1b. 下划线 (画在主文字下方, 随 layer 一起旋转). 样式: solid / wavy / double
    underline_style = field.get('underline_style', 'none')
    if underline_style and underline_style != 'none':
        import math
        u_color = _hex_to_rgb(field.get('underline_color') or field.get('color', '#FFFFFF'))
        u_thick = max(2, int(cur_size * 0.06))
        u_y = y_in_layer + text_h + int(cur_size * 0.06)
        # 长度 = 文字宽的百分比 (居中). 20-100, 默认 100 (整行宽)
        u_len_pct = max(5, min(100, int(field.get('underline_length_pct', 100) or 100)))
        u_len = total_w * u_len_pct / 100.0
        u_cx = margin + total_w / 2.0
        u_x0, u_x1 = u_cx - u_len / 2.0, u_cx + u_len / 2.0
        if underline_style == 'wavy':
            amp = u_thick * 1.4
            period = max(8.0, cur_size * 0.45)
            pts = []
            x = float(u_x0)
            while x <= u_x1:
                pts.append((x, u_y + amp * math.sin((x - u_x0) / period * 2 * math.pi)))
                x += 2
            if len(pts) > 1:
                layer_draw.line(pts, fill=u_color, width=u_thick, joint='curve')
        elif underline_style == 'double':
            layer_draw.line([(u_x0, u_y), (u_x1, u_y)], fill=u_color, width=u_thick)
            layer_draw.line([(u_x0, u_y + u_thick * 2), (u_x1, u_y + u_thick * 2)], fill=u_color, width=u_thick)
        else:  # solid
            layer_draw.line([(u_x0, u_y), (u_x1, u_y)], fill=u_color, width=u_thick)

    # 1c. 自由变形 (透视): 拖 box 四角 → 把文字 warp 成任意四边形 (梯形只是其中一种). 跟弧形互斥.
    # text_warp = [[dx,dy]×4] 角偏移 (TL,TR,BR,BL), 单位 = box(w,h) 的比例. None/全0 = 不变形.
    text_warp = field.get('text_warp')
    warped = False
    if _warp_nontrivial(text_warp):
        layer = _apply_box_warp(layer, text_warp, box_w, box_h, margin)
        warped = True

    # 2. 如有 rotation 旋转 (PIL rotate 正数为逆时针, CSS 正数为顺时针. 统一用 CSS 习惯, 这里取负)
    if abs(rotation) > 0.01:
        layer = layer.rotate(-rotation, expand=True, resample=Image.BICUBIC)

    # 3. paste: layer 中心对齐到 box 中心 (跟 admin 拖框时 box 视觉一致)
    box_cx = box_x + box_w // 2
    box_cy = box_y + box_h // 2
    # 对齐方式: 没旋转时按 align 左/中/右; 旋转或变形时统一用中心 (变形层已是 box 大小, 居中=对齐box)
    if abs(rotation) > 0.01 or align == 'center' or warped:
        paste_x = box_cx - layer.width // 2
    elif align == 'right':
        paste_x = box_x + box_w - (total_w + margin)    # 文字右缘对齐 box 右
    else:                                                # left
        paste_x = box_x - margin                         # 文字左缘对齐 box 左
    paste_y = box_cy - layer.height // 2

    img.alpha_composite(layer, (paste_x, paste_y))


def _draw_vertical_field(img: Image.Image, field: dict, segments: list):
    """竖版: 逐字从上往下排, 每字水平居中. 自动缩字号到塞进 box 高度. 含描边/阴影/多色.
    自包含 (从 field 自己读所有配置), 跟弧形/自由变形互斥."""
    measure = ImageDraw.Draw(img)
    font_file = field.get('font_file', 'SourceHanSansCN-Heavy.otf')
    font_size = int(field.get('font_size', 80))
    color_rgb = _hex_to_rgb(field.get('color', '#FFFFFF'))
    highlight_rgb = _hex_to_rgb(field.get('highlight_color') or field.get('color', '#FFFFFF'))
    stroke_color = field.get('stroke_color')
    stroke_width = int(field.get('stroke_width', 0))
    rotation = float(field.get('rotation') or 0)
    box_x = int(field.get('x', 0)); box_y = int(field.get('y', 0))
    box_w = int(field.get('w', 200)); box_h = int(field.get('h', 80))
    shadow_color = field.get('shadow_color')
    shadow_ox = int(field.get('shadow_offset_x', 0) or 0)
    shadow_oy = int(field.get('shadow_offset_y', 0) or 0)
    shadow_blur = int(field.get('shadow_blur', 0) or 0)

    # 拍平成逐字 (含各自颜色)
    chars = []
    for seg_text, is_hl in segments:
        fill = highlight_rgb if is_hl else color_rgb
        for ch in seg_text:
            if ch in '\r\n\t':
                continue
            chars.append((ch, fill))
    if not chars:
        return
    n = len(chars)

    # 自动缩字号: n 个字竖着叠起来塞进 box 高
    cur = font_size
    while cur > 12:
        font = _load_font(font_file, cur)
        a, d = font.getmetrics()
        if (a + d) * n + stroke_width * 2 <= box_h:
            break
        cur = int(cur * 0.92)
    font = _load_font(font_file, cur)
    asc, desc = font.getmetrics()
    line_h = asc + desc
    char_w = max(_measure_text(measure, ch, font) for ch, _ in chars)

    bg_color = field.get('bg_color')
    bg_radius = int(field.get('bg_radius', 0) or 0)
    bg_pad_x = int(cur * 0.28) if bg_color else 0
    bg_pad_y = int(cur * 0.16) if bg_color else 0

    margin = max(stroke_width * 2 + 4, int(cur * 0.3),
                 abs(shadow_ox) + shadow_blur * 3 + 4, abs(shadow_oy) + shadow_blur * 3 + 4,
                 bg_pad_x + 4, bg_pad_y + 4)
    layer_w = char_w + margin * 2
    layer_h = line_h * n + margin * 2
    layer = Image.new('RGBA', (layer_w, layer_h), (0, 0, 0, 0))

    # 文字背景色块 (竖排: 整列后面垫圆角块)
    if bg_color:
        bgd = ImageDraw.Draw(layer)
        rx0, ry0 = margin - bg_pad_x, margin - bg_pad_y
        rx1, ry1 = margin + char_w + bg_pad_x, margin + line_h * n + bg_pad_y
        radius = int(min(rx1 - rx0, ry1 - ry0) / 2 * max(0, min(100, bg_radius)) / 100)
        try:
            bgd.rounded_rectangle([rx0, ry0, rx1, ry1], radius=radius, fill=_hex_to_rgb(bg_color))
        except Exception:
            bgd.rectangle([rx0, ry0, rx1, ry1], fill=_hex_to_rgb(bg_color))

    # 阴影: 独立层逐字画偏移 → 高斯模糊 → 叠在背景之上文字之下
    if shadow_color:
        sl = Image.new('RGBA', (layer_w, layer_h), (0, 0, 0, 0))
        sd = ImageDraw.Draw(sl)
        for i, (ch, _) in enumerate(chars):
            cw = _measure_text(sd, ch, font)
            sd.text((margin + (char_w - cw) / 2 + shadow_ox, margin + i * line_h + shadow_oy),
                    ch, font=font, fill=_hex_to_rgb(shadow_color))
        if shadow_blur > 0:
            sl = sl.filter(ImageFilter.GaussianBlur(shadow_blur))
        layer.alpha_composite(sl)

    dr = ImageDraw.Draw(layer)
    stroke_rgb = _hex_to_rgb(stroke_color) if stroke_color else None
    for i, (ch, fill) in enumerate(chars):
        cw = _measure_text(dr, ch, font)
        x = margin + (char_w - cw) / 2.0   # 每字水平居中
        y = margin + i * line_h
        if stroke_rgb and stroke_width > 0:
            dr.text((x, y), ch, font=font, fill=fill, stroke_width=stroke_width, stroke_fill=stroke_rgb)
        else:
            dr.text((x, y), ch, font=font, fill=fill)

    if abs(rotation) > 0.01:
        layer = layer.rotate(-rotation, expand=True, resample=Image.BICUBIC)
    box_cx = box_x + box_w // 2
    box_cy = box_y + box_h // 2
    img.alpha_composite(layer, (box_cx - layer.width // 2, box_cy - layer.height // 2))


def _draw_arc_field(img, field, segments, font, cur_size, total_w, text_h,
                    color_rgb, highlight_rgb, stroke_color, stroke_width,
                    box_x, box_y, box_w, box_h, rotation, arc_deg):
    """弧形/扇形: 逐字沿圆弧摆放 + 切向旋转, 居中贴到 box 中心.
    arc_deg>0 上弧 ∩ (顶点在上, 两端下沉); <0 下弧 ∪. 弧长=文字总宽, 半径 R=弧长/弧度."""
    import math
    # 拍平成逐字 (含各自颜色; 跳过空白但保留普通空格)
    chars = []
    for seg_text, is_hl in segments:
        fill = highlight_rgb if is_hl else color_rgb
        for ch in seg_text:
            if ch in '\r\n\t':
                continue
            chars.append((ch, fill))
    if not chars:
        return

    md = ImageDraw.Draw(img)
    widths = [max(1, _measure_text(md, ch, font)) for ch, _ in chars]
    W = float(sum(widths)) or 1.0
    A = math.radians(min(abs(arc_deg), 340.0))   # 弧度, 上限防退化成整圆
    R = W / A
    d = 1.0 if arc_deg >= 0 else -1.0
    stroke_rgb = _hex_to_rgb(stroke_color) if stroke_color else None

    # 逐字中心角 + 字心相对坐标 (apex 为原点)
    placements = []   # (x_rel, y_rel, rot_deg, ch, fill, w)
    cum = 0.0
    for (ch, fill), w in zip(chars, widths):
        theta = ((cum + w / 2.0) / W - 0.5) * A     # -A/2 .. +A/2
        x_rel = R * math.sin(theta)
        y_rel = d * R * (1.0 - math.cos(theta))      # 上弧: 两端 y 增大(下沉)
        rot_deg = d * math.degrees(theta)            # 切向 (CSS 顺时针为正)
        placements.append((x_rel, y_rel, rot_deg, ch, fill, w))
        cum += w

    pad = int(max(cur_size, text_h) * 0.8) + stroke_width * 2 + 6
    xs = [p[0] for p in placements]
    ys = [p[1] for p in placements]
    min_x, max_x, min_y, max_y = min(xs), max(xs), min(ys), max(ys)
    layer_w = int((max_x - min_x) + cur_size + pad * 2)
    layer_h = int((max_y - min_y) + text_h + pad * 2)
    layer = Image.new('RGBA', (layer_w, layer_h), (0, 0, 0, 0))
    origin_x = pad + cur_size / 2.0 - min_x          # 字心坐标原点在 layer 上的位置
    origin_y = pad + text_h / 2.0 - min_y

    for x_rel, y_rel, rot_deg, ch, fill, w in placements:
        ch_w = int(w + stroke_width * 2 + 4)
        ch_h = int(text_h + stroke_width * 2 + 4)
        tile = Image.new('RGBA', (ch_w, ch_h), (0, 0, 0, 0))
        td = ImageDraw.Draw(tile)
        tx, ty = stroke_width + 2, stroke_width + 2
        if stroke_rgb and stroke_width > 0:
            td.text((tx, ty), ch, font=font, fill=fill,
                    stroke_width=stroke_width, stroke_fill=stroke_rgb)
        else:
            td.text((tx, ty), ch, font=font, fill=fill)
        if abs(rot_deg) > 0.01:
            tile = tile.rotate(-rot_deg, expand=True, resample=Image.BICUBIC)  # CSS+ → PIL 取负
        cx = origin_x + x_rel
        cy = origin_y + y_rel
        layer.alpha_composite(tile, (int(cx - tile.width / 2.0), int(cy - tile.height / 2.0)))

    if abs(rotation) > 0.01:
        layer = layer.rotate(-rotation, expand=True, resample=Image.BICUBIC)

    box_cx = box_x + box_w // 2
    box_cy = box_y + box_h // 2
    img.alpha_composite(layer, (box_cx - layer.width // 2, box_cy - layer.height // 2))


def _draw_line_field(img: Image.Image, line: dict):
    """独立装饰线条: 在 box(x/y/w/h) 内, 横贯盒宽画一条线于垂直中心,
    样式 solid/wavy/double, 可旋转. 单独 layer 画 → 旋转 → 居中贴 box 中心 (跟文字字段一致)."""
    import math
    if not line:
        return
    style = line.get('style', 'solid') or 'solid'
    color = _hex_to_rgb(line.get('color', '#FFFFFF'))
    thick = max(1, int(line.get('thickness', 8) or 8))
    rotation = float(line.get('rotation') or 0)
    bx = int(line.get('x', 0)); by = int(line.get('y', 0))
    bw = int(line.get('w', 200)); bh = int(line.get('h', 40))
    if bw < 1:
        return

    amp = thick * 1.4 if style == 'wavy' else 0
    gap = thick * 2 if style == 'double' else 0
    pad = int(thick * 2 + amp + gap + 6)
    lw = bw + pad * 2
    lh = bh + pad * 2
    layer = Image.new('RGBA', (lw, lh), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cy = lh / 2.0          # 线画在 layer 垂直中心 (= box 垂直中心)
    x0, x1 = float(pad), float(pad + bw)

    if style == 'wavy':
        period = max(12.0, thick * 5.0)
        pts = []
        x = x0
        while x <= x1:
            pts.append((x, cy + amp * math.sin((x - x0) / period * 2 * math.pi)))
            x += 2
        if len(pts) > 1:
            d.line(pts, fill=color, width=thick, joint='curve')
    elif style == 'double':
        d.line([(x0, cy - gap / 2), (x1, cy - gap / 2)], fill=color, width=thick)
        d.line([(x0, cy + gap / 2), (x1, cy + gap / 2)], fill=color, width=thick)
    else:  # solid
        d.line([(x0, cy), (x1, cy)], fill=color, width=thick)

    if abs(rotation) > 0.01:
        layer = layer.rotate(-rotation, expand=True, resample=Image.BICUBIC)   # CSS+ → PIL 取负
    box_cx = bx + bw // 2
    box_cy = by + bh // 2
    img.alpha_composite(layer, (box_cx - layer.width // 2, box_cy - layer.height // 2))


def _warp_nontrivial(warp):
    """text_warp 是否有效且非全 0 (4 个 [dx,dy] 角偏移)."""
    if not warp or len(warp) != 4:
        return False
    for p in warp:
        if not p or len(p) < 2:
            continue
        if abs(p[0]) > 0.005 or abs(p[1]) > 0.005:
            return True
    return False


def _find_coeffs(pa, pb):
    """投影变换系数: output 的 pa 四角 → input 的 pb 四角 (给 Image.transform PERSPECTIVE).
    纯 Python 高斯消元 (部分主元), 不依赖 numpy —— 云上 venv 没 numpy. 跟前端 coverWarp.ts 同算法."""
    A = []
    b = []
    for (x, y), (X, Y) in zip(pa, pb):
        A.append([x, y, 1, 0, 0, 0, -X * x, -X * y]); b.append(X)
        A.append([0, 0, 0, x, y, 1, -Y * x, -Y * y]); b.append(Y)
    n = 8
    for col in range(n):
        piv = max(range(col, n), key=lambda r: abs(A[r][col]))
        if abs(A[piv][col]) < 1e-9:
            raise ValueError('singular matrix')
        A[col], A[piv] = A[piv], A[col]
        b[col], b[piv] = b[piv], b[col]
        d = A[col][col]
        for r in range(n):
            if r == col:
                continue
            fct = A[r][col] / d
            for c in range(col, n):
                A[r][c] -= fct * A[col][c]
            b[r] -= fct * b[col]
    return [b[i] / A[i][i] for i in range(n)]


def _apply_box_warp(layer, warp, box_w, box_h, margin):
    """按 box 框把文字透视 warp 成任意四边形. layer = 紧致文字层 (带 margin, 含阴影/下划线).
    做法: 建够大画布 → 文字层居中贴入 → 对 box 区域 4 角做 src→dst 透视 (文字随之变形).
    text_warp[i] = [dx,dy] 角偏移, 单位 = box(w,h) 比例; 角顺序 TL,TR,BR,BL."""
    pad = int(margin + max(box_w, box_h) * 0.4)     # 留够余量, 角往外拖也不裁
    cw, ch = int(box_w + pad * 2), int(box_h + pad * 2)
    canvas = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
    canvas.alpha_composite(layer, ((cw - layer.width) // 2, (ch - layer.height) // 2))
    bx0, by0, bx1, by1 = pad, pad, pad + box_w, pad + box_h
    base = [(bx0, by0), (bx1, by0), (bx1, by1), (bx0, by1)]   # box 区域 TL,TR,BR,BL
    dst = [(base[i][0] + (warp[i][0] or 0) * box_w, base[i][1] + (warp[i][1] or 0) * box_h) for i in range(4)]
    try:
        coeffs = _find_coeffs(dst, base)            # output(dst 四边形) → input(base 矩形)
        return canvas.transform((cw, ch), Image.PERSPECTIVE, coeffs, resample=Image.BICUBIC)
    except Exception as e:
        print(f"[cover] 自由变形 warp 失败, 跳过: {e}", flush=True)
        return canvas


def _measure_text(draw: ImageDraw.ImageDraw, text: str, font) -> int:
    """量文本宽度. 跨 PIL 版本"""
    bbox = draw.textbbox((0, 0), text, font=font)
    return bbox[2] - bbox[0]


# ============== 人物图按 fit_mode 缩放/裁剪 ==============

def _fit_person(person_img: Image.Image, slot: dict) -> Image.Image:
    """把人物图 (透明 PNG) 按 fit_mode 调整到 slot 大小"""
    if person_img.mode != 'RGBA':
        person_img = person_img.convert('RGBA')

    slot_w = int(slot['w']); slot_h = int(slot['h'])
    fit_mode = slot.get('fit_mode', 'cover')

    src_ratio = person_img.width / person_img.height
    tgt_ratio = slot_w / slot_h

    if fit_mode == 'cover':
        # 短边填满, 多余裁掉
        if src_ratio > tgt_ratio:
            # 太宽, 按高度填满, 左右裁
            new_h = slot_h
            new_w = int(slot_h * src_ratio)
            resized = person_img.resize((new_w, new_h), Image.LANCZOS)
            x = (new_w - slot_w) // 2
            return resized.crop((x, 0, x + slot_w, slot_h))
        else:
            new_w = slot_w
            new_h = int(slot_w / src_ratio)
            resized = person_img.resize((new_w, new_h), Image.LANCZOS)
            y = (new_h - slot_h) // 2
            return resized.crop((0, y, slot_w, y + slot_h))
    else:
        # contain: 长边对齐, 留透明边
        if src_ratio > tgt_ratio:
            new_w = slot_w
            new_h = int(slot_w / src_ratio)
        else:
            new_h = slot_h
            new_w = int(slot_h * src_ratio)
        resized = person_img.resize((new_w, new_h), Image.LANCZOS)
        result = Image.new('RGBA', (slot_w, slot_h), (0, 0, 0, 0))
        result.paste(resized, ((slot_w - new_w) // 2, (slot_h - new_h) // 2), resized)
        return result


# ============== 主合成函数 ==============

def render_cover(
    bg_path: str,
    text_fields: list,
    user_texts: dict,
    person_slot: Optional[dict] = None,
    person_png_path: Optional[str] = None,
    text_overrides: Optional[dict] = None,
    extra_fields: Optional[list] = None,
    hidden_labels: Optional[list] = None,
    line_fields: Optional[list] = None,
) -> Image.Image:
    """合成一张封面.

    参数:
    - bg_path: 底图 PNG 本地路径 (已从 OSS 下载)
    - text_fields: 模板里 admin 设的字段数组
    - user_texts: dict {field_label: user_input}
    - person_slot / person_png_path: 人物配置
    - text_overrides: 用户对 admin 字段的微调 (font/color/x/y/...)
    - extra_fields: 用户自己加的额外字段 (admin 没设的, 用户在画布上加的). 跟 admin 字段同结构,
                    自带 text 在 user_texts 里取 (label 不冲突)
    - hidden_labels: 用户隐藏的 admin 字段 label 列表 — 渲染时跳过这些

    返回: PIL Image (RGBA)"""
    bg = Image.open(bg_path).convert('RGBA')
    overrides = text_overrides or {}
    hidden = set(hidden_labels or [])

    # 1. 人物贴图准备成闭包 —— 延后到 "人物后的字" 画完再贴, 实现图层前后可调
    def _paste_person():
        if not (person_slot and person_png_path and os.path.exists(person_png_path)):
            return
        person_img = Image.open(person_png_path).convert('RGBA')
        # 描边跟模板走: 人物库存的是光图, 这里按模板 person_slot 配置加描边
        # (在抠图原尺寸上加再 fit, 跟 admin 示例人物的描边缩放一致)
        if person_slot.get('stroke_enabled') and int(person_slot.get('stroke_width') or 0) > 0:
            person_img2 = add_stroke_to_image(person_img, person_slot.get('stroke_color') or '#FFFFFF', int(person_slot.get('stroke_width')))
        else:
            person_img2 = person_img
        fitted = _fit_person(person_img2, person_slot)
        person_rotation = float(person_slot.get('rotation') or 0)
        if abs(person_rotation) > 0.01:
            rotated = fitted.rotate(-person_rotation, expand=True, resample=Image.BICUBIC)
            slot_cx = int(person_slot['x']) + int(person_slot['w']) // 2
            slot_cy = int(person_slot['y']) + int(person_slot['h']) // 2
            bg.alpha_composite(rotated, (slot_cx - rotated.width // 2, slot_cy - rotated.height // 2))
        else:
            bg.alpha_composite(fitted, (int(person_slot['x']), int(person_slot['y'])))

    # 2. 把 admin 字段 (没隐藏的) + 用户 extra 字段拼到一起
    all_fields = []
    for f in text_fields or []:
        if f.get('label') not in hidden:
            all_fields.append((f, True))   # (field, is_admin)
    for f in extra_fields or []:
        all_fields.append((f, False))

    # 3. 合并 override + 按 layer 分组 (behind=人物后 / front=人物前, 默认 front)
    behind_fields, front_fields = [], []   # 各装 (merged_field, user_text)
    for field, is_admin in all_fields:
        label = field.get('label', '')
        user_text = user_texts.get(label, field.get('placeholder', ''))
        if not user_text:
            continue

        if is_admin:
            # 合并: admin 字段配置 + 用户 override (override 优先)
            merged = dict(field)
            ovr = overrides.get(label) or {}
            if ovr.get('font_scale') and ovr.get('font_scale') != 1.0:
                base_size = merged.get('font_size', 80)
                merged['font_size'] = int(base_size * float(ovr['font_scale']))
            if ovr.get('font_size'):
                merged['font_size'] = int(ovr['font_size'])
            for k in ('x', 'y', 'w', 'h'):
                v = ovr.get(k)
                if v is not None:
                    merged[k] = int(v)
            for k in ('font_file', 'color', 'highlight_color', 'stroke_color', 'stroke_width', 'rotation', 'layer'):
                v = ovr.get(k)
                if v not in (None, ''):
                    merged[k] = v
        else:
            # extra 字段直接用 (前端传啥就是啥)
            merged = dict(field)

        (behind_fields if merged.get('layer') == 'behind' else front_fields).append((merged, user_text))

    # 3b. 装饰线条按 layer 分组 (跟文字同一套 front/behind)
    behind_lines, front_lines = [], []
    for ln in line_fields or []:
        (behind_lines if (ln or {}).get('layer') == 'behind' else front_lines).append(ln)

    # 4. 绘制顺序: 人物后的字+线 → 贴人物 → 人物前的字+线 (线画在同层文字之上)
    for merged, user_text in behind_fields:
        _draw_text_field(bg, merged, user_text)
    for ln in behind_lines:
        _draw_line_field(bg, ln)
    _paste_person()
    for merged, user_text in front_fields:
        _draw_text_field(bg, merged, user_text)
    for ln in front_lines:
        _draw_line_field(bg, ln)

    return bg
