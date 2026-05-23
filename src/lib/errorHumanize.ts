// errorHumanize — 把浏览器 / 网络层的"程序员英语" 错误翻成用户能看懂的中文.
// 主要场景: NATAPP 内网穿透断 / 后端服务挂 / OSS 上传超时 / Demucs/Whisper crash.
//
// 用法:
//   } catch (e: any) {
//     setError(humanizeNetworkError(e))
//   }

export function humanizeNetworkError(err: unknown): string {
  const raw = String((err as any)?.message || err || '').trim()
  if (!raw) return '出错了, 请重试'

  // 浏览器原生网络错 — Chrome/Edge/Firefox 都是这条
  if (raw.includes('Failed to fetch') || raw.includes('NetworkError') || raw.includes('Load failed')) {
    return '网络连接失败 — 服务器可能不在线 (NATAPP 断了 / 后端服务挂了). 等 10 秒重试; 还不行请联系客服'
  }

  // AbortController 主动取消, 一般来自用户点"取消"
  if (raw.includes('aborted') || raw.includes('AbortError')) {
    return '已取消'
  }

  // CORS / 跨域
  if (raw.includes('CORS') || raw.includes('cross-origin')) {
    return '跨域请求被拒 — 后端 CORS 配置异常, 请联系客服'
  }

  // HTTP 状态码常见错 (服务端返了但是非 200)
  // 402 = 积分不足, 后端已经给了 detail, 这里只兜底
  if (raw.match(/HTTP\s*4\d\d/i) || raw.match(/\(4\d\d\)/)) {
    return raw  // 4xx 通常后端已经给了人话 detail
  }
  if (raw.match(/HTTP\s*5\d\d/i) || raw.match(/\(5\d\d\)/)) {
    return '服务器内部错 — 请稍后重试; 持续报错请联系客服'
  }

  // 超时
  if (raw.includes('timeout') || raw.includes('超时')) {
    return '请求超时 — 可能后端处理太慢, 等 30 秒重试'
  }

  // 兜底 — 原文显示
  return raw
}
