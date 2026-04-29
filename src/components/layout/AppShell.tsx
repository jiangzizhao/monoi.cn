import { useState, useEffect, useRef } from 'react'
import { Menu, Plus } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { ChatContainer } from '../chat/ChatContainer'
import { ChatInput } from '../chat/ChatInput'
import { useChatStore } from '../../store/chatStore'

export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [moduleMenu, setModuleMenu] = useState<string | null>(null)
  const { newConversation } = useChatStore()
  const initRef = useRef(false)

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
        {/* Mobile header */}
        <div className="lg:hidden flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <button onClick={() => setSidebarOpen(true)} className="p-2 rounded-lg text-[var(--text-2)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors">
            <Menu size={20}/>
          </button>
          <span className="text-sm font-semibold text-[var(--text)]">monoi</span>
          <button onClick={() => newConversation()} className="p-2 rounded-lg text-[var(--text-2)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors">
            <Plus size={20}/>
          </button>
        </div>

        <ChatContainer onModuleClick={setModuleMenu}/>
        <ChatInput moduleMenu={moduleMenu} onModuleMenuClose={() => setModuleMenu(null)}/>
      </div>
    </div>
  )
}
