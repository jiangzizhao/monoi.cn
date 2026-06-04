// 封面下划线的预览样式 (后台编辑器 + 用户选模板 共用).
// 用定位元素 + em 单位 → 能体现长度(text-decoration 没法改长度), 且在 px 缩放和 cqw 缩放两种预览里都自适应字号.
import type { CSSProperties } from 'react'

export function underlineStyle(f: {
  underline_style?: string | null
  underline_color?: string | null
  color: string
  underline_length_pct?: number | null
}): CSSProperties | null {
  const style = f.underline_style
  if (!style || style === 'none') return null
  const c = f.underline_color || f.color
  const len = f.underline_length_pct ?? 100
  const base: CSSProperties = {
    position: 'absolute', left: '50%', bottom: '-0.04em',
    transform: 'translateX(-50%)', width: `${len}%`, pointerEvents: 'none',
  }
  if (style === 'wavy') {
    const svg = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='12' viewBox='0 0 24 12' preserveAspectRatio='none'%3E%3Cpath d='M0 6 Q6 1 12 6 T24 6' fill='none' stroke='${encodeURIComponent(c)}' stroke-width='2'/%3E%3C/svg%3E")`
    return { ...base, height: '0.18em', backgroundImage: svg, backgroundRepeat: 'repeat-x', backgroundSize: 'auto 100%' }
  }
  if (style === 'double') return { ...base, height: 0, borderBottom: `0.1em double ${c}` }
  return { ...base, height: '0.07em', background: c }   // solid
}
