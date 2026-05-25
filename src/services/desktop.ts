// 桌面版下载链接 — 从后端 desktop_release.json 拿
// 用户点 '下载桌面版' 时调一次, 返当前最新版 .exe URL.

const directBase = (import.meta as any).env?.VITE_DIRECT_API_URL || 'https://monoi.nat100.top'

export interface DesktopLatest {
  available: boolean
  version?: string
  exe_url?: string
  size_mb?: number
  released_at?: string
  notes?: string
  detail?: string       // available=false 时的原因
}

export async function fetchDesktopLatest(): Promise<DesktopLatest> {
  try {
    const r = await fetch(directBase + '/api/desktop/latest')
    if (!r.ok) return { available: false, detail: `HTTP ${r.status}` }
    return await r.json()
  } catch (e: any) {
    return { available: false, detail: e?.message || '网络错误' }
  }
}
