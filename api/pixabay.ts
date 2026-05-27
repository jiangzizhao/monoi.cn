import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth } from './_lib/auth'

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
