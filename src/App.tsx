import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ToastProvider } from './components/ui/Toast'
import { AppShell } from './components/layout/AppShell'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Register from './pages/Register'
import { isLoggedIn } from './lib/auth'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  return isLoggedIn() ? <>{children}</> : <Navigate to="/login" replace/>
}

class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  reset = () => {
    localStorage.removeItem('vm-chat-store')
    localStorage.removeItem('vm-chat-store-safe-20260501')
    this.setState({ hasError: false })
    window.location.href = '/app'
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] px-4">
        <div className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 text-center">
          <div className="text-sm font-medium text-[var(--text)]">工作台加载失败</div>
          <div className="mt-2 text-xs leading-relaxed text-[var(--text-3)]">已检测到旧会话数据异常，可以一键恢复工作台。</div>
          <button onClick={this.reset} className="mt-4 px-4 py-2 rounded-lg bg-[var(--text)] text-[var(--bg)] text-sm cursor-pointer">
            恢复工作台
          </button>
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
          <Route path="/app" element={
            <ProtectedRoute>
              <AppErrorBoundary>
                <AppShell/>
              </AppErrorBoundary>
            </ProtectedRoute>
          }/>
          <Route path="*" element={<Navigate to="/" replace/>}/>
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  )
}
