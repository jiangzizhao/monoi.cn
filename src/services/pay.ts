// 支付 API client — 直接打 Windows 后端 (绕 Vercel 4.5MB 限制, 跟 voice/billing 一样)
import { getToken } from '../lib/auth'

const directBase = (import.meta as any).env?.VITE_DIRECT_API_URL || 'https://monoi.nat100.top'

function authHeaders(): Record<string, string> {
  const token = getToken()
  if (!token) throw new Error('未登录')
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

export interface CreateOrderResp {
  success: boolean
  order_id: string
  code_url: string         // 微信: weixin://wxpay/bizpayurl?pr=xxx  支付宝: 二维码 URL 或跳转 URL
  amount_yuan: number
  plan_name: string
  expires_at: number       // Unix 秒
  channel: 'wechat' | 'alipay'
}

export type OrderStatus = 'pending' | 'paid' | 'expired'

export interface QueryOrderResp {
  status: OrderStatus
  transaction_id?: string
  paid_at?: number
}

export async function createOrder(planId: string, channel: 'wechat' | 'alipay' = 'wechat'): Promise<CreateOrderResp> {
  const res = await fetch(directBase + '/api/pay/create', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ plan_id: planId, channel }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || data.error || `创建订单失败 (${res.status})`)
  return data
}

export async function queryOrder(orderId: string): Promise<QueryOrderResp> {
  const res = await fetch(directBase + `/api/pay/query/${encodeURIComponent(orderId)}`, {
    headers: authHeaders(),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || data.error || `查单失败 (${res.status})`)
  return data
}
