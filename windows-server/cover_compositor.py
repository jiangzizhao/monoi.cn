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

_FONT_DIR_PROJECT = r'D:\monoi-server\fonts'
_FONT_FALLBACK = 'C:/Windows/Fonts/msyhbd.ttc'


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


def remove_bg_with_stroke(
    input_bytes: bytes,
    stroke_enabled: bool = True,
    stroke_color: str = '#FFFFFF',
    stroke_width: int = 12,
) -> bytes:
    """rembg 抠图 → (可选) 加描边 → 返透明 PNG bytes.

    描边实现: alpha 通道形态学膨胀 → 拿膨胀后比原 alpha 多出的环 → 染色叠到底."""
    from rembg import remove

    # 1. rembg 抠图 (输入任意格式, 输出 PNG bytes with alpha)
    output_bytes = remove(input_bytes, session=_get_rembg_session())
    img = Image.open(BytesIO(output_bytes)).convert('RGBA')

    if not stroke_enabled or stroke_width <= 0:
        out = BytesIO()
        img.save(out, format='PNG')
        return out.getvalue()

    # 2. 加描边: 把 alpha 通道用 MaxFilter 膨胀, 拿膨胀外圈
    alpha = img.split()[-1]
    # MaxFilter 一次膨胀 ~ filter_size//2 像素, 多次迭代
    grown = alpha
    for _ in range(stroke_width):
        grown = grown.filter(ImageFilter.MaxFilter(3))

    # 描边色填充 — 拿 grown 比 alpha 多的区域 (差集)
    # 描边图层: grown 大小, 全是 stroke_color, 用 grown 作 alpha
    stroke_rgb = _hex_to_rgb(stroke_color)
    stroke_layer = Image.new('RGBA', img.size, stroke_rgb + (0,))
    stroke_layer.putalpha(grown)

    # 把原图叠在描边层上 (原图盖在中心, 描边只剩外圈)
    final = Image.alpha_composite(stroke_layer, img)

    out = BytesIO()
    final.save(out, format='PNG')
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
    支持 {} 多色, 描边, 阴影, 对齐, 自动缩字号. 单行渲染 (不自动换行, 用户控制长度)."""
    draw = ImageDraw.Draw(img)

    font_file = field.get('font_file', 'SourceHanSansCN-Heavy.otf')
    font_size = int(field.get('font_size', 80))
    color_rgb = _hex_to_rgb(field.get('color', '#FFFFFF'))
    highlight_rgb = _hex_to_rgb(field.get('highlight_color') or field.get('color', '#FFFFFF'))
    stroke_color = field.get('stroke_color')
    stroke_width = int(field.get('stroke_width', 0))
    shadow_color = field.get('shadow_color')
    shadow_offset_x = int(field.get('shadow_offset_x', 0))
    shadow_offset_y = int(field.get('shadow_offset_y', 0))
    shadow_blur = int(field.get('shadow_blur', 0))
    align = field.get('align', 'left')

    box_x = int(field.get('x', 0))
    box_y = int(field.get('y', 0))
    box_w = int(field.get('w', 200))
    box_h = int(field.get('h', 80))

    segments = _parse_segments(user_text)
    if not segments:
        return

    # 自动缩字号: 测量总宽, 超过 box_w 就缩字号
    cur_size = font_size
    while cur_size > 12:
        font = _load_font(font_file, cur_size)
        total_w = sum(_measure_text(draw, t, font) for t, _ in segments)
        if total_w <= box_w:
            break
        cur_size = int(cur_size * 0.92)

    font = _load_font(font_file, cur_size)
    total_w = sum(_measure_text(draw, t, font) for t, _ in segments)

    # 起始 X (对齐)
    if align == 'center':
        start_x = box_x + (box_w - total_w) // 2
    elif align == 'right':
        start_x = box_x + box_w - total_w
    else:
        start_x = box_x

    # 起始 Y — 跟随字号居中到 box 里
    asc = font.getmetrics()[0]
    start_y = box_y + (box_h - asc) // 2

    # 每段独立画
    cur_x = start_x
    for seg_text, is_highlight in segments:
        if not seg_text:
            continue
        fill = highlight_rgb if is_highlight else color_rgb

        # 阴影 (先画)
        if shadow_color and (shadow_offset_x or shadow_offset_y):
            shadow_rgb = _hex_to_rgb(shadow_color)
            if shadow_blur > 0:
                # 阴影模糊: 单独画到临时层 → 高斯模糊 → 叠回
                tmp = Image.new('RGBA', img.size, (0, 0, 0, 0))
                tmp_draw = ImageDraw.Draw(tmp)
                tmp_draw.text((cur_x + shadow_offset_x, start_y + shadow_offset_y),
                              seg_text, font=font, fill=shadow_rgb + (180,))
                tmp = tmp.filter(ImageFilter.GaussianBlur(shadow_blur))
                img.alpha_composite(tmp)
            else:
                draw.text((cur_x + shadow_offset_x, start_y + shadow_offset_y),
                          seg_text, font=font, fill=shadow_rgb)

        # 描边 + 文字
        if stroke_color and stroke_width > 0:
            stroke_rgb = _hex_to_rgb(stroke_color)
            draw.text((cur_x, start_y), seg_text, font=font, fill=fill,
                      stroke_width=stroke_width, stroke_fill=stroke_rgb)
        else:
            draw.text((cur_x, start_y), seg_text, font=font, fill=fill)

        cur_x += _measure_text(draw, seg_text, font)


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
) -> Image.Image:
    """合成一张封面.

    参数:
    - bg_path: 底图 PNG 本地路径 (已从 OSS 下载)
    - text_fields: 模板里的 text_fields 数组 [{label, x, y, w, h, font_file, ...}, ...]
    - user_texts: dict {field_label: user_input}, 例 {'主标题': '封面{邪修}', '副标题': '太香啦'}
    - person_slot: 模板的人物坑配置 (有人物的话), 例 {x, y, w, h, stroke_*, fit_mode}
    - person_png_path: 用户人物图 (已经 rembg 抠完 + 描边的透明 PNG) 本地路径
    - text_overrides: dict {field_label: {font_file?, font_size?, font_scale?, color?,
                                           highlight_color?, stroke_color?, stroke_width?}}
                      用户在前端微调的值, 覆盖 admin 默认. font_scale 是字号倍数 (admin 设的 × scale)

    返回: PIL Image (RGBA), 调用方自己 .save() 到 OSS"""
    bg = Image.open(bg_path).convert('RGBA')
    overrides = text_overrides or {}

    # 1. 人物坑 (在文字之前画, 文字盖在人物上)
    if person_slot and person_png_path and os.path.exists(person_png_path):
        person_img = Image.open(person_png_path).convert('RGBA')
        fitted = _fit_person(person_img, person_slot)
        bg.alpha_composite(fitted, (int(person_slot['x']), int(person_slot['y'])))

    # 2. 文字字段 — 合并 admin 默认 + 用户 override
    for field in text_fields:
        label = field.get('label', '')
        user_text = user_texts.get(label, field.get('placeholder', ''))
        if not user_text:
            continue

        # 合并: admin 字段配置 + 用户 override (override 优先)
        merged = dict(field)
        ovr = overrides.get(label) or {}
        # 字号: 支持 font_scale 倍数 (前端 slider 用) 和 font_size 直接覆盖
        if ovr.get('font_scale') and ovr.get('font_scale') != 1.0:
            base_size = merged.get('font_size', 80)
            merged['font_size'] = int(base_size * float(ovr['font_scale']))
        if ovr.get('font_size'):
            merged['font_size'] = int(ovr['font_size'])
        # 其他直接覆盖 (None / 空字符串跳过, 保留 admin 默认)
        for k in ('font_file', 'color', 'highlight_color', 'stroke_color', 'stroke_width'):
            v = ovr.get(k)
            if v not in (None, ''):
                merged[k] = v

        _draw_text_field(bg, merged, user_text)

    return bg
