// 商业化 API 客户端
// 所有请求带 Authorization: Bearer <jwt>, jwt 从 localStorage monoi_token 读

import { getToken } from '../lib/auth'

const directBase = (import.meta as any).env?.VITE_DIRECT_API_URL || 'https://monoi.nat100.top'

export interface PlanConfig {
  name: string
  price_yuan: number
  period_days?: number
  monthly_credits: number
  yearly_total_credits?: number
  credit_pack_rate: number
  digital_human_quota: number
  max_video_minutes: number          // 单视频最长时长
  max_resolution: string             // 480p / 720p / 1080p / 4K
  clone_voice_slots: number
  multi_platform_accounts: number    // 平台账号数
  team_seats: number                 // 团队子账号
  priority_gpu: boolean
  commercial_license: boolean
  transferable_license: boolean      // 转售授权
  vip_support: boolean               // VIP 1v1
  early_access: boolean              // 提前体验
  api_access: boolean                // V2 API
  unlimited_duration: boolean        // 不限时长
  referral_boost: boolean            // 推广分成提升
  watermark: boolean
  support_response_hours: number     // 客服响应小时
}

export interface CreditPack {
  name: string
  price_yuan: number
  credits: number
}

export interface PlansResponse {
  plans: Record<string, PlanConfig>           // pro_monthly / max_monthly / flagship_yearly
  free: PlanConfig
  credit_packs: Record<string, CreditPack>    // pack_99 / pack_49 / pack_199 / pack_499
  consume_rules: Record<string, { per_second?: number; fixed?: number }>
}

export interface DailyGrantInfo {
  day_index: number              // 注册第几天 (1..N)
  days_remaining: number         // 还能领几天 (含今天, 已领完今天就是次日开始)
  granted_today: boolean         // 今天领过没
  daily_amount: number           // 每天送多少
  total_days: number             // 一共送几天 (默认 7)
}

export interface CreditBalance {
  monthly: number                // 月度剩余 (free 是 daily grant 累计 - 已用)
  purchased: number              // 一次性买的剩余 (不过期)
  total: number                  // monthly + purchased
  monthly_quota: number          // free=420 (7×60), 付费=套餐月送
  monthly_used: number
  monthly_used_pct: number
  reset_at: number               // 付费用户月度 reset 时间戳 (秒)
  tier: string                   // free / pro_monthly / max_monthly / flagship_yearly
  daily_grant: DailyGrantInfo | null   // free 用户有, 付费用户 null
}

export interface UserSubscription {
  tier: string                                 // free / pro_monthly / max_monthly / flagship_yearly
  expired?: boolean
  current_period_start?: number
  current_period_end?: number
  auto_renew?: number
  name?: string
}

export interface ReferralCode {
  referral_code: string
  link: string
}

export interface ReferrerStatus {
  user_id: number
  level: 'normal' | 'certified' | 'partner'
  referral_code: string
  total_paying_users: number
  total_revenue_brought: number
  month_paying_users: number
  month_revenue_brought: number
  alipay_account?: string
  wechat_account?: string
}

export interface ReferrerBalance {
  cash_balance: number
  cash_withdrawn_total: number
}

export interface CreditLogEntry {
  id: number
  user_id: number
  feature?: string
  delta: number
  source: string
  ref_id?: string
  created_at: number
}

function authHeaders(): Record<string, string> {
  const token = getToken()
  if (!token) throw new Error('未登录')
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(directBase + path, { headers: authHeaders() })
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || data.error || `${path} ${res.status}`)
  return data
}

async function post<T>(path: string, body: any): Promise<T> {
  const res = await fetch(directBase + path, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || data.error || `${path} ${res.status}`)
  return data
}

// ============== 套餐 ==============

// 套餐列表是公开的, 不需要 auth (但带上也没事)
export async function fetchPlans(): Promise<PlansResponse> {
  const res = await fetch(directBase + '/api/billing/plans')
  return res.json()
}

export async function fetchMyCredits(): Promise<CreditBalance> {
  return get('/api/billing/credits')
}

export async function fetchMySubscription(): Promise<UserSubscription> {
  return get('/api/billing/subscription')
}

export async function fetchCreditLog(limit = 50): Promise<CreditLogEntry[]> {
  return get(`/api/billing/credit-log?limit=${limit}`)
}

export interface OrderEntry {
  id: string
  order_type: string                // 'subscription' / 'credit_pack'
  product_code: string              // 'pro_monthly' / 'pack_99' / ...
  amount_yuan: number
  credits_added?: number
  status: string                    // 'pending' / 'paid' / 'expired' / 'refunded'
  payment_method?: string
  payment_channel?: string          // 'wechat' / 'alipay' / 'manual'
  paid_at?: number
  refunded_at?: number
  wx_transaction_id?: string
  created_at: number
  expires_at?: number
}

export async function fetchMyOrders(limit = 50): Promise<OrderEntry[]> {
  return get(`/api/billing/my-orders?limit=${limit}`)
}

export async function subscribe(tier: string): Promise<{ success: boolean; order_id: string; message: string }> {
  return post('/api/billing/subscribe', { tier, payment_method: 'manual' })
}

export async function buyCredits(pack_code: string): Promise<{ success: boolean; order_id: string; credits_added: number }> {
  return post('/api/billing/buy-credits', { pack_code, payment_method: 'manual' })
}

// ============== 推广 ==============

export async function fetchMyReferralCode(): Promise<ReferralCode> {
  return get('/api/referral/my-code')
}

export async function fetchMyReferrerStatus(): Promise<ReferrerStatus> {
  return get('/api/referral/status')
}

export async function checkReferrerUpgrade(): Promise<{ upgraded: boolean; from: string; to: string } & ReferrerStatus> {
  return post('/api/referral/upgrade-check', {})
}

export async function fetchMyReferrerBalance(): Promise<ReferrerBalance> {
  return get('/api/referral/balance')
}

export async function fetchMyCommissions(limit = 50) {
  return get(`/api/referral/commissions?limit=${limit}`)
}

export interface ReferredUser {
  user_id: number
  bound_at: number
  username: string
  phone_masked: string
  total_paid_amount: number
  order_count: number
}

export interface CommissionDetail {
  id: number
  order_id: string
  commission_type: 'register_bonus' | 'first_order' | 'renewal'
  renewal_month_index?: number
  credits: number
  cash_yuan: number
  status: 'pending' | 'settled' | 'cancelled_refund'
  created_at: number
  product_code?: string
  order_amount?: number
  buyer_username?: string
  buyer_phone_masked?: string
}

export async function fetchMyReferralRecords(limit = 100): Promise<{
  referred_users: ReferredUser[]
  commissions: CommissionDetail[]
}> {
  return get(`/api/referral/records?limit=${limit}`)
}

export async function submitWithdraw(amount_yuan: number, payment_method: 'alipay' | 'wechat', account_info: string) {
  return post('/api/referral/withdraw', { amount_yuan, payment_method, account_info })
}

// ============== 用户资料 ==============

export interface UserProfile {
  id: number
  username: string
  email: string
  phone?: string
  phone_masked: string
  avatar_oss_key?: string
  avatar_url?: string        // 后端签好的 6 小时 GET URL
  is_admin: number
  created_at: string
}

export async function fetchMyProfile(): Promise<UserProfile> {
  return get('/api/me')
}

/** 前端上报扣费 (Vercel edge function 调用走这条路, 跟后端 main.py 直接扣的区分开).
 * 只允许后端白名单的 feature: ai_writing / footage_match / ai_writing_regen.
 * 失败 (含余额不足 402) 抛 — 调用方决定是否阻断后续 UI. */
export async function chargeCredit(
  feature: 'ai_writing' | 'footage_match' | 'ai_writing_regen' | 'footage_download' | 'cover_download' | 'cutout_download',
  amount: number,
  ref_id?: string,
) {
  return post('/api/billing/charge', { feature, amount, ref_id })
}

export async function updateProfile(data: { username?: string; avatar_oss_key?: string }) {
  return post('/api/me/update', data)
}

export async function changePassword(old_password: string, new_password: string) {
  return post('/api/me/change-password', { old_password, new_password })
}

export async function rebindPhone(new_phone: string, new_phone_code: string, old_phone_code: string) {
  return post('/api/me/rebind-phone', { new_phone, new_phone_code, old_phone_code })
}
