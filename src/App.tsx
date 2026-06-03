import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ToastProvider } from './components/ui/Toast'
import { AppShell } from './components/layout/AppShell'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Register from './pages/Register'
import Account from './pages/Account'
import Admin from './pages/Admin'
import ChatTab from './pages/ChatTab'
import RecordTab from './pages/RecordTab'
import VoiceTab from './pages/VoiceTab'
import { Terms, Privacy } from './pages/Legal'
import { isLoggedIn } from './lib/auth'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  return isLoggedIn() ? <>{children}</> : <Navigate to="/login" replace/>
}

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; errMsg: string; errStack: string }
> {
  state = { hasError: false, errMsg: '', errStack: '' }

  static getDerivedStateFromError(err: Error) {
    return {
      hasError: true,
      errMsg: err?.message || String(err),
      errStack: err?.stack || '',
    }
  }

  componentDidCatch(err: Error, info: React.ErrorInfo) {
    console.error('[AppErrorBoundary]', err, info)
  }

  reset = () => {
    localStorage.removeItem('vm-chat-store')
    localStorage.removeItem('vm-chat-store-safe-20260501')
    this.setState({ hasError: false, errMsg: '', errStack: '' })
    window.location.href = '/app'
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] px-4">
        <div className="w-full max-w-2xl rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
          <div className="text-sm font-medium text-[var(--text)] text-center">工作台加载失败</div>
          <div className="mt-2 text-xs leading-relaxed text-[var(--text-3)] text-center">已检测到旧会话数据异常，可以一键恢复工作台。</div>
          {this.state.errMsg && (
            <details className="mt-3 text-[11px] text-[var(--text-3)]">
              <summary className="cursor-pointer hover:text-[var(--text-2)]">展开技术细节</summary>
              <div className="mt-2 p-2 bg-[var(--bg-input)] rounded text-red-400 break-all">
                <div className="font-medium">{this.state.errMsg}</div>
                {this.state.errStack && (
                  <pre className="mt-2 text-[10px] whitespace-pre-wrap leading-tight opacity-80">
                    {this.state.errStack.split('\n').slice(0, 12).join('\n')}
                  </pre>
                )}
              </div>
            </details>
          )}
          <div className="mt-4 text-center">
            <button onClick={this.reset} className="px-4 py-2 rounded-lg bg-[var(--text)] text-[var(--bg)] text-sm cursor-pointer">
              恢复工作台
            </button>
          </div>
        </div>
      </div>
    )
  }
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <Routes>
          <Route path="/" element={<Landing/>}/>
          <Route path="/login" element={<Login/>}/>
          <Route path="/register" element={<Register/>}/>
          {/* /app 改成 layout + 子 tab 路由. AppShell 是壳 (sidebar + topbar + outlet),
              各 tab 内容在子路由 page 里. /app 默认重定向 /app/chat (创作) */}
          <Route path="/app" element={
            <ProtectedRoute>
              <AppErrorBoundary>
                <AppShell/>
              </AppErrorBoundary>
            </ProtectedRoute>
          }>
            <Route index element={<Navigate to="/app/chat" replace/>}/>
            <Route path="chat"   element={<ChatTab/>}/>
            <Route path="record" element={<RecordTab/>}/>
            <Route path="voice"  element={<VoiceTab/>}/>
          </Route>
          <Route path="/app/account" element={
            <ProtectedRoute>
              <Account/>
            </ProtectedRoute>
          }/>
          <Route path="/admin" element={
            <ProtectedRoute>
              <Admin/>
            </ProtectedRoute>
          }/>
          <Route path="/terms" element={<Terms/>}/>
          <Route path="/privacy" element={<Privacy/>}/>
          <Route path="*" element={<Navigate to="/" replace/>}/>
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  )
}
