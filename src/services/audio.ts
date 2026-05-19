// 音频工具 API client — demucs 去人声等

import { getToken } from '../lib/auth'

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
    headers: { Authorization: `Bearer ${getToken() || ''}` },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.success) {
    throw new Error(data.detail || data.error || `去人声失败 (${res.status})`)
  }
  return data
}

export interface TrimAudioResp {
  success: boolean
  oss_key: string
  download_url: string
  duration_seconds: number
  output_size_kb: number
}

/** 裁剪已有音频. 后端用 ffmpeg, 几秒钟. */
export async function trimAudio(oss_key: string, start_seconds: number, end_seconds: number): Promise<TrimAudioResp> {
  const res = await fetch(directBase + '/api/voice/trim-audio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oss_key, start_seconds, end_seconds }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.success) {
    throw new Error(data.detail || data.error || `裁剪失败 (${res.status})`)
  }
  return data
}

// ================= 内置商用 BGM 库 =================

export interface BgmTrack {
  id: number
  name: string
  category: string                     // upbeat / calm / inspirational / cinematic / electronic / chinese / other
  oss_key: string
  preview_url: string                  // 签名 URL, 1h 有效, 给前端播放试听
  duration_seconds: number
  license_note: string
}

/** 列出后台精选的商用 BGM (所有登录用户可读, 视频合成 BGM 选区用) */
export async function listBgmLibrary(): Promise<{ bgms: BgmTrack[] }> {
  const res = await fetch(directBase + '/api/voice/bgm-library')
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.detail || data.error || `BGM 库加载失败 (${res.status})`)
  }
  return data
}
