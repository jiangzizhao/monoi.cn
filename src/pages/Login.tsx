import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { login, loginSms, sendSmsCode } from '../lib/auth'
import { runCaptcha } from '../lib/captcha'

type Mode = 'email' | 'sms'

export default function Login() {
  const nav = useNavigate()
  const [mode, setMode] = useState<Mode>('sms')      // 默认手机验证码 (中国用户主路径)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  const validatePhone = (p: string) => /^1\d{10}$/.test(p)

  const handleSendCode = async () => {
    setError(''); setInfo('')
    if (!validatePhone(phone)) { setError('请输入正确的 11 位手机号'); return }
    setSendingCode(true)
    try {
      // 包一层 runCaptcha — env 配了就先弹滑块, 没配直接执行业务
      const r = await runCaptcha<{ dev_code?: string }>(async (param) => {
        try {
          const res = await sendSmsCode(phone, 'login', param)
          return { captchaPassed: true, bizOk: true, data: res }
        } catch (e: any) {
          const msg = String(e?.message || '发送失败')
          return { captchaPassed: !msg.includes('人机验证'), bizOk: false, error: msg }
        }
      })
      if (r.ok) {
        setCooldown(60)
        setInfo(r.data?.dev_code ? `验证码已发送 (mock: ${r.data.dev_code})` : '验证码已发送, 5 分钟内有效')
      } else {
        setError(r.error || '发送失败')
      }
    } finally { setSendingCode(false) }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(''); setInfo('')
    setLoading(true)
    try {
      if (mode === 'email') {
        // 邮箱去空格 + 小写, 跟后端 normalize 对齐 (避免大小写 / IME 多余空格导致登录失败)
        await login(email.trim().toLowerCase(), password)
      } else {
        if (!validatePhone(phone)) throw new Error('手机号格式错误')
        if (smsCode.length !== 6) throw new Error('验证码 6 位')
        await loginSms(phone, smsCode)
      }
      // force full reload, 让 chatStore 用新 user_id 重新 hydrate localStorage
      window.location.href = '/app'
    } catch (err: any) {
      setError(err.message)
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <img src="/logo.png" alt="monoi" className="w-12 h-12 mb-3 object-contain"/>
          <h1 className="text-xl font-semibold text-[var(--text)]">登录 monoi</h1>
          <p className="text-sm text-[var(--text-3)] mt-1">继续你的创作</p>
        </div>

        {/* 模式切换 tab */}
        <div className="flex border border-[var(--border)] rounded-xl p-0.5 mb-4 bg-[var(--bg-card)]">
          {[
            { k: 'sms' as Mode, l: '手机验证码' },
            { k: 'email' as Mode, l: '邮箱密码' },
          ].map(m => (
            <button key={m.k} type="button" onClick={() => { setMode(m.k); setError(''); setInfo('') }}
              className={`flex-1 py-2 text-sm rounded-lg cursor-pointer transition-colors ${
                mode === m.k ? 'bg-[var(--text)] text-[var(--bg)]' : 'text-[var(--text-2)] hover:text-[var(--text)]'
              }`}>
              {m.l}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {mode === 'sms' ? (
            <>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm text-[var(--text-2)]">手机号</label>
                <input
                  type="tel" value={phone}
                  onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
                  placeholder="11 位手机号" required maxLength={11}
                  className="bg-[var(--bg-input)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-sm text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none focus:border-[var(--text-3)] transition-colors"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm text-[var(--text-2)]">短信验证码</label>
                <div className="flex gap-2">
                  <input
                    type="text" value={smsCode}
                    onChange={e => setSmsCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="6 位验证码" required maxLength={6}
                    className="flex-1 bg-[var(--bg-input)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-sm text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none focus:border-[var(--text-3)] transition-colors"
                  />
                  <button type="button" onClick={handleSendCode}
                    disabled={sendingCode || cooldown > 0 || !validatePhone(phone)}
                    className="px-3 rounded-xl text-xs text-[var(--text)] border border-[var(--border)] hover:bg-[var(--bg-hover)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap transition-colors">
                    {sendingCode ? '发送中' : cooldown > 0 ? `${cooldown}s 后重发` : '发送验证码'}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm text-[var(--text-2)]">邮箱</label>
                <input
                  type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="your@email.com" required
                  autoCapitalize="off" autoCorrect="off" spellCheck={false} autoComplete="email"
                  className="bg-[var(--bg-input)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-sm text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none focus:border-[var(--text-3)] transition-colors"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm text-[var(--text-2)]">密码</label>
                <input
                  type="password" value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="输入密码" required
                  autoCapitalize="off" autoCorrect="off" spellCheck={false} autoComplete="current-password"
                  className="bg-[var(--bg-input)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-sm text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none focus:border-[var(--text-3)] transition-colors"
                />
              </div>
            </>
          )}

          {error && <p className="text-sm text-red-400 text-center">{error}</p>}
          {info && <p className="text-xs text-green-500 text-center">{info}</p>}

          <button type="submit" disabled={loading}
            className="mt-2 py-2.5 bg-[var(--text)] hover:opacity-80 disabled:opacity-40 text-[var(--bg)] rounded-xl text-sm font-medium transition-all cursor-pointer">
            {loading ? '登录中...' : '登录'}
          </button>
        </form>

        <p className="text-center text-sm text-[var(--text-3)] mt-6">
          还没有账号？
          <button onClick={() => nav('/register')} className="text-[var(--text-2)] hover:text-[var(--text)] ml-1 cursor-pointer underline underline-offset-2">
            免费注册
          </button>
        </p>
        <p className="text-center text-sm text-[var(--text-3)] mt-2">
          <button onClick={() => nav('/')} className="hover:text-[var(--text-2)] cursor-pointer">
            ← 返回首页
          </button>
        </p>
      </div>
    </div>
  )
}
