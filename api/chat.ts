import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createHmac } from 'node:crypto'

// 内联 JWT 鉴权 — 原共享 api/_lib/auth.ts 在 Vercel 上 (api/ 下 _ 开头目录被排除) import 即崩, 改自包含
function requireAuth(req: VercelRequest, res: VercelResponse): boolean {
  const authHeader = String(req.headers.authorization || req.headers.Authorization || '')
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) {
    res.status(401).json({ error: 'Unauthorized: 请登录' })
    return false
  }
  try {
    const [h, p, s] = token.split('.')
    if (!h || !p || !s) throw new Error('format')
    const secret = process.env.JWT_SECRET_KEY || 'monoi-secret-key-2025'
    const expected = createHmac('sha256', secret).update(`${h}.${p}`).digest().toString('base64url')
    if (expected !== s) throw new Error('sig')
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf-8'))
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw new Error('exp')
    if (!payload.sub) throw new Error('sub')
  } catch {
    res.status(401).json({ error: 'Unauthorized: token 无效或已过期' })
    return false
  }
  return true
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  // ============ 鉴权: 没 token / token 无效 / 过期 → 401 ============
  // 之前没鉴权, 任何人都能调 DeepSeek (薅羊毛). chat 本身不扣积分 (UX), 但必须登录.
  if (!requireAuth(req, res)) return

  // 后面调 backend /api/billing/charge 时要原 token, 再读一次
  const authHeader = String(req.headers.authorization || req.headers.Authorization || '')

  const apiKey = process.env.DEEPSEEK_API_KEY || ''
  if (!apiKey) return res.status(500).json({ error: 'DEEPSEEK_API_KEY not configured' })

  const { system, messages, stream = false, json_mode = false, charge_feature } = req.body

  // DeepSeek OpenAI 兼容格式: system 作为第一条 message
  const fullMessages = [
    { role: 'system', content: system },
    ...messages,
  ]

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
