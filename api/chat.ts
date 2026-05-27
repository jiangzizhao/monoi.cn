import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createHmac } from 'node:crypto'

/**
 * JWT 验签 (HS256). 跟后端 main.py: SECRET_KEY 一致.
 * 没用 jsonwebtoken 包是因为不想引依赖, 手撸 base64url + HMAC 就够.
 * Returns payload object or null (无效 / 过期 / 签名错).
 */
function verifyJWT(token: string, secret: string): { sub?: string; iat?: number; exp?: number } | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const [headerB64, payloadB64, sigB64] = parts
    const expected = createHmac('sha256', secret).update(`${headerB64}.${payloadB64}`).digest()
    const expectedB64 = expected.toString('base64url')
    if (expectedB64 !== sigB64) return null
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'))
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  // ============ 鉴权: 没 token / token 无效 / 过期 → 401 ============
  // 之前这里没鉴权, 任何人 (包括没注册的) 都能调 DeepSeek, 严重薅羊毛漏洞.
  // chat 本身不扣积分 (UX 性质, 用户要靠它问 monoi 怎么用), 但必须是已登录用户.
  const authHeader = String(req.headers.authorization || req.headers.Authorization || '')
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return res.status(401).json({ error: 'Unauthorized: 请登录' })
  const secret = process.env.JWT_SECRET_KEY || 'monoi-secret-key-2025'
  const payload = verifyJWT(token, secret)
  if (!payload || !payload.sub) return res.status(401).json({ error: 'Unauthorized: token 无效或已过期' })

  const apiKey = process.env.DEEPSEEK_API_KEY || ''
  if (!apiKey) return res.status(500).json({ error: 'DEEPSEEK_API_KEY not configured' })

  const { system, messages, stream = false, json_mode = false, charge_feature } = req.body

  // ============ 扣积分 (DeepSeek 调用前) ============
  // 之前扣费走前端 chargeCredit('ai_writing', 3), 攻击者改前端代码 (注释那行) 就能绕过.
  // 现在搬到 Vercel function 内: 调 DeepSeek 之前先 sync 调后端 /api/billing/charge.
  // 不够 (402) → 直接返 402 给前端, AI 调用根本不发生.
  //
  // 价目表硬编码, 防前端篡改 amount. 不在表里的 feature → 跳过 (走老前端 chargeCredit 流程).
  // 后续把 footage_match 等也搬过来时, 加进 PRICES 即可.
  const SERVER_CHARGE_PRICES: Record<string, number> = {
    ai_writing: 3,
    ai_writing_regen: 3,
    footage_match: 5,
  }
  if (charge_feature && SERVER_CHARGE_PRICES[charge_feature] !== undefined) {
    const amount = SERVER_CHARGE_PRICES[charge_feature]
    const backendUrl = process.env.BACKEND_API_URL || 'https://monoi.nat100.top'
    try {
      const chargeRes = await fetch(`${backendUrl}/api/billing/charge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader,
        },
        body: JSON.stringify({ feature: charge_feature, amount, ref_id: null }),
      })
      if (!chargeRes.ok) {
        // 透传后端 detail (一般是 "积分余额不足. 当前剩 X 积分, ...")
        const errBody: any = await chargeRes.json().catch(() => ({}))
        return res.status(chargeRes.status).json({
          error: errBody.detail || errBody.error || `扣费失败 (${chargeRes.status})`,
        })
      }
    } catch (e: any) {
      // 后端联系不上 — 不能默默放过 (这就是漏洞), 也不能完全卡死用户. 返 503 让前端重试
      return res.status(503).json({ error: `扣费服务暂时不可用, 请重试 (${e.message})` })
    }
  }

  // DeepSeek uses OpenAI-compatible format: system goes as first message
  const fullMessages = [
    { role: 'system', content: system },
    ...messages,
  ]

  try {
    const upstream = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: fullMessages,
        stream,
        max_tokens: 4096,
        ...(json_mode ? { response_format: { type: 'json_object' } } : {}),
      }),
    })

    if (!upstream.ok) return res.status(upstream.status).send(await upstream.text())

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      const reader = upstream.body!.getReader()
      const dec = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = dec.decode(value, { stream: true })
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') { res.write('data: [DONE]\n\n'); continue }
          try {
            const p = JSON.parse(data)
            const text = p.choices?.[0]?.delta?.content || ''
            if (text) res.write(`data: ${JSON.stringify({ delta: { text } })}\n\n`)
          } catch {}
        }
      }
      return res.end()
    }

    return res.json(await upstream.json())
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }
}
