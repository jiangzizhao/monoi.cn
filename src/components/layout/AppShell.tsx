import { useState, useEffect } from 'react'
import { Menu, Plus } from 'lucide-react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { useChatStore } from '../../store/chatStore'
import { fetchMyProfile, type UserProfile } from '../../services/billing'
import { isLoggedIn } from '../../lib/auth'

/** Layout 壳: sidebar + 顶部 tab bar + Outlet (各 tab 的内容). 不再含 chat 业务逻辑.
 * Chat 那块逻辑剥到 pages/ChatTab.tsx, 各 tab 独立 page. */
export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [me, setMe] = useState<UserProfile | null>(null)
  const { newConversation } = useChatStore()
  const location = useLocation()
  // 只在创作 tab 下显示"+" 新对话按钮 (其他 tab 没对话)
  const showNewChatBtn = location.pathname === '/app/chat' || location.pathname === '/app'

  useEffect(() => {
    const reload = () => {
      if (isLoggedIn()) fetchMyProfile().then(setMe).catch(() => {})
    }
    reload()
    window.addEventListener('monoi:profile-updated', reload)
    return () => window.removeEventListener('monoi:profile-updated', reload)
  }, [])

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg)]">
      {/* Desktop sidebar */}
      <div className="hidden lg:block w-72 flex-shrink-0">
        <Sidebar/>
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div className="w-72 flex-shrink-0 h-full">
            <Sidebar onClose={() => setSidebarOpen(false)}/>
          </div>
          <div className="flex-1 bg-black/50 backdrop-blur-sm" onClick={() => setSidebarOpen(false)}/>
        </div>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-[var(--bg-chat)]">
        {/* Mobile header */}
        <div className="lg:hidden flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <button onClick={() => setSidebarOpen(true)} className="p-2 rounded-lg text-[var(--text-2)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors">
            <Menu size={20}/>
          </button>
          <span className="text-sm font-semibold text-[var(--text)]">monoi</span>
          <div className="flex items-center gap-1">
            {showNewChatBtn && (
              <button onClick={() => newConversation()} className="p-2 rounded-lg text-[var(--text-2)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors" title="新对话">
                <Plus size={20}/>
              </button>
            )}
            <Link to="/app/account" className="p-1 rounded-full hover:opacity-80 cursor-pointer transition-opacity" title="账户中心">
              <div className="w-8 h-8 rounded-full bg-[var(--text)] text-[var(--bg)] flex items-center justify-center text-xs font-bold overflow-hidden">
                {me?.avatar_url ? (
                  <img src={me.avatar_url} alt="" className="w-full h-full object-cover"/>
                ) : (
                  <span>{me?.username?.[0]?.toUpperCase() || 'M'}</span>
                )}
              </div>
            </Link>
          </div>
        </div>

        {/* 各 tab 内容 — 顶部 tab bar 在 Sidebar 顶部, 不在这里 */}
        <Outlet/>
      </div>
    </div>
  )
}
