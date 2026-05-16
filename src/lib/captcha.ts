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

function getSceneId(): string {
  return (import.meta as any).env?.VITE_ALIYUN_CAPTCHA_SCENE_ID || ''
}

// prefix (身份标) 在阿里云控制台"概览页面"的"实例基本信息"里, 不是场景列表的 SceneId.
// SDK 用它拼 API 子域名 lkrpagye.captcha-open-aliyuncs.com — 没有 prefix SDK 连 URL 都拼不出, 静默 Network Error.
// 老 env 通常已经配过, 没配就用 SceneId 兜底 (账号下单场景时常一样).
function getPrefix(): string {
  return (import.meta as any).env?.VITE_ALIYUN_CAPTCHA_PREFIX || getSceneId()
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
    // popup 模式只是给 SDK 一个挂载点, 真正的滑块弹窗 SDK 自己 portal 到 body, 不依赖这个 div 可见
    document.body.appendChild(div)
  }
  if (!document.getElementById(BUTTON_ID)) {
    const btn = document.createElement('button')
    btn.id = BUTTON_ID
    btn.type = 'button'
    btn.setAttribute('aria-hidden', 'true')
    btn.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;'
    document.body.appendChild(btn)
  }
}

// 捕获 SDK 自己抛的 unhandled rejection (Network Error 等), 帮 debug
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (e) => {
    const msg = String(e.reason?.message || e.reason || '')
    if (msg.includes('etwork') || msg.includes('aptcha')) {
      console.error('[captcha] SDK 内部 unhandled rejection:', e.reason)
    }
  })
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
let _pendingTimer: ReturnType<typeof setTimeout> | null = null

// 统一收尾: 清 timer + 重置 state + resolve 外面的 promise (避免按钮永远"发送中")
function finishPending<T>(result: RunResult<T>) {
  if (_pendingTimer) { clearTimeout(_pendingTimer); _pendingTimer = null }
  const r = _pendingResolve
  _pendingResolve = null
  _pendingOnVerified = null
  _captured = null
  if (r) r(result)
}

function init(): Promise<void> {
  if (_initPromise) return _initPromise
  _initPromise = (async () => {
    console.log('[captcha] loadSDK 开始')
    await loadSDK()
    console.log('[captcha] loadSDK 完成, initAliyunCaptcha 存在?', typeof (window as any).initAliyunCaptcha)
    ensureDOM()
    const sceneId = getSceneId()
    const prefix = getPrefix()
    console.log('[captcha] 准备 init, sceneId =', sceneId, 'prefix =', prefix)
    await new Promise<void>((resolve, reject) => {
      // 10s 超时, 防 SDK 静默挂死
      const timer = setTimeout(() => reject(new Error('SDK init 超时 10s — getInstance 没回调')), 10000)
      try {
        ;(window as any).initAliyunCaptcha({
          SceneId: sceneId,
          prefix: prefix,
          mode: 'popup',
          element: '#' + CONTAINER_ID,
          button: '#' + BUTTON_ID,
          captchaVerifyCallback: async (captchaVerifyParam: string) => {
            console.log('[captcha] captchaVerifyCallback 被调, param 长度=', captchaVerifyParam?.length)
            if (!_pendingOnVerified) {
              return { captchaResult: true, bizResult: false }
            }
            _captured = await _pendingOnVerified(captchaVerifyParam)
            return { captchaResult: _captured.captchaPassed, bizResult: _captured.bizOk }
          },
          onBizResultCallback: (bizResult: boolean) => {
            console.log('[captcha] onBizResultCallback bizResult=', bizResult)
            finishPending(bizResult ? { ok: true } : { ok: false, error: '滑块未通过, 请重试' })
          },
          // 用户关闭/取消弹窗时 SDK 触发 (要不没这回调 _pendingResolve 永远卡, 按钮"发送中"卡死)
          cancelCallback: () => {
            console.log('[captcha] cancelCallback — 用户关闭弹窗')
            finishPending({ ok: false, error: '已取消验证' })
          },
          getInstance: (instance: any) => {
            console.log('[captcha] getInstance 回调, instance =', instance)
            clearTimeout(timer)
            resolve()
          },
          language: 'cn',
        })
        console.log('[captcha] initAliyunCaptcha 同步调用完成, 等 getInstance')
      } catch (e) {
        console.error('[captcha] initAliyunCaptcha 抛错:', e)
        clearTimeout(timer)
        reject(e)
      }
    })
    console.log('[captcha] init 完整完成')
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
  console.log('[captcha] runCaptcha 被调')
  if (!getSceneId()) {
    console.log('[captcha] SceneId 没配, 跳过 captcha')
    const r = await onVerified('')
    return { ok: r.bizOk, data: r.data, error: r.error }
  }
  try {
    await init()
  } catch (e: any) {
    console.error('[captcha] init 失败:', e)
    return { ok: false, error: e?.message || 'SDK 初始化失败' }
  }
  console.log('[captcha] init 通过, 触发 instance.show 或 button click')
  return new Promise<RunResult<T>>((resolve) => {
    _pendingResolve = resolve as any
    _pendingOnVerified = onVerified as any
    _captured = null
    // 60s 总超时, 防 SDK 不回调时按钮永远"发送中"
    _pendingTimer = setTimeout(() => {
      console.warn('[captcha] 60s 超时, 强制收尾')
      finishPending({ ok: false, error: '验证超时, 请重试' })
    }, 60000)

    // popup 模式必须靠 button click 触发 (instance.show 在无痕场景下不会跑 silent verify),
    // 程序点 hidden button → SDK 弹滑块 / 静默判定 → captchaVerifyCallback 回调.
    const btn = document.getElementById(BUTTON_ID) as HTMLButtonElement | null
    if (btn) {
      console.log('[captcha] 触发 hidden button click')
      btn.click()
    } else {
      console.log('[captcha] BUTTON 不在')
      finishPending({ ok: false, error: 'captcha button 未找到' })
    }
  })
}
