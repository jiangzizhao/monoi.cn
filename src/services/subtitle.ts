// 视频字幕: 后端 ASR 识别 → (用户改字) → ffmpeg 烧录. 对应 voice-server /api/voice/subtitle/*
import { getToken } from '../lib/auth'

const directBase = import.meta.env.VITE_DIRECT_API_URL || 'https://monoi.nat100.top'

export interface SubSeg {
  start: number
  end: number
  text: string
}

function authHeaders() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken() || ''}` }
}

/** 识别视频语音 → 可编辑字幕条 + 视频 OSS key (烧录步骤复用) */
export async function subtitleTranscribe(
  payload: { video_oss_key?: string; video_url?: string },
): Promise<{ video_oss_key: string; segments: SubSeg[] }> {
  const res = await fetch(directBase + '/api/voice/subtitle/transcribe', {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(payload),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok || !j.success) throw new Error(j.detail || j.error || `识别失败 (${res.status})`)
  return { video_oss_key: j.video_oss_key, segments: j.segments || [] }
}

/** 把(改好的)字幕烧到视频, 返回带字幕的新视频 URL */
export async function subtitleBurn(
  payload: {
    video_oss_key: string; segments: SubSeg[]
    font_scale?: number; color?: string; position?: string
    font_file?: string; stroke_color?: string; stroke_width?: number; shadow?: boolean
  },
): Promise<{ video_url: string; output_oss_key: string }> {
  const res = await fetch(directBase + '/api/voice/subtitle/burn', {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(payload),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok || !j.success) throw new Error(j.detail || j.error || `生成失败 (${res.status})`)
  return { video_url: j.video_url, output_oss_key: j.output_oss_key }
}
