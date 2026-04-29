import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const { url } = req.body
  if (!url) return res.status(400).json({ error: '缺少 url 参数' })

  // 判断是否是视频链接，转给 Windows 服务器处理
  const isVideo = /youtube\.com|youtu\.be|tiktok\.com|douyin\.com|bilibili\.com|v\.qq\.com/i.test(url)

  if (isVideo) {
    const API_URL = process.env.API_URL || ''
    if (!API_URL) return res.status(500).json({ error: 'API_URL not configured' })
    try {
      const upstream = await fetch(`${API_URL}/api/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const data = await upstream.json()
      if (!upstream.ok) return res.status(upstream.status).json(data)
      return res.json({ content: data.transcript, source: 'video' })
    } catch (e: any) {
      return res.status(500).json({ error: `视频转录失败: ${e.message}` })
    }
  }

  // 网页链接：直接抓取正文
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
      signal: AbortSignal.timeout(10000),
    })

    const html = await response.text()

    // 提取正文：去掉 script/style/html 标签
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s{2,}/g, '\n')
      .trim()
      .slice(0, 3000) // 最多取前3000字

    if (!text || text.length < 50) {
      return res.status(422).json({ error: '无法提取页面内容，请直接粘贴原文' })
    }

    return res.json({ content: text, source: 'webpage' })
  } catch (e: any) {
    return res.status(500).json({ error: `页面抓取失败: ${e.message}，请直接粘贴原文` })
  }
}
