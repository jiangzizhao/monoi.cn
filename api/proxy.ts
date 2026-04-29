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
    const data = await upstream.json()
    return res.status(upstream.status).json(data)
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }
}
