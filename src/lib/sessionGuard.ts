// 严格单设备登录 — 全局 fetch 拦截器
//
// 后端 (windows-server/main.py: _user_id_from_request) 在校验 JWT 时, 会比较
// token.iat 跟 users.latest_login_iat. 一旦同账号在别处重新登录, latest_login_iat
// 被刷新, 老 token 的请求就会拿到 401 + detail 含 "session_kicked".
//
// 这里 monkey-patch window.fetch, 全局捕获这种 401, 弹 toast + 清 token + 跳 /login.
// 用这种方式而不是改每个 service, 因为 services/ 下有 10+ 文件各自 fetch, 维护成本大.

let kicked = false   // 防抖: 同一次 kick 别弹 N 个 toast

function showKickToast(msg: string) {
  // 简易 toast — 跟项目里其它 toast 风格保持一致 (固定右上, 4s 自消失)
  try {
    const id = '__monoi_kick_toast__'
    if (document.getElementById(id)) return
    const el = document.createElement('div')
    el.id = id
    el.textContent = msg
    el.style.cssText = `
      position: fixed; top: 24px; left: 50%; transform: translateX(-50%);
      z-index: 999999; padding: 12px 20px; border-radius: 8px;
      background: #1f2937; color: white; font-size: 14px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15); max-width: 360px;
      font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif;
    `
    document.body.appendChild(el)
    setTimeout(() => { el.remove() }, 4000)
  } catch { /* 极端环境降级 */ }
}

function handleKick(msg: string) {
  if (kicked) return
  kicked = true
  showKickToast(msg)
  try {
    localStorage.removeItem('monoi_token')
    localStorage.removeItem('monoi_username')
  } catch { /* localStorage 不可用 (隐私模式) */ }
  // 留 2s 让用户看到 toast 再跳
  setTimeout(() => {
    // 已经在 /login 就不重复跳
    if (!window.location.pathname.startsWith('/login')) {
      window.location.href = '/login?kicked=1'
    }
  }, 1500)
}

// Vercel 退役后, 前端在 OSS 静态托管, 没有 /api/proxy serverless 函数, 相对 /api/* 也无同源后端。
// 把所有相对 /api 请求重写成直连后端 (api.monoi.cn, 即 VITE_DIRECT_API_URL):
//   /api/proxy?path=<encoded>  →  <DIRECT_BASE> + 解码后的真实路径 (替代原 Vercel proxy 中转)
//   /api/xxx                   →  <DIRECT_BASE>/api/xxx
// 后端 main.py 自带这些真实接口; IP 转发由 Nginx X-Real-IP 处理。绝对 URL 不动。
const DIRECT_BASE = (import.meta as any).env?.VITE_DIRECT_API_URL || ''
function rewriteApiUrl(input: RequestInfo | URL): RequestInfo | URL {
  if (!DIRECT_BASE || typeof input !== 'string') return input
  if (input.startsWith('/api/proxy?path=')) {
    try { return DIRECT_BASE + decodeURIComponent(input.slice('/api/proxy?path='.length)) }
    catch { return DIRECT_BASE + input }
  }
  if (input.startsWith('/api/')) return DIRECT_BASE + input
  return input
}

export function installSessionGuard() {
  const orig = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    input = rewriteApiUrl(input)
    const res = await orig(input, init)
    if (res.status === 401) {
      // 克隆一下读 body, 别影响原 response 被业务代码消费
      try {
        const clone = res.clone()
        const ct = clone.headers.get('content-type') || ''
        let detail = ''
        if (ct.includes('application/json')) {
          const j = await clone.json().catch(() => null)
          detail = (j && (j.detail || j.error || j.message)) || ''
        } else {
          detail = await clone.text().catch(() => '')
        }
        if (typeof detail === 'string' && detail.includes('session_kicked')) {
          handleKick('你的账号在其他设备登录了, 请重新登录')
        }
      } catch { /* 解析失败就不处理 */ }
    }
    return res
  }
}
