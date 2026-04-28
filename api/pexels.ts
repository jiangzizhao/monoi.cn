import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
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
      video_files: v.video_files?.slice(0, 2),
    }))
    return res.json({ videos })
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }
}
