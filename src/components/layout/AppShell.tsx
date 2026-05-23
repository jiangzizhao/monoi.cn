import { useState, useEffect, useRef } from 'react'
import { Menu, Plus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { ChatContainer } from '../chat/ChatContainer'
import { ChatInput } from '../chat/ChatInput'
import { useChatStore } from '../../store/chatStore'
import { fetchMyProfile, type UserProfile } from '../../services/billing'
import { isLoggedIn } from '../../lib/auth'

export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [moduleMenu, setModuleMenu] = useState<string | null>(null)
  const [me, setMe] = useState<UserProfile | null>(null)
  const { newConversation } = useChatStore()
  const initRef = useRef(false)

  useEffect(() => {
    const reload = () => {
      if (isLoggedIn()) fetchMyProfile().then(setMe).catch(() => {})
    }
    reload()
    // Account 改完头像/用户名后会 dispatch 这个事件, 听到就重新拉一遍
    window.addEventListener('monoi:profile-updated', reload)
    return () => window.removeEventListener('monoi:profile-updated', reload)
  }, [])

  useEffect(() => {
    if (initRef.current) return
    initRef.current = true
    const state = useChatStore.getState()
    if (!state.activeId && state.conversations.length === 0) {
      state.newConversation()
    } else if (!state.activeId && state.conversations.length > 0) {
      state.setActiveId(state.conversations[0].id)
    }
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
        {/* Mobile/Tablet header (lg 以下显示) */}
        <div className="lg:hidden flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <button onClick={() => setSidebarOpen(true)} className="p-2 rounded-lg text-[var(--text-2)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors">
            <Menu size={20}/>
          </button>
          <span className="text-sm font-semibold text-[var(--text)]">monoi</span>
          <div className="flex items-center gap-1">
            <button onClick={() => newConversation()} className="p-2 rounded-lg text-[var(--text-2)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors" title="新对话">
              <Plus size={20}/>
            </button>
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

        <ChatContainer/>
        <ChatInput moduleMenu={moduleMenu} onModuleClick={setModuleMenu} onModuleMenuClose={() => setModuleMenu(null)}/>
      </div>
    </div>
  )
}
