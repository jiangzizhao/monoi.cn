"""一次性脚本: 扫 D:\\monoi-server\\fonts\\ 下所有 .ttf/.otf/.ttc, 转出对应 .woff2.

跑法:
    python migrate_fonts_to_woff2.py

依赖: pip install fonttools brotli
"""
import os
import sys
import glob

FONT_DIR = r'D:\monoi-server\fonts'


def main():
    try:
        from fontTools.ttLib import TTFont
    except ImportError:
        print('ERROR: 需要先装 fonttools + brotli\n  pip install fonttools brotli')
        sys.exit(1)

    if not os.path.isdir(FONT_DIR):
        print(f'ERROR: 字体目录不存在: {FONT_DIR}')
        sys.exit(1)

    patterns = ['*.ttf', '*.otf', '*.ttc', '*.TTF', '*.OTF', '*.TTC']
    files = []
    for p in patterns:
        files.extend(glob.glob(os.path.join(FONT_DIR, p)))

    if not files:
        print('没找到任何 ttf/otf/ttc 文件')
        return

    print(f'共 {len(files)} 个字体待转')
    ok = 0
    fail = 0
    skip = 0
    for src in files:
        stem, _ = os.path.splitext(src)
        dst = stem + '.woff2'
        if os.path.exists(dst):
            print(f'  [skip] 已存在 woff2: {os.path.basename(dst)}')
            skip += 1
            continue
        try:
            font = TTFont(src)
            font.flavor = 'woff2'
            font.save(dst)
            print(f'  [ok]   {os.path.basename(src)} → {os.path.basename(dst)}')
            ok += 1
        except Exception as e:
            print(f'  [fail] {os.path.basename(src)}: {e}')
            fail += 1

    print(f'\n完成. 成功 {ok}, 失败 {fail}, 跳过 {skip}')
    if fail > 0:
        print('失败的字体浏览器也加载不了, 建议 admin 删了重传干净的版本')


if __name__ == '__main__':
    main()
