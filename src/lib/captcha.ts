/**
 * 阿里云人机验证 (Captcha 2.0) 前端封装 — 按官方文档:
 * https://help.aliyun.com/zh/captcha/web-and-h5-client-v2-architecture-access
 *
 * env (Vercel 上配, 跟后端 ALIYUN_CAPTCHA_SCENE_ID 同一个 SceneId):
 *   VITE_ALIYUN_CAPTCHA_SCENE_ID — 控制台 → 验证场景列表 → 该场景的"场景ID"
 *
 * SDK 行为: 必须先 init (绑定一个 button selector), 后续通过点击该 button 触发滑块.
 * 我们用一个隐藏 button, init 一次, 每次 runCaptcha 时程序触发其 click.
 */

const SDK_URL = 'https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js'
const CONTAINER_ID = 'aliyun-captcha-container'
const BUTTON_ID = 'aliyun-captcha-trigger'

let _sdkLoading: Promise<void> | null = null
let _initialized = false

function getSceneId(): string {
  return (import.meta as any).env?.VITE_ALIYUN_CAPTCHA_SCENE_ID || ''
}

export function captchaEnabled(): boolean {
  return !!getSceneId()
}

function loadSDK(): Promise<void> {
  if ((window as any).initAliyunCaptcha) return Promise.resolve()
  if (_sdkLoading) return _sdkLoading
  _sdkLoading = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SDK_URL
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('阿里云人机验证 SDK 加载失败'))
    document.head.appendChild(s)
  })
  return _sdkLoading
}

function ensureDOM(): void {
  if (!document.getElementById(CONTAINER_ID)) {
    const div = document.createElement('div')
    div.id = CONTAINER_ID
    document.body.appendChild(div)
  }
  if (!document.getElementById(BUTTON_ID)) {
    const btn = document.createElement('button')
    btn.id = BUTTON_ID
    btn.type = 'button'
    btn.setAttribute('aria-hidden', 'true')
    btn.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;'
    document.body.appendChild(btn)
  }
}

export interface VerifyOutcome<T> {
  captchaPassed: boolean
  bizOk: boolean
  data?: T
  error?: string
}

export interface RunResult<T> {
  ok: boolean
  data?: T
  error?: string
}

// 单例 state — Captcha 2.0 SDK 只能 init 一次, 后续重新点 button 触发新 session.
let _pendingResolve: ((r: RunResult<any>) => void) | null = null
let _pendingOnVerified: ((p: string) => Promise<VerifyOutcome<any>>) | null = null
let _captured: VerifyOutcome<any> | null = null

async function ensureInit(): Promise<void> {
  if (_initialized) return
  await loadSDK()
  ensureDOM()
  ;(window as any).initAliyunCaptcha({
    SceneId: getSceneId(),
    mode: 'popup',
    element: '#' + CONTAINER_ID,
    button: '#' + BUTTON_ID,
    captchaVerifyCallback: async (captchaVerifyParam: string) => {
      if (!_pendingOnVerified) {
        return { captchaResult: true, bizResult: false }
      }
      _captured = await _pendingOnVerified(captchaVerifyParam)
      return { captchaResult: _captured.captchaPassed, bizResult: _captured.bizOk }
    },
    onBizResultCallback: (bizResult: boolean) => {
      if (!_pendingResolve) return
      const c = _captured || { captchaPassed: true, bizOk: bizResult }
      _pendingResolve({ ok: c.bizOk, data: c.data, error: c.error })
      _pendingResolve = null
      _pendingOnVerified = null
      _captured = null
    },
    language: 'cn',
  })
  _initialized = true
}

/**
 * 弹滑块 → 用户完成后调 onVerified(param) → 根据返回值控制 SDK 显示成功/失败 UI.
 * env 没配时跳过滑块直接执行 onVerified('').
 */
export async function runCaptcha<T>(
  onVerified: (captchaVerifyParam: string) => Promise<VerifyOutcome<T>>,
): Promise<RunResult<T>> {
  if (!getSceneId()) {
    const r = await onVerified('')
    return { ok: r.bizOk, data: r.data, error: r.error }
  }
  try {
    await ensureInit()
  } catch (e: any) {
    return { ok: false, error: e?.message || 'SDK 初始化失败' }
  }
  return new Promise<RunResult<T>>((resolve) => {
    _pendingResolve = resolve
    _pendingOnVerified = onVerified as any
    _captured = null
    // 触发 hidden button click → SDK 弹出 captcha (popup 模式只能由 button click 触发)
    setTimeout(() => {
      const btn = document.getElementById(BUTTON_ID) as HTMLButtonElement | null
      btn?.click()
    }, 0)
  })
}
