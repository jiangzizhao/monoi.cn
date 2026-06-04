// 封面「弧形/扇形」预览布局 — 与后端 cover_compositor._draw_arc_field 同一套公式.
// 逐字沿半径 R 的圆弧摆放 (弧长 = 文字总宽), 每字切向旋转.
// arcDeg>0 上弧 ∩ (顶点在上, 两端下沉); <0 下弧 ∪.
// 注: 预览用「等宽近似」(CJK≈字号, ASCII≈0.55字号) 估字宽; 真出图后端按实际字宽,
//     纯中文几乎一致, 含拉丁会略有偏差 (预览参考用).

export interface ArcChar {
  ch: string
  color: string
  x: number    // 相对包围盒中心的 px 偏移
  y: number
  rot: number  // deg, CSS 顺时针为正
}

export function arcLayout(
  chars: { ch: string; color: string }[],
  arcDeg: number,
  fontPx: number,
): ArcChar[] {
  const A = (Math.min(Math.abs(arcDeg), 340) * Math.PI) / 180
  if (A < 0.0001 || chars.length === 0) {
    return chars.map((c) => ({ ...c, x: 0, y: 0, rot: 0 }))
  }
  const d = arcDeg >= 0 ? 1 : -1
  const widths = chars.map((c) => (/^[\x00-\xff]$/.test(c.ch) ? fontPx * 0.55 : fontPx))
  const W = widths.reduce((a, b) => a + b, 0) || 1
  const R = W / A
  let cum = 0
  const out: ArcChar[] = chars.map((c, i) => {
    const theta = ((cum + widths[i] / 2) / W - 0.5) * A
    cum += widths[i]
    return {
      ...c,
      x: R * Math.sin(theta),
      y: d * R * (1 - Math.cos(theta)),
      rot: (d * theta * 180) / Math.PI,
    }
  })
  // 居中归一: 把字心包围盒中心移到原点 (后端是把整层居中贴到 box 中心)
  const xs = out.map((o) => o.x)
  const ys = out.map((o) => o.y)
  const mx = (Math.min(...xs) + Math.max(...xs)) / 2
  const my = (Math.min(...ys) + Math.max(...ys)) / 2
  out.forEach((o) => {
    o.x -= mx
    o.y -= my
  })
  return out
}

// 把 parseSegments 的分段拍平成逐字 (含各自颜色)
export function segmentsToArcChars(
  segs: { text: string; highlight: boolean }[],
  color: string,
  highlightColor: string,
): { ch: string; color: string }[] {
  const chars: { ch: string; color: string }[] = []
  for (const s of segs) {
    for (const ch of [...s.text]) {
      if (ch === '\r' || ch === '\n' || ch === '\t') continue
      chars.push({ ch, color: s.highlight ? highlightColor : color })
    }
  }
  return chars
}
