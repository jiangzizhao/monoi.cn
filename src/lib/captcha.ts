/**
 * 阿里云人机验证 (Captcha 2.0) 前端封装 — 按官方文档:
 * https://help.aliyun.com/zh/captcha/web-and-h5-client-v2-architecture-access
 *
 * env: VITE_ALIYUN_CAPTCHA_SCENE_ID — 控制台 → 验证场景列表 → 该场景的"场景ID"
 *
 * 关键: popup 模式必须有 button 字段绑事件, 但程序触发 button.click() 浏览器可能挡;
 * 用 getInstance 拿到 instance 后调 instance.show() 直接触发更稳, 不依赖按钮点击.
 */

const SDK_URL = 'https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js'
const CONTAINER_ID = 'aliyun-captcha-container'
const BUTTON_ID = 'aliyun-captcha-trigger'

let _sdkLoading: Promise<void> | null = null
let _initPromise: Promise<void> | null = null
let _instance: any = null

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
    // 不能加 pointer-events:none, SDK 用事件代理可能要靠它
    btn.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;'
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

let _pendingResolve: ((r: RunResult<any>) => void) | null = null
let _pendingOnVerified: ((p: string) => Promise<VerifyOutcome<any>>) | null = null
let _captured: VerifyOutcome<any> | null = null

function init(): Promise<void> {
  if (_initPromise) return _initPromise
  _initPromise = (async () => {
    await loadSDK()
    ensureDOM()
    await new Promise<void>((resolve) => {
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
        getInstance: (instance: any) => {
          _instance = instance
          resolve()    // 拿到 instance 才算 init 完成
        },
        language: 'cn',
      })
    })
  })()
  return _initPromise
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
    await init()
  } catch (e: any) {
    return { ok: false, error: e?.message || 'SDK 初始化失败' }
  }
  return new Promise<RunResult<T>>((resolve) => {
    _pendingResolve = resolve
    _pendingOnVerified = onVerified as any
    _captured = null
    // 直接调 instance.show() 触发, 不依赖 button click (浏览器可能挡程序触发的弹窗)
    if (_instance && typeof _instance.show === 'function') {
      _instance.show()
    } else {
      // fallback: 触发隐藏 button click
      const btn = document.getElementById(BUTTON_ID) as HTMLButtonElement | null
      btn?.click()
    }
  })
}
