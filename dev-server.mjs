import { createServer } from 'http'
import { readFileSync } from 'fs'

// Load .env
try {
  for (const line of readFileSync('.env', 'utf-8').split('\n')) {
    const eq = line.indexOf('=')
    if (eq > 0) {
      const k = line.slice(0, eq).trim()
      const v = line.slice(eq + 1).trim()
      if (k && v) process.env[k] = v
    }
  }
} catch {}

async function readBody(req) {
  return new Promise(resolve => {
    let data = ''
    req.on('data', c => data += c)
    req.on('end', () => { try { resolve(JSON.parse(data)) } catch { resolve({}) } })
  })
}

async function handleChat(req, res) {
  const apiKey = process.env.DEEPSEEK_API_KEY || ''
  if (!apiKey) return send(res, 500, { error: 'DEEPSEEK_API_KEY not configured' })

  const { system, messages = [], stream = false } = await readBody(req)
  const fullMessages = [{ role: 'system', content: system }, ...messages]

  try {
    const upstream = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'deepseek-chat', messages: fullMessages, stream, max_tokens: 4096 }),
    })
    if (!upstream.ok) { res.writeHead(upstream.status); return res.end(await upstream.text()) }

    if (stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      const reader = upstream.body.getReader()
      const dec = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        for (const line of dec.decode(value, { stream: true }).split('\n')) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') { res.write('data: [DONE]\n\n'); continue }
          try {
            const text = JSON.parse(data).choices?.[0]?.delta?.content || ''
            if (text) res.write(`data: ${JSON.stringify({ delta: { text } })}\n\n`)
          } catch {}
        }
      }
      return res.end()
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(await upstream.json()))
  } catch (e) { send(res, 500, { error: e.message }) }
}

async function handlePexels(req, res) {
  const apiKey = process.env.PEXELS_API_KEY || ''
  if (!apiKey) return send(res, 500, { error: 'PEXELS_API_KEY not configured' })
  const qs = new URL(req.url, 'http://x').searchParams
  try {
    const r = await fetch(
      `https://api.pexels.com/videos/search?query=${encodeURIComponent(qs.get('query') || '')}&per_page=${qs.get('per_page') || 5}&orientation=landscape`,
      { headers: { Authorization: apiKey } }
    )
    const data = await r.json()
    const videos = (data.videos || []).map(v => ({
      id: v.id, image: v.image, duration: v.duration, url: v.url,
      video_files: v.video_files?.slice(0, 2),
    }))
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ videos }))
  } catch (e) { send(res, 500, { error: e.message }) }
}

async function handlePixabay(req, res) {
  const apiKey = process.env.PIXABAY_API_KEY || ''
  if (!apiKey) return send(res, 500, { error: 'PIXABAY_API_KEY not configured' })
  const qs = new URL(req.url, 'http://x').searchParams
  try {
    const r = await fetch(
      `https://pixabay.com/api/videos/?key=${apiKey}&q=${encodeURIComponent(qs.get('query') || '')}&per_page=${qs.get('per_page') || 5}&video_type=film`
    )
    const data = await r.json()
    const hits = (data.hits || []).map(v => ({
      id: v.id, duration: v.duration, previewURL: v.previewURL,
      videos: { medium: { thumbnail: v.videos?.medium?.thumbnail }, small: { url: v.videos?.small?.url } },
    }))
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ hits }))
  } catch (e) { send(res, 500, { error: e.message }) }
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:5174')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }

  const path = new URL(req.url, 'http://x').pathname
  if (path === '/api/chat'    && req.method === 'POST') return handleChat(req, res)
  if (path === '/api/pexels')                           return handlePexels(req, res)
  if (path === '/api/pixabay')                          return handlePixabay(req, res)
  send(res, 404, { error: 'Not found' })
}).listen(3001, () => console.log('✓ API server → http://localhost:3001'))
