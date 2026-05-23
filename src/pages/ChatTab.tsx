// 创作 tab — 把原 AppShell 里 chat 那部分剥离出来.
// AppShell 现在只剩 layout (sidebar + topbar + outlet), 各 tab 各自的内容在这种 page 里.

import { useEffect, useRef, useState } from 'react'
import { ChatContainer } from '../components/chat/ChatContainer'
import { ChatInput } from '../components/chat/ChatInput'
import { useChatStore } from '../store/chatStore'

export default function ChatTab() {
  const [moduleMenu, setModuleMenu] = useState<string | null>(null)
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
    <div className="flex-1 flex flex-col min-h-0 bg-[var(--bg-chat)]">
      <ChatContainer/>
      <ChatInput moduleMenu={moduleMenu} onModuleClick={setModuleMenu} onModuleMenuClose={() => setModuleMenu(null)}/>
    </div>
  )
}
