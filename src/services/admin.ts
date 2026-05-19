// 管理员后台 API 客户端
import { getToken } from '../lib/auth'

const directBase = (import.meta as any).env?.VITE_DIRECT_API_URL || 'https://monoi.nat100.top'

function headers() {
  const token = getToken()
  if (!token) throw new Error('未登录')
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(directBase + path, { headers: headers() })
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || data.error || `${path} ${res.status}`)
  return data
}

async function post<T>(path: string, body: any): Promise<T> {
  const res = await fetch(directBase + path, { method: 'POST', headers: headers(), body: JSON.stringify(body) })
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || data.error || `${path} ${res.status}`)
  return data
}

// ================= 用户列表 =================

export interface AdminUserRow {
  id: number
  username: string
  email: string
  phone_masked: string
  created_at: string
  is_admin: number
  tier: string
  sub_end?: number
  credits_total: number
  referrer_level: 'normal' | 'certified' | 'partner'
  total_paying_users_brought: number
  total_revenue_brought: number
}

export async function adminListUsers(q = '', tier = '', limit = 50, offset = 0):
  Promise<{ total: number; users: AdminUserRow[] }>
{
  return get(`/api/admin/users?q=${encodeURIComponent(q)}&tier=${tier}&limit=${limit}&offset=${offset}`)
}

export async function adminUserDetail(user_id: number) {
  return get(`/api/admin/users/${user_id}`)
}

export async function adminGrantSubscription(user_id: number, tier: string, note = '') {
  return post(`/api/admin/users/${user_id}/grant-subscription`, { tier, note })
}

export async function adminGrantCredits(user_id: number, amount: number, note = '') {
  return post(`/api/admin/users/${user_id}/grant-credits`, { amount, note })
}

export async function adminSetReferrerLevel(user_id: number, level: 'normal' | 'certified' | 'partner') {
  return post(`/api/admin/users/${user_id}/set-referrer-level`, { level })
}

export async function adminSetAdminFlag(user_id: number, is_admin: number) {
  return post(`/api/admin/users/${user_id}/set-admin`, { is_admin })
}

// ================= 订单 =================

export interface AdminOrderRow {
  id: string
  user_id: number
  username?: string
  phone_masked?: string
  order_type: string
  product_code: string
  amount_yuan: number
  status: string
  payment_method?: string
  paid_at?: number
  created_at: number
  referrer_id?: number
  credits_added?: number
}

export async function adminListOrders(status = '', limit = 50, offset = 0):
  Promise<{ total: number; orders: AdminOrderRow[] }>
{
  return get(`/api/admin/orders?status=${status}&limit=${limit}&offset=${offset}`)
}

// ================= 提现 =================

export interface AdminWithdrawalRow {
  id: number
  user_id: number
  username?: string
  phone_masked?: string
  amount_yuan: number
  payment_method: 'alipay' | 'wechat'
  account_info: string
  status: 'pending' | 'approved' | 'rejected' | 'paid'
  admin_note?: string
  created_at: number
  processed_at?: number
}

export async function adminListWithdrawals(status = ''): Promise<AdminWithdrawalRow[]> {
  return get(`/api/admin/withdrawals?status=${status}`)
}

export async function adminProcessWithdrawal(id: number, action: 'approve' | 'reject' | 'mark_paid', note = '') {
  return post(`/api/admin/withdrawals/${id}/process`, { action, note })
}

// ================= 数据看板 =================

export interface AdminStats {
  users: {
    total: number; new_today: number; new_week: number
    paying: number; paying_conversion: number
  }
  // 套餐分布 — 每个 tier 数量 + 占付费 % + 占注册 %
  tiers: Record<string, { count: number; pct_of_paying: number; pct_of_total: number }>
  revenue: {
    total: number; today: number; week: number; month: number
    daily_7d: { days_ago: number; amount: number }[]
  }
  // 推广员细分 — normal / advanced / partner
  referrer_levels: Record<string, {
    count: number; total_brought: number; new_today: number
    pending_cash: number; pending_credits: number; total_withdrawn: number
  }>
  pending_withdrawals: number
  pending_withdraw_amount: number
}

export async function adminStats(): Promise<AdminStats> {
  return get('/api/admin/stats')
}


// ================= 商用 BGM 库管理 =================

export interface AdminBgmRow {
  id: number
  name: string
  category: string                       // upbeat/calm/inspirational/cinematic/electronic/chinese/other
  oss_key: string
  duration_seconds: number
  license_note: string
  uploaded_by: number
  created_at: number
}

export async function adminListBgm(): Promise<{ bgms: AdminBgmRow[] }> {
  return get('/api/admin/bgm-library')
}

export async function adminAddBgm(req: {
  name: string
  category: string
  oss_key: string
  duration_seconds?: number
  license_note?: string
}): Promise<{ success: boolean; id: number }> {
  return post('/api/admin/bgm-library', req)
}

export async function adminDeleteBgm(bgm_id: number): Promise<{ success: boolean }> {
  const res = await fetch(directBase + `/api/admin/bgm-library/${bgm_id}`, {
    method: 'DELETE',
    headers: headers(),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || data.error || `delete failed ${res.status}`)
  return data
}


// ================= 字体库管理 =================

export interface AdminFontRow {
  id: number
  label: string
  file: string                          // D:\monoi-server\fonts\ 下的文件名
  tag: string
  license_note: string
  uploaded_by: number
  created_at: number
  file_exists: boolean                  // 后端检查文件是不是真在磁盘上
}

export async function adminListFonts(): Promise<{ fonts: AdminFontRow[] }> {
  return get('/api/admin/fonts')
}

/** 上传字体. 走 multipart form-data, 不能用 post 函数 (它强制 application/json) */
export async function adminUploadFont(req: {
  file: File
  label: string
  tag?: string
  license_note?: string
}): Promise<{ success: boolean; id: number; file: string; size_kb: number }> {
  const token = getToken()
  if (!token) throw new Error('未登录')
  const form = new FormData()
  form.append('file', req.file)
  form.append('label', req.label)
  if (req.tag) form.append('tag', req.tag)
  if (req.license_note) form.append('license_note', req.license_note)
  const res = await fetch(directBase + '/api/admin/fonts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || data.error || `上传失败 ${res.status}`)
  return data
}

export async function adminDeleteFont(font_id: number): Promise<{ success: boolean }> {
  const res = await fetch(directBase + `/api/admin/fonts/${font_id}`, {
    method: 'DELETE',
    headers: headers(),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || data.error || `delete failed ${res.status}`)
  return data
}


// ================= 封面模板库管理 =================

export interface CoverTextField {
  label: string                       // 字段名 例 "主标题"
  x: number; y: number; w: number; h: number   // 位置/大小 (像素, 相对底图)
  font_file: string                   // 字体库文件名
  font_size: number
  color: string                       // 主色 #RRGGBB
  highlight_color?: string | null     // 大括号包的字用这个色
  stroke_color?: string | null
  stroke_width: number
  shadow_color?: string | null
  shadow_offset_x: number
  shadow_offset_y: number
  shadow_blur: number
  align: 'left' | 'center' | 'right'
  rotation: number                    // 旋转角度 (°), -45 ~ +45
  max_chars: number
  placeholder: string
}

export interface CoverPersonSlot {
  x: number; y: number; w: number; h: number
  stroke_enabled: boolean              // 是否给人物加描边
  stroke_color: string                 // 描边色 例 #FFFFFF
  stroke_width: number                 // 描边宽 (像素)
  fit_mode: 'cover' | 'contain'        // 人物图怎么填满坑
}

export interface AdminCoverTemplate {
  id: number
  name: string
  category: string                    // kepu/zhenjing/gushi/jiaocheng/jianji/zhichang/xuexi/licai/other
  ratio: '9:16' | '3:4' | '16:9' | '1:1'
  bg_oss_key: string
  bg_url?: string                     // 后端签好的 1h 签名 URL (给 admin 缩略图)
  preview_oss_key?: string | null
  text_fields: CoverTextField[]
  person_slot: CoverPersonSlot | null  // 没人物的模板是 null
  uploaded_by: number
  created_at: number
}

export async function adminListCoverTemplates(): Promise<{ templates: AdminCoverTemplate[] }> {
  return get('/api/admin/cover-templates')
}

export async function adminGetCoverTemplate(template_id: number): Promise<AdminCoverTemplate> {
  return get(`/api/admin/cover-templates/${template_id}`)
}

export async function adminAddCoverTemplate(req: {
  name: string
  category: string
  ratio: string
  bg_oss_key: string
  text_fields: CoverTextField[]
  person_slot?: CoverPersonSlot | null
}): Promise<{ success: boolean; id: number }> {
  return post('/api/admin/cover-templates', req)
}

export async function adminDeleteCoverTemplate(template_id: number): Promise<{ success: boolean }> {
  const res = await fetch(directBase + `/api/admin/cover-templates/${template_id}`, {
    method: 'DELETE',
    headers: headers(),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || data.error || `delete failed ${res.status}`)
  return data
}


// ================= API 用量 =================

export interface ApiUsageProviderRow {
  provider: string
  calls: number
  total_count: number
  total_tokens: number
  total_bytes: number
  total_duration_ms: number
  total_cost: number
  gpu_calls: number
}

export interface ApiUsageDailyRow {
  day: string
  provider: string
  count: number
  cost: number
  duration_ms: number
}

export interface ApiUsageRecentRow {
  id: number
  provider: string
  action: string
  user_id: number | null
  count: number
  tokens: number
  bytes: number
  duration_ms: number
  cost_yuan: number
  gpu_used: number
  note: string
  created_at: number
}

export interface ApiUsageResp {
  days: number
  total: { calls: number; cost: number; duration_ms: number; gpu_calls: number }
  by_provider: ApiUsageProviderRow[]
  daily: ApiUsageDailyRow[]
  recent: ApiUsageRecentRow[]
}

export async function adminApiUsage(days = 7): Promise<ApiUsageResp> {
  return get(`/api/admin/api-usage?days=${days}`)
}
