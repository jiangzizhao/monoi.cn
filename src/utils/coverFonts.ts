// 封面字体加载 + 多色解析 — admin 编辑器和用户端 TemplateCoverPicker 共用

const directBase = (import.meta as any).env?.VITE_DIRECT_API_URL || 'https://monoi.nat100.top'

// 全局: 已经加载过的字体 family 缓存, 避免重复 fetch + add
const _loadedFonts = new Set<string>()

/** 字体文件名 → CSS font-family. 把 .ttf/.otf/.ttc 去掉 */
export function fontFamily(file: string): string {
  return file.replace(/\.(ttf|otf|ttc)$/i, '')
}

/** 动态加载字体到浏览器, 让 CSS font-family 能用 */
export async function loadFont(file: string) {
  const family = fontFamily(file)
  if (_loadedFonts.has(family)) return
  _loadedFonts.add(family)
  try {
    const url = `${directBase}/api/voice/cover-font-file/${encodeURIComponent(file)}`
    const ff = new FontFace(family, `url("${url}")`)
    await ff.load()
    ;(document as any).fonts.add(ff)
  } catch (e) {
    console.warn('字体加载失败', file, e)
    _loadedFonts.delete(family)        // 失败 retry 时再试
  }
}

/** 把 "封面{邪修}" 拆成段, 每段标记是否高亮 */
export function parseSegments(text: string): { text: string; highlight: boolean }[] {
  const segs: { text: string; highlight: boolean }[] = []
  const re = /\{([^{}]*)\}/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) segs.push({ text: text.slice(last, m.index), highlight: false })
    segs.push({ text: m[1], highlight: true })
    last = m.index + m[0].length
  }
  if (last < text.length) segs.push({ text: text.slice(last), highlight: false })
  return segs
}
