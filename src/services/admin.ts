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
