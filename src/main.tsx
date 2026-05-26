import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installSessionGuard } from './lib/sessionGuard'

// 全局 fetch 拦截 — 检测严格单设备 kick (后端返 401 + detail 含 'session_kicked')
installSessionGuard()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
