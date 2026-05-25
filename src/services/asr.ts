// 我的闪说 (ASR 转写历史) API 客户端
import { getToken } from '../lib/auth'

const directBase = (import.meta as any).env?.VITE_DIRECT_API_URL || 'https://monoi.nat100.top'

function headers() {
  const token = getToken()
  if (!token) throw new Error('未登录')
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

export interface MyAsrRecord {
  id: number
  text: string
  language: string         // zh / en
  duration_sec: number
  title: string
  created_at: number
}

export async function listMyAsrRecords(): Promise<{ records: MyAsrRecord[] }> {
  const r = await fetch(directBase + '/api/asr/records', { headers: headers() })
  const d = await r.json()
  if (!r.ok) throw new Error(d.detail || d.error || `list failed ${r.status}`)
  return d
}

export async function saveMyAsrRecord(req: {
  text: string
  language?: string
  duration_sec?: number
  title?: string
}): Promise<{ success: boolean; id: number }> {
  const r = await fetch(directBase + '/api/asr/records', {
    method: 'POST', headers: headers(), body: JSON.stringify(req),
  })
  const d = await r.json()
  if (!r.ok) throw new Error(d.detail || d.error || `save failed ${r.status}`)
  return d
}

export async function deleteMyAsrRecord(id: number): Promise<{ success: boolean }> {
  const r = await fetch(directBase + `/api/asr/records/${id}`, {
    method: 'DELETE', headers: headers(),
  })
  const d = await r.json()
  if (!r.ok) throw new Error(d.detail || d.error || `delete failed ${r.status}`)
  return d
}
