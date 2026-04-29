import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { login } from '../lib/auth'

export default function Login() {
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(email, password)
      nav('/app')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-bold mb-3">M</div>
          <h1 className="text-xl font-semibold text-[var(--text)]">登录 monoi</h1>
          <p className="text-sm text-[var(--text-3)] mt-1">继续你的创作</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-[var(--text-2)]">邮箱</label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com" required
              className="bg-[var(--bg-input)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-sm text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none focus:border-indigo-500/60 transition-colors"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-[var(--text-2)]">密码</label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="输入密码" required
              className="bg-[var(--bg-input)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-sm text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none focus:border-indigo-500/60 transition-colors"
            />
          </div>

          {error && <p className="text-sm text-red-400 text-center">{error}</p>}

          <button type="submit" disabled={loading}
            className="mt-2 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors cursor-pointer">
            {loading ? '登录中...' : '登录'}
          </button>
        </form>

        <p className="text-center text-sm text-[var(--text-3)] mt-6">
          还没有账号？
          <button onClick={() => nav('/register')} className="text-indigo-400 hover:text-indigo-300 ml-1 cursor-pointer">
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
