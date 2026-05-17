// 音频工具 API client — demucs 去人声等

const directBase = (import.meta as any).env?.VITE_DIRECT_API_URL || 'https://monoi.nat100.top'

export interface RemoveVocalsResp {
  success: boolean
  download_url: string           // 签名 URL, 24h 有效
  oss_key: string                // 给后续 BGM 接入用 (e.g. /compose-footage 直接传 bgm_oss_key)
  duration_seconds: number
  output_size_kb: number
  gpu_used: boolean
  original_filename: string
}

/** 上传音乐 → 后端跑 demucs → 返 BGM mp3 URL.
 * GPU 5-30s, CPU 2-5min. 调用方自己加 loading + 错误处理. */
export async function removeVocals(file: File, signal?: AbortSignal): Promise<RemoveVocalsResp> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(directBase + '/api/voice/remove-vocals', {
    method: 'POST',
    body: form,
    signal,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.success) {
    throw new Error(data.detail || data.error || `去人声失败 (${res.status})`)
  }
  return data
}
