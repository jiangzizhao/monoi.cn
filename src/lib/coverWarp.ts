// 封面「自由变形」(透视) — 拖 box 四角把文字 warp 成任意四边形 (梯形/平行四边形/透视…).
// text_warp = [[dx,dy]×4] 角偏移 (TL, TR, BR, BL), 单位 = box(w,h) 的比例. null/全0 = 不变形.
// 后端 cover_compositor._apply_box_warp 用同一套角点做 PIL 透视; 这里给预览算 CSS matrix3d.

export type Warp = number[][]
export const ZERO_WARP: Warp = [[0, 0], [0, 0], [0, 0], [0, 0]]

export function warpNontrivial(warp?: number[][] | null): boolean {
  if (!warp || warp.length !== 4) return false
  return warp.some((p) => p && (Math.abs(p[0] || 0) > 0.005 || Math.abs(p[1] || 0) > 0.005))
}

// 解 src→dst 的 2D 单应 (8x8 高斯消元), 返 [a,b,c,d,e,f,g,h]; 退化返 null
function solveHomography(src: [number, number][], dst: [number, number][]): number[] | null {
  const A: number[][] = []
  const b: number[] = []
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [X, Y] = dst[i]
    A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]); b.push(X)
    A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]); b.push(Y)
  }
  for (let col = 0; col < 8; col++) {
    let piv = col
    for (let r = col + 1; r < 8; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r
    ;[A[col], A[piv]] = [A[piv], A[col]];[b[col], b[piv]] = [b[piv], b[col]]
    const d = A[col][col]
    if (Math.abs(d) < 1e-9) return null
    for (let r = 0; r < 8; r++) {
      if (r === col) continue
      const fct = A[r][col] / d
      for (let c = col; c < 8; c++) A[r][c] -= fct * A[col][c]
      b[r] -= fct * b[col]
    }
  }
  return b.map((v, i) => v / A[i][i])
}

// box (W×H px) + 4角偏移 → CSS matrix3d 字符串 (transform-origin 必须 0 0); 无变形返 null
export function warpMatrix3d(warp: number[][] | null | undefined, W: number, H: number): string | null {
  if (!warpNontrivial(warp) || W < 2 || H < 2) return null
  const w = warp as number[][]
  const src: [number, number][] = [[0, 0], [W, 0], [W, H], [0, H]]
  const dst: [number, number][] = [
    [(w[0][0] || 0) * W, (w[0][1] || 0) * H],
    [W + (w[1][0] || 0) * W, (w[1][1] || 0) * H],
    [W + (w[2][0] || 0) * W, H + (w[2][1] || 0) * H],
    [(w[3][0] || 0) * W, H + (w[3][1] || 0) * H],
  ]
  const h = solveHomography(src, dst)
  if (!h) return null
  const [a, b, c, d, e, f, g, hh] = h
  return `matrix3d(${a},${d},0,${g}, ${b},${e},0,${hh}, 0,0,1,0, ${c},${f},0,1)`
}

// 预设形状 → text_warp (角偏移, box 比例). 给"快速起步", 之后用户可拖角微调.
export function presetWarp(kind: 'trap' | 'invtrap' | 'irregular'): Warp {
  const i = 0.3
  if (kind === 'trap') return [[i, 0], [-i, 0], [0, 0], [0, 0]]        // 上窄下宽 /\
  if (kind === 'invtrap') return [[0, 0], [0, 0], [-i, 0], [i, 0]]     // 上宽下窄 \/
  return [[0.34, 0.06], [-0.06, 0], [0.08, 0], [0, 0.03]]             // 不规则 (斜)
}
