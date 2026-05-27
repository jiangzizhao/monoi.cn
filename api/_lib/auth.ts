// 公共 JWT 鉴权 helper — 给 api/ 下所有 Vercel function 用.
// Vercel 把 api/ 下任何 .ts 都当 endpoint, 但 api/_lib/ 子目录里的不会暴露
// (Vercel 把 _ 开头的子目录视为内部, 不路由).
//
// 用法:
//   import { verifyJWT, requireAuth } from './_lib/auth'
//   const payload = requireAuth(req, res)  // 返 payload, 或 send 401 后返 null
//   if (!payload) return
//   // ... 业务逻辑

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createHmac } from 'node:crypto'

export interface JWTPayload {
  sub?: string
  iat?: number
  exp?: number
  username?: string
}

/** JWT 验签 (HS256). 跟后端 main.py SECRET_KEY 一致. */
export function verifyJWT(token: string, secret: string): JWTPayload | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const [headerB64, payloadB64, sigB64] = parts
    const expected = createHmac('sha256', secret).update(`${headerB64}.${payloadB64}`).digest()
    const expectedB64 = expected.toString('base64url')
    if (expectedB64 !== sigB64) return null
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'))
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

/** 从 request 头拿 Bearer token, 验签. 401 时自动给 res send response, 返 null.
 * 业务代码: `const payload = requireAuth(req, res); if (!payload) return;` */
export function requireAuth(req: VercelRequest, res: VercelResponse): JWTPayload | null {
  const authHeader = String(req.headers.authorization || req.headers.Authorization || '')
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) {
    res.status(401).json({ error: 'Unauthorized: 请登录' })
    return null
  }
  const secret = process.env.JWT_SECRET_KEY || 'monoi-secret-key-2025'
  const payload = verifyJWT(token, secret)
  if (!payload || !payload.sub) {
    res.status(401).json({ error: 'Unauthorized: token 无效或已过期' })
    return null
  }
  return payload
}
