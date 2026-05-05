import type { VercelRequest, VercelResponse } from '@vercel/node'

const API_URL = process.env.API_URL || ''

export const config = {
  api: {
    // 关闭默认的 body 解析，自己处理 multipart 流
    bodyParser: false,
  },
}

async function readRawBody(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req as any) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!API_URL) return res.status(500).json({ error: 'API_URL not configured' })

  const path = (req.query.path as string) || ''
  const url = `${API_URL}${path}`
  const upstreamCT = (req.headers['content-type'] as string) || ''

  try {
    let body: BodyInit | undefined
    const headers: Record<string, string> = {}

    if (req.method && req.method !== 'GET') {
      if (upstreamCT.includes('multipart/form-data')) {
        // 文件上传，原样转发
        body = await readRawBody(req)
        headers['Content-Type'] = upstreamCT
      } else {
        // JSON
        const raw = await readRawBody(req)
        body = raw.length ? raw : undefined
        headers['Content-Type'] = upstreamCT || 'application/json'
      }
    }

    const upstream = await fetch(url, {
      method: req.method,
      headers,
      body,
    })

    const ct = upstream.headers.get('content-type') || ''

    // 二进制内容直接流式转发
    if (!ct.includes('json') && !ct.includes('text')) {
      const buf = Buffer.from(await upstream.arrayBuffer())
      res.setHeader('Content-Type', ct || 'application/octet-stream')
      const cl = upstream.headers.get('content-length')
      if (cl) res.setHeader('Content-Length', cl)
      return res.status(upstream.status).send(buf)
    }

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
