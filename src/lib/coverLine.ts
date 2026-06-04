// 封面「装饰线条」预览样式 (后台编辑器 + 用户选模板 共用).
// 一个绝对定位、横贯盒宽、垂直居中的元素. 与后端 cover_compositor._draw_line_field 对齐.
// thicknessCss = 已换算到目标单位的线粗 (Admin.tsx 用 px, TemplateCoverPicker 用 cqw).
import type { CSSProperties } from 'react'

const BRUSH_URL = '/cover-brush.png'   // 真实笔刷图 (public/), 跟后端同一张

export function lineStyle(
  style: string | undefined,
  color: string,
  thicknessCss: string,
): CSSProperties {
  // 笔刷: 填满整个 box, 用笔刷图当 mask + 纯色背景 → 着色笔刷 (跟后端 _draw_line_field brush 一致)
  if (style === 'brush') {
    return {
      position: 'absolute', inset: 0, pointerEvents: 'none',
      backgroundColor: color,
      WebkitMaskImage: `url("${BRUSH_URL}")`, maskImage: `url("${BRUSH_URL}")`,
      WebkitMaskSize: '100% 100%', maskSize: '100% 100%',
      WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat',
    }
  }
  const base: CSSProperties = {
    position: 'absolute', left: 0, top: '50%', width: '100%',
    transform: 'translateY(-50%)', pointerEvents: 'none',
  }
  if (style === 'wavy') {
    const svg = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='12' viewBox='0 0 24 12' preserveAspectRatio='none'%3E%3Cpath d='M0 6 Q6 1 12 6 T24 6' fill='none' stroke='${encodeURIComponent(color)}' stroke-width='2'/%3E%3C/svg%3E")`
    return { ...base, height: `calc(${thicknessCss} * 2.6)`, backgroundImage: svg, backgroundRepeat: 'repeat-x', backgroundSize: 'auto 100%' }
  }
  if (style === 'double') {
    return { ...base, height: `calc(${thicknessCss} * 3)`, borderTop: `${thicknessCss} solid ${color}`, borderBottom: `${thicknessCss} solid ${color}` }
  }
  return { ...base, height: thicknessCss, background: color }   // solid
}
