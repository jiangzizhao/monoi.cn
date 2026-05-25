// 我的录屏 API 客户端 — 列表 / 保存 / 删除 / 转 mp4
import { getToken } from '../lib/auth'

const directBase = (import.meta as any).env?.VITE_DIRECT_API_URL || 'https://monoi.nat100.top'

function headers() {
  const token = getToken()
  if (!token) throw new Error('未登录')
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

export interface MyRecording {
  id: number
  oss_key: string
  url: string             // 1h 签名播放/下载 URL
  filename: string
  mime: string
  duration_sec: number
  size_bytes: number
  title: string
  created_at: number
}

export async function listMyRecordings(): Promise<{ recordings: MyRecording[] }> {
  const r = await fetch(directBase + '/api/recordings', { headers: headers() })
  const d = await r.json()
  if (!r.ok) throw new Error(d.detail || d.error || `list failed ${r.status}`)
  return d
}

export async function saveMyRecording(req: {
  oss_key: string
  filename?: string
  mime?: string
  duration_sec?: number
  size_bytes?: number
  title?: string
}): Promise<{ success: boolean; id: number }> {
  const r = await fetch(directBase + '/api/recordings', {
    method: 'POST', headers: headers(), body: JSON.stringify(req),
  })
  const d = await r.json()
  if (!r.ok) throw new Error(d.detail || d.error || `save failed ${r.status}`)
  return d
}

export async function deleteMyRecording(id: number): Promise<{ success: boolean }> {
  const r = await fetch(directBase + `/api/recordings/${id}`, {
    method: 'DELETE', headers: headers(),
  })
  const d = await r.json()
  if (!r.ok) throw new Error(d.detail || d.error || `delete failed ${r.status}`)
  return d
}

/** 把已上传的 webm 录屏 (OSS key) 转码成 mp4. 返新 OSS key + URL. */
export async function transcodeRecordingToMp4(oss_key: string): Promise<{
  success: boolean; oss_key: string; url: string; size_bytes: number
}> {
  const r = await fetch(directBase + '/api/recording/transcode-to-mp4', {
    method: 'POST', headers: headers(), body: JSON.stringify({ oss_key }),
  })
  const d = await r.json()
  if (!r.ok) throw new Error(d.detail || d.error || `transcode failed ${r.status}`)
  return d
}

/** 上传 blob 到 OSS — 浏览器直传, 走签名 PUT.
 * 返 oss_key (登记到 DB 用) + xhr 进度回调. */
export async function uploadBlobToOss(
  blob: Blob,
  filename: string,
  prefix: string = 'recordings',
  onProgress?: (pct: number) => void,
): Promise<{ oss_key: string; content_type: string }> {
  // 1. 拿签名
  const signRes = await fetch(directBase + '/api/oss/sign-upload', {
    method: 'POST', headers: headers(),
    body: JSON.stringify({
      filename, content_type: blob.type || 'application/octet-stream', prefix,
    }),
  })
  if (!signRes.ok) {
    const t = await signRes.text().catch(() => '')
    throw new Error(`OSS 签名失败 ${signRes.status}: ${t.slice(0, 200)}`)
  }
  const { put_url, oss_key, content_type } = await signRes.json()

  // 2. PUT 到 OSS
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', put_url)
    xhr.setRequestHeader('Content-Type', content_type)
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100))
      }
    }
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`OSS PUT 失败 ${xhr.status}`))
    xhr.onerror = () => reject(new Error('OSS PUT 网络错误'))
    xhr.send(blob)
  })

  return { oss_key, content_type }
}
