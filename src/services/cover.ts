// 封面模板 — 用户端 API client
// 用户能 a) 拉模板库 b) 上传人物图抠图 c) 按模板渲染封面

const directBase = (import.meta as any).env?.VITE_DIRECT_API_URL || 'https://monoi.nat100.top'

export interface UserCoverTextField {
  label: string
  x: number; y: number; w: number; h: number
  font_file: string
  font_size: number
  color: string
  highlight_color?: string | null
  stroke_color?: string | null
  stroke_width: number
  shadow_color?: string | null
  shadow_offset_x: number
  shadow_offset_y: number
  shadow_blur: number
  align: 'left' | 'center' | 'right'
  rotation: number                       // 旋转角度 (°)
  max_chars: number
  placeholder: string
}

export interface UserCoverPersonSlot {
  x: number; y: number; w: number; h: number
  stroke_enabled: boolean
  stroke_color: string
  stroke_width: number
  fit_mode: 'cover' | 'contain'
}

export interface CoverTemplate {
  id: number
  name: string
  category: string
  ratio: '9:16' | '3:4' | '16:9' | '1:1'
  bg_url: string                        // 签名 1h URL, 给前端预览
  preview_url?: string
  text_fields: UserCoverTextField[]
  person_slot?: UserCoverPersonSlot | null
  created_at: number
}

/** 拉公共模板库 (所有登录用户都能拉) */
export async function listCoverTemplates(): Promise<{ templates: CoverTemplate[] }> {
  const res = await fetch(directBase + '/api/voice/cover-templates')
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.detail || data.error || `模板加载失败 ${res.status}`)
  return data
}

export interface RemoveBgResp {
  success: boolean
  oss_key: string                       // 抠好的透明 PNG 在 OSS 的 key, 给 renderCoverFromTemplate 用
  preview_url: string                   // 24h 签名 URL, 给前端预览
  size_kb: number
  has_stroke: boolean
}

/** 用户上传人物照片 → 后端 rembg 抠图 + (可选) 描边 → 返 OSS key */
export async function coverRemoveBg(file: File, opts?: {
  stroke_enabled?: boolean
  stroke_color?: string
  stroke_width?: number
}): Promise<RemoveBgResp> {
  const form = new FormData()
  form.append('file', file)
  form.append('stroke_enabled', String(opts?.stroke_enabled ?? true))
  form.append('stroke_color', opts?.stroke_color ?? '#FFFFFF')
  form.append('stroke_width', String(opts?.stroke_width ?? 12))
  const res = await fetch(directBase + '/api/voice/cover-remove-bg', {
    method: 'POST',
    body: form,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.success) throw new Error(data.detail || data.error || `抠图失败 ${res.status}`)
  return data
}

export interface RenderCoverResp {
  success: boolean
  oss_key: string
  download_url: string
  size_kb: number
  width: number
  height: number
}

export interface TextFieldOverride {
  font_file?: string                     // 字体库文件名 (覆盖 admin 设的)
  font_scale?: number                    // 字号倍数 (admin 字号 × scale)
  color?: string                         // 主色 #FFFFFF (覆盖)
  highlight_color?: string               // {} 大括号包字的色
  stroke_color?: string                  // 描边色
  stroke_width?: number                  // 描边宽
  x?: number                             // 用户拖拽位置 (px, 相对底图)
  y?: number
  w?: number
  h?: number
}

/** 按模板渲染封面: 模板 id + 用户填的文字 + (可选) 用户微调样式 + 抠好的人物 oss_key */
export async function renderCoverFromTemplate(req: {
  template_id: number
  user_texts: Record<string, string>     // {field_label: 用户填的文字}
  text_overrides?: Record<string, TextFieldOverride>   // 用户微调, 覆盖 admin 默认
  person_oss_key?: string                 // 没人物的模板留空
}): Promise<RenderCoverResp> {
  const res = await fetch(directBase + '/api/voice/render-cover-from-template', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.success) throw new Error(data.detail || data.error || `渲染失败 ${res.status}`)
  return data
}
