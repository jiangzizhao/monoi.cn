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

function extractUrl(text: string): string {
  const match = text.match(/https?:\/\/[^\s，。！？、]+/)
  return match ? match[0] : text.trim()
}

// 需要通过 Windows 国内服务器处理的平台
const CN_PLATFORMS = /douyin\.com|v\.douyin\.com|tiktok\.com|xiaohongshu\.com|xhslink\.com|bilibili\.com|weibo\.com|kuaishou\.com|ixigua\.com|v\.qq\.com/i

// 需要视频转录的平台（国际）
const INTL_VIDEO = /youtube\.com|youtu\.be|instagram\.com\/reel/i

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  // 之前没鉴权, 攻击者能用我的后端抓取任意 URL (转推 / 转录, 烧带宽 + 计算).
  // 加 JWT 拦截.
  if (!requireAuth(req, res)) return

  const { url: rawInput } = req.body
  if (!rawInput) return res.status(400).json({ error: '缺少 url 参数' })

  const url = extractUrl(rawInput)
  const API_URL = process.env.API_URL || ''

  // 中国平台 → 转给 Windows 服务器处理
  if (CN_PLATFORMS.test(url)) {
    if (!API_URL) return res.status(500).json({ error: 'API_URL not configured' })
    try {
      const upstream = await fetch(`${API_URL}/api/fetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(120000),
      })
      const data = await upstream.json()
      if (!upstream.ok) return res.status(upstream.status).json(data)
      return res.json(data)
    } catch (e: any) {
      return res.status(500).json({ error: `内容获取失败: ${e.message}` })
    }
  }

  // 国际视频平台 → 也转给 Windows 服务器用 yt-dlp 处理
  if (INTL_VIDEO.test(url)) {
    if (!API_URL) return res.status(500).json({ error: 'API_URL not configured' })
    try {
      const upstream = await fetch(`${API_URL}/api/fetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(120000),
      })
      const data = await upstream.json()
      if (!upstream.ok) return res.status(upstream.status).json(data)
      return res.json(data)
    } catch (e: any) {
      return res.status(500).json({ error: `视频转录失败: ${e.message}` })
    }
  }

  // 其他网页 → Vercel 直接抓取
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
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/\s{2,}/g, '\n').trim().slice(0, 3000)

    if (!text || text.length < 50) {
      return res.status(422).json({ error: '无法提取页面内容，请直接粘贴原文' })
    }
    return res.json({ content: text, source: 'webpage' })
  } catch (e: any) {
    return res.status(500).json({ error: `页面抓取失败: ${e.message}` })
  }
}
