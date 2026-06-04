// 文字背景底色块: 圆角方块 / 狂野笔刷. 预览样式, 跟后端 cover_compositor 一致.
// 笔刷用「确定性多边形」(跟后端 _brush_polygon 同一套公式) 做成 SVG 背景图 → 预览=出图, 且不裁文字.
import type { CSSProperties } from 'react'

function brushPoints(k = 44, amp = 0.24, e = 0.10): [number, number][] {
  const ramp = (x: number) => Math.max(0, Math.min(1, Math.min(x, 1 - x) / e))
  const c01 = (v: number) => Math.max(0, Math.min(1, v))
  const top: [number, number][] = []
  const bot: [number, number][] = []
  for (let i = 0; i <= k; i++) {
    const x = i / k, t = ramp(x), hh = 0.5 * (0.30 + 0.70 * t)
    const wt = 0.40 * Math.sin(x * 11 + 0.7) + 0.32 * Math.sin(x * 29 + 2.1) + 0.28 * Math.sin(x * 57 + 1.1)
    const wb = 0.40 * Math.sin(x * 9 + 3.5) + 0.32 * Math.sin(x * 31 + 0.9) + 0.28 * Math.sin(x * 61 + 2.7)
    top.push([x, c01(0.5 - hh + amp * wt * t)])
    bot.push([x, c01(0.5 + hh + amp * wb * t)])
  }
  return top.concat(bot.reverse())
}

// 笔刷形状的 SVG data-uri (填 color, preserveAspectRatio none → 拉伸贴合元素). vertical 时转置成竖向.
function brushBgImage(color: string, vertical: boolean): string {
  const ptsStr = brushPoints().map(([x, y]) => {
    const px = vertical ? y : x, py = vertical ? x : y
    return `${(px * 100).toFixed(1)},${(py * 100).toFixed(1)}`
  }).join(' ')
  const svg = `%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'%3E%3Cpolygon points='${ptsStr}' fill='${encodeURIComponent(color)}'/%3E%3C/svg%3E`
  return `url("data:image/svg+xml,${svg}")`
}

// 给文字元素加背景底色块的 CSS (没 bg_color 返空对象). 文字在其上, 不被裁.
export function textBgStyle(f: {
  bg_color?: string | null
  bg_radius?: number
  bg_style?: string
  vertical?: boolean
}): CSSProperties {
  if (!f.bg_color) return {}
  if (f.bg_style === 'brush') {
    return {
      backgroundImage: brushBgImage(f.bg_color, !!f.vertical),
      backgroundSize: '100% 100%',
      backgroundRepeat: 'no-repeat',
      padding: '0.16em 0.28em',
    }
  }
  return {
    backgroundColor: f.bg_color,
    padding: '0.16em 0.28em',
    borderRadius: `${0.66 * (f.bg_radius ?? 30) / 100}em`,
  }
}
