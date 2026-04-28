import { Plus, Trash2, MessageSquare } from 'lucide-react'
import { useChatStore } from '../../store/chatStore'

function timeAgo(ts: number) {
  const diff = Date.now() - ts
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
  return `${Math.floor(diff / 86400000)}天前`
}

export function Sidebar({ onClose }: { onClose?: () => void }) {
  const { conversations, activeId, setActiveId, newConversation, deleteConversation } = useChatStore()

  const handleNew = () => {
    newConversation()
    onClose?.()
  }

  const handleSelect = (id: string) => {
    setActiveId(id)
    onClose?.()
  }

  return (
    <div className="flex flex-col h-full bg-[var(--bg)] border-r border-[var(--border)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white text-xs font-bold">V</div>
          <span className="text-sm font-semibold text-[var(--text)]">monoi</span>
        </div>
        <button onClick={handleNew}
          className="p-1.5 rounded-lg text-[var(--text-3)] hover:text-[var(--text-2)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
          title="新对话">
          <Plus size={16}/>
        </button>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto py-2 px-2">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-[var(--text-3)]">
            <MessageSquare size={20} strokeWidth={1.5}/>
            <span className="text-xs">还没有对话</span>
          </div>
        ) : (
          conversations.map(conv => {
            const isActive = conv.id === activeId
            return (
              <div key={conv.id}
                className={`group flex items-center gap-2 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-150 mb-0.5 ${isActive ? 'bg-[var(--bg-hover)] text-[var(--text)]' : 'text-[var(--text-2)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'}`}
                onClick={() => handleSelect(conv.id)}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{conv.title}</div>
                  <div className="text-[10px] text-[var(--text-3)] mt-0.5">{timeAgo(conv.updatedAt)}</div>
                </div>
                <button onClick={e => { e.stopPropagation(); deleteConversation(conv.id) }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--text-3)] hover:text-red-400 transition-all cursor-pointer">
                  <Trash2 size={13}/>
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
