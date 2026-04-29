import type { VercelRequest, VercelResponse } from '@vercel/node'

const API_URL = process.env.API_URL || ''

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!API_URL) return res.status(500).json({ error: 'API_URL not configured' })

  const path = (req.query.path as string) || ''
  const url = `${API_URL}${path}`

  try {
    const upstream = await fetch(url, {
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
      body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined,
    })
    const text = await upstream.text()
    try {
      const data = JSON.parse(text)
      return res.status(upstream.status).json(data)
    } catch {
      return res.status(502).json({ error: `后端返回非JSON响应 (${upstream.status}): ${text.slice(0, 200)}` })
    }
  } catch (e: any) {
    return res.status(500).json({ error: `连接失败: ${e.message}` })
  }
}
