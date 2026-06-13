// 个人素材库 API 客户端 — 列表 / 上传(直传OSS+登记) / 删除
import { getToken } from '../lib/auth'
import { uploadBlobToOss } from './recordings'

const directBase = (import.meta as any).env?.VITE_DIRECT_API_URL || 'https://monoi.nat100.top'

function headers() {
  const token = getToken()
  return { Authorization: `Bearer ${token || ''}`, 'Content-Type': 'application/json' }
}

export interface MyFootage {
  id: number
  oss_key: string
  url: string                  // 6h 签名 GET URL (预览/合成用)
  media_type: 'image' | 'video'
  name: string
  duration_seconds?: number
  file_size?: number
  created_at?: string
}

export async function listFootage(): Promise<{ items: MyFootage[]; count: number; max_count: number }> {
  const r = await fetch(directBase + '/api/footage-library', { headers: headers() })
  const d = await r.json()
  if (!r.ok) throw new Error(d.detail || d.error || `加载失败 ${r.status}`)
  return d
}

export async function deleteFootage(id: number): Promise<{ success: boolean }> {
  const r = await fetch(directBase + `/api/footage-library/${id}`, { method: 'DELETE', headers: headers() })
  const d = await r.json()
  if (!r.ok) throw new Error(d.detail || d.error || `删除失败 ${r.status}`)
  return d
}

function probeVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.onloadedmetadata = () => { URL.revokeObjectURL(v.src); resolve(v.duration || 0) }
    v.onerror = () => { URL.revokeObjectURL(v.src); reject(new Error('read fail')) }
    v.src = URL.createObjectURL(file)
  })
}

/** 上传一个素材(图片/视频): 前端先校验大小/时长 → 直传 OSS(user_footage 前缀) → 登记入库. */
export async function uploadFootage(file: File, onProgress?: (pct: number) => void): Promise<MyFootage> {
  const isImage = file.type.startsWith('image/')
  const isVideo = file.type.startsWith('video/')
  if (!isImage && !isVideo) throw new Error('只支持图片或视频素材')
  const limit = isImage ? 10 * 1024 * 1024 : 50 * 1024 * 1024
  if (file.size > limit) throw new Error(isImage ? '图片最大 10MB' : '视频最大 50MB, 请压缩或剪短')
  let duration: number | undefined
  if (isVideo) {
    try { duration = await probeVideoDuration(file) } catch { /* 读不到放过, 后端兜底 */ }
    if (duration && duration > 31) throw new Error('视频素材最长 30 秒, 请剪短再传')
  }
  const { oss_key } = await uploadBlobToOss(file, file.name, 'user_footage', onProgress)
  const name = file.name.replace(/\.[^.]+$/, '').slice(0, 40) || '素材'
  const r = await fetch(directBase + '/api/footage-library', {
    method: 'POST', headers: headers(),
    body: JSON.stringify({
      oss_key, media_type: isImage ? 'image' : 'video', name,
      duration_seconds: duration, file_size: file.size,
    }),
  })
  const d = await r.json()
  if (!r.ok || !d.success) throw new Error(d.detail || d.error || `登记失败 ${r.status}`)
  return d
}
