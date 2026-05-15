import type { VercelRequest, VercelResponse } from '@vercel/node'

const API_URL = process.env.API_URL || ''

export const config = {
  api: { bodyParser: false },
  maxDuration: 60,
}

function readRawBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: any) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!API_URL) return res.status(500).json({ error: 'API_URL not configured' })

  const path = (req.query.path as string) || ''
  const url = `${API_URL}${path}`
  const reqCT = (req.headers['content-type'] as string) || ''

  // Vercel 自动给 req.headers['x-forwarded-for'] 塞了真实客户端 IP (最左边).
  // 转发给后端, 后端用来做 IP 限流 (否则后端只看到 Vercel/NATAPP 的 IP, 限流无效).
  const fwd = (req.headers['x-forwarded-for'] as string) || (req.headers['x-real-ip'] as string) || ''
  const clientIp = fwd ? fwd.split(',')[0].trim() : ''

  try {
    let body: BodyInit | undefined
    const headers: Record<string, string> = {}
    if (clientIp) {
      headers['X-Forwarded-For'] = clientIp
      headers['X-Real-IP'] = clientIp
    }

    if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
      // 优先用 Vercel 自动解析的 req.body（JSON 请求）
      if (req.body !== undefined && req.body !== null && !reqCT.includes('multipart/form-data')) {
        if (typeof req.body === 'string') {
          body = req.body
        } else if (Buffer.isBuffer(req.body)) {
          body = new Uint8Array(req.body)
        } else {
          body = JSON.stringify(req.body)
        }
        headers['Content-Type'] = reqCT || 'application/json'
      } else {
        // 没有解析的 body，自己读 raw 流（multipart 文件上传 / 二进制）
        const raw = await readRawBody(req)
        if (raw.length > 0) {
          body = new Uint8Array(raw)
          headers['Content-Type'] = reqCT || 'application/json'
          if (reqCT.includes('multipart/form-data')) {
            headers['Content-Length'] = String(raw.length)
          }
        }
      }
    }

    const upstream = await fetch(url, { method: req.method, headers, body })
    const upCT = upstream.headers.get('content-type') || ''

    // 二进制内容（音频/图片/视频）流式转发
    if (!upCT.includes('json') && !upCT.includes('text')) {
      const buf = Buffer.from(await upstream.arrayBuffer())
      res.setHeader('Content-Type', upCT || 'application/octet-stream')
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
