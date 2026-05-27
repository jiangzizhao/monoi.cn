import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth } from './_lib/auth'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 之前没鉴权, 攻击者能用我的 PEXELS_API_KEY 烧月配额. 必须登录.
  if (!requireAuth(req, res)) return

  const apiKey = process.env.PEXELS_API_KEY || ''
  if (!apiKey) return res.status(500).json({ error: 'PEXELS_API_KEY not configured' })

  const { query, per_page = 5, orientation = 'landscape' } = req.query

  try {
    const response = await fetch(
      `https://api.pexels.com/videos/search?query=${encodeURIComponent(String(query))}&per_page=${per_page}&orientation=${orientation}`,
      { headers: { Authorization: apiKey } }
    )
    const data = await response.json()
    const videos = (data.videos || []).map((v: any) => ({
      id: v.id,
      image: v.image,
      duration: v.duration,
      url: v.url,
      // 返回全部 video_files (含所有 quality), 让前端选最高分辨率不超过 1920px 的 mp4
      video_files: v.video_files,
    }))
    return res.json({ videos })
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }
}
