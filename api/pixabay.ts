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
  // 之前没鉴权, 攻击者能用我的 PIXABAY_API_KEY 烧月配额. 必须登录.
  if (!requireAuth(req, res)) return

  const apiKey = process.env.PIXABAY_API_KEY || ''
  if (!apiKey) return res.status(500).json({ error: 'PIXABAY_API_KEY not configured' })

  const { query, per_page = 5 } = req.query

  try {
    const response = await fetch(
      `https://pixabay.com/api/videos/?key=${apiKey}&q=${encodeURIComponent(String(query))}&per_page=${per_page}&video_type=film`
    )
    const data = await response.json()
    const hits = (data.hits || []).map((v: any) => ({
      id: v.id,
      duration: v.duration,
      previewURL: v.previewURL,
      videos: {
        medium: { thumbnail: v.videos?.medium?.thumbnail },
        small: { url: v.videos?.small?.url },
      },
    }))
    return res.json({ hits })
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }
}
