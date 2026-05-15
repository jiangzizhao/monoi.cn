/**
 * 阿里云人机验证 (Captcha 2.0) 前端封装.
 *
 * env (Vercel 上配, 跟后端 ALIYUN_CAPTCHA_SCENE_ID 同一个 SceneId):
 *   VITE_ALIYUN_CAPTCHA_SCENE_ID
 *   VITE_ALIYUN_CAPTCHA_PREFIX
 * 没配 → runCaptcha 直接放过 (不弹滑块, 后端也是 env-gated 跳过校验), 跟开发期 SMS mock 一致.
 *
 * 用法 (典型: 包发送验证码):
 *   const r = await runCaptcha(async (captchaParam) => {
 *     try {
 *       const res = await sendSmsCode(phone, 'login', captchaParam)
 *       return { captchaPassed: true, bizOk: true, data: res }
 *     } catch (e: any) {
 *       const captchaFailed = String(e.message).includes('人机验证')
 *       return { captchaPassed: !captchaFailed, bizOk: false, error: e.message }
 *     }
 *   })
 *   if (r.ok) { ... 发送成功 ... } else { setError(r.error) }
 */

const SDK_URL = 'https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js'
const CONTAINER_ID = 'aliyun-captcha-container'

let _sdkLoading: Promise<void> | null = null

function getConfig(): { sceneId: string; prefix: string } | null {
  const sceneId = (import.meta as any).env?.VITE_ALIYUN_CAPTCHA_SCENE_ID || ''
  const prefix = (import.meta as any).env?.VITE_ALIYUN_CAPTCHA_PREFIX || ''
  if (!sceneId || !prefix) return null
  return { sceneId, prefix }
}

export function captchaEnabled(): boolean {
  return getConfig() !== null
}

function loadSDK(): Promise<void> {
  if ((window as any).initAliyunCaptcha) return Promise.resolve()
  if (_sdkLoading) return _sdkLoading
  _sdkLoading = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SDK_URL
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('阿里云人机验证 SDK 加载失败 (网络问题?)'))
    document.head.appendChild(s)
  })
  return _sdkLoading
}

function ensureContainer(): void {
  if (document.getElementById(CONTAINER_ID)) return
  const div = document.createElement('div')
  div.id = CONTAINER_ID
  document.body.appendChild(div)
}

export interface VerifyOutcome<T> {
  captchaPassed: boolean      // 阿里云后端校验通过吗 (true → SDK 不让重滑; false → SDK 让重滑)
  bizOk: boolean              // 业务执行成功吗 (发短信成功 = true; 限流/格式错 = false)
  data?: T
  error?: string
}

export interface RunResult<T> {
  ok: boolean
  data?: T
  error?: string
}

/**
 * 弹滑块 → 用户完成后调用 onVerified(captchaParam) → 根据返回控制 SDK 显示成功/失败 UI.
 * env 没配时跳过滑块直接执行 onVerified('').
 */
export async function runCaptcha<T>(
  onVerified: (captchaVerifyParam: string) => Promise<VerifyOutcome<T>>,
): Promise<RunResult<T>> {
  const cfg = getConfig()
  if (!cfg) {
    const r = await onVerified('')
    return { ok: r.bizOk, data: r.data, error: r.error }
  }

  await loadSDK()
  ensureContainer()

  return new Promise<RunResult<T>>((resolve) => {
    let captured: VerifyOutcome<T> | null = null

    ;(window as any).initAliyunCaptcha({
      SceneId: cfg.sceneId,
      prefix: cfg.prefix,
      mode: 'popup',
      element: '#' + CONTAINER_ID,
      captchaVerifyCallback: async (captchaVerifyParam: string) => {
        try {
          captured = await onVerified(captchaVerifyParam)
          return { captchaResult: captured.captchaPassed, bizResult: captured.bizOk }
        } catch (e: any) {
          captured = { captchaPassed: true, bizOk: false, error: e?.message || '请求失败' }
          return { captchaResult: true, bizResult: false }
        }
      },
      onBizResultCallback: (bizResult: boolean) => {
        const o = captured || { captchaPassed: true, bizOk: bizResult }
        resolve({ ok: o.bizOk, data: o.data, error: o.error })
      },
      language: 'cn',
      region: 'cn',
    })
  })
}
