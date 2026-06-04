// 封面「梯形/不规则梯形」变型预览 — 与后端 cover_compositor._apply_trapezoid 同一套角点.
// 后端用 PIL 透视 warp; 前端用 CSS matrix3d (2D 单应) 把文字元素 warp 成同样的梯形.
// amount -100..100 (>0 上窄下宽 /\, <0 上宽下窄 \/); skew -100..100 (左右不对称 = 不规则).

// 梯形目标四角 (TL, TR, BR, BL), 单位 px, 跟后端 _trapezoid_corners 完全一致.
export function trapezoidCorners(W: number, H: number, amount: number, skew: number): [number, number][] {
  const maxI = 0.45
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
  const a = Math.max(-1, Math.min(1, amount / 100))
  const k = Math.max(-1, Math.min(1, skew / 100))
  let tL = 0, tR = 0, bL = 0, bR = 0
  if (a >= 0) { tL = clamp01(a * (1 - k)) * maxI; tR = clamp01(a * (1 + k)) * maxI }
  else { const aa = -a; bL = clamp01(aa * (1 - k)) * maxI; bR = clamp01(aa * (1 + k)) * maxI }
  return [[tL * W, 0], [W - tR * W, 0], [W - bR * W, H], [bL * W, H]]
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

// 返回可直接塞 style.transform 的 matrix3d 字符串 (transform-origin 必须 0 0); 无变型返 null
export function trapezoidMatrix3d(amount: number, skew: number, W: number, H: number): string | null {
  if ((Math.abs(amount) < 1 && Math.abs(skew) < 1) || W < 2 || H < 2) return null
  const src: [number, number][] = [[0, 0], [W, 0], [W, H], [0, H]]
  const dst = trapezoidCorners(W, H, amount, skew)
  const h = solveHomography(src, dst)
  if (!h) return null
  const [a, b, c, d, e, f, g, hh] = h
  // 2D 单应 → CSS matrix3d (列主序): x'=(a x+b y+c)/(g x+h y+1), y'=(d x+e y+f)/(...)
  return `matrix3d(${a},${d},0,${g}, ${b},${e},0,${hh}, 0,0,1,0, ${c},${f},0,1)`
}
