import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { register, sendSmsCode } from '../lib/auth'

export default function Register() {
  const nav = useNavigate()
  const [searchParams] = useSearchParams()
  const refFromUrl = searchParams.get('ref') || ''         // 从推广链接来的

  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [password, setPassword] = useState('')
  const [referralCode, setReferralCode] = useState(refFromUrl)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [cooldown, setCooldown] = useState(0)              // 重发冷却秒数

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  const validatePhone = (p: string) => /^1\d{10}$/.test(p)

  const handleSendCode = async () => {
    setError('')
    setInfo('')
    if (!validatePhone(phone)) {
      setError('请输入正确的 11 位手机号')
      return
    }
    setSendingCode(true)
    try {
      const r = await sendSmsCode(phone, 'register')
      setCooldown(60)
      setInfo(r.dev_code ? `验证码已发送 (mock: ${r.dev_code})` : '验证码已发送, 5 分钟内有效')
    } catch (e: any) {
      setError(e.message || '发送失败')
    } finally {
      setSendingCode(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setInfo('')
    if (!validatePhone(phone)) {
      setError('手机号格式错误')
      return
    }
    if (smsCode.length !== 6) {
      setError('验证码 6 位')
      return
    }
    setLoading(true)
    try {
      await register(username, email, password, phone, smsCode, referralCode || undefined)
      nav('/login')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-10 h-10 rounded-xl bg-[var(--text)] flex items-center justify-center text-[var(--bg)] font-bold mb-3">M</div>
          <h1 className="text-xl font-semibold text-[var(--text)]">注册 monoi</h1>
          <p className="text-sm text-[var(--text-3)] mt-1">免费开始你的创作</p>
          {refFromUrl && (
            <p className="text-xs text-amber-500 mt-2">🎁 通过 {refFromUrl} 邀请注册, 注册成功送 30 积分</p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-[var(--text-2)]">用户名</label>
            <input
              type="text" value={username} onChange={e => setUsername(e.target.value)}
              placeholder="你的昵称" required
              className="bg-[var(--bg-input)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-sm text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none focus:border-[var(--text-3)] transition-colors"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-[var(--text-2)]">手机号</label>
            <input
              type="tel" value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
              placeholder="11 位手机号" required maxLength={11}
              className="bg-[var(--bg-input)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-sm text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none focus:border-[var(--text-3)] transition-colors"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-[var(--text-2)]">短信验证码</label>
            <div className="flex gap-2">
              <input
                type="text" value={smsCode} onChange={e => setSmsCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="6 位验证码" required maxLength={6}
                className="flex-1 bg-[var(--bg-input)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-sm text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none focus:border-[var(--text-3)] transition-colors"
              />
              <button
                type="button"
                onClick={handleSendCode}
                disabled={sendingCode || cooldown > 0 || !validatePhone(phone)}
                className="px-3 rounded-xl text-xs text-[var(--text)] border border-[var(--border)] hover:bg-[var(--bg-hover)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap transition-colors"
              >
                {sendingCode ? '发送中' : cooldown > 0 ? `${cooldown}s 后重发` : '发送验证码'}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-[var(--text-2)]">邮箱 <span className="text-[10px] text-[var(--text-3)]">(用于找回密码)</span></label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com" required
              className="bg-[var(--bg-input)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-sm text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none focus:border-[var(--text-3)] transition-colors"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-[var(--text-2)]">密码</label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="至少 6 位" required minLength={6}
              className="bg-[var(--bg-input)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-sm text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none focus:border-[var(--text-3)] transition-colors"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-[var(--text-2)]">推广码 <span className="text-[10px] text-[var(--text-3)]">(选填, 注册送 30 积分)</span></label>
            <input
              type="text" value={referralCode} onChange={e => setReferralCode(e.target.value.toUpperCase())}
              placeholder="例: M1ABCD"
              className="bg-[var(--bg-input)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-sm text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none focus:border-[var(--text-3)] transition-colors font-mono"
            />
          </div>

          {error && <p className="text-sm text-red-400 text-center">{error}</p>}
          {info && <p className="text-xs text-green-500 text-center">{info}</p>}

          <button type="submit" disabled={loading}
            className="mt-2 py-2.5 bg-[var(--text)] hover:opacity-80 disabled:opacity-40 text-[var(--bg)] rounded-xl text-sm font-medium transition-all cursor-pointer">
            {loading ? '注册中...' : '免费注册'}
          </button>
        </form>

        <p className="text-center text-sm text-[var(--text-3)] mt-6">
          已有账号？
          <button onClick={() => nav('/login')} className="text-[var(--text-2)] hover:text-[var(--text)] ml-1 cursor-pointer underline underline-offset-2">
            直接登录
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
