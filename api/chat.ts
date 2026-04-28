import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const apiKey = process.env.DEEPSEEK_API_KEY || ''
  if (!apiKey) return res.status(500).json({ error: 'DEEPSEEK_API_KEY not configured' })

  const { system, messages, stream = false } = req.body

  // DeepSeek uses OpenAI-compatible format: system goes as first message
  const fullMessages = [
    { role: 'system', content: system },
    ...messages,
  ]

  try {
    const upstream = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: fullMessages,
        stream,
        max_tokens: 4096,
      }),
    })

    if (!upstream.ok) return res.status(upstream.status).send(await upstream.text())

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      const reader = upstream.body!.getReader()
      const dec = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = dec.decode(value, { stream: true })
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') { res.write('data: [DONE]\n\n'); continue }
          try {
            const p = JSON.parse(data)
            const text = p.choices?.[0]?.delta?.content || ''
            if (text) res.write(`data: ${JSON.stringify({ delta: { text } })}\n\n`)
          } catch {}
        }
      }
      return res.end()
    }

    return res.json(await upstream.json())
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }
}
