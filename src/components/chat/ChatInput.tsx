import { useState, useRef, useEffect } from 'react'
import { ArrowUp, Square, Slash } from 'lucide-react'
import { useChatStore } from '../../store/chatStore'
import { useChat } from '../../hooks/useChat'

const SLASH_COMMANDS = [
  { cmd: '/写文案', desc: '进入文案创作流程' },
  { cmd: '/仿写', desc: '直接进入仿写模式' },
  { cmd: '/原创', desc: '直接进入原创模式' },
  { cmd: '/润色', desc: '直接进入润色模式' },
  { cmd: '/提词器', desc: '转换提词器格式' },
  { cmd: '/数字人', desc: '生成 TTS 脚本' },
  { cmd: '/找素材', desc: '进入素材匹配' },
  { cmd: '/分镜', desc: '生成剪辑分镜表' },
  { cmd: '/发布文案', desc: '生成多平台标题和简介' },
]

export function ChatInput() {
  const [text, setText] = useState('')
  const [showSlash, setShowSlash] = useState(false)
  const [slashFilter, setSlashFilter] = useState('')
  const textRef = useRef<HTMLTextAreaElement>(null)
  const { isGenerating } = useChatStore()
  const { send, stop } = useChat()

  const filteredCmds = SLASH_COMMANDS.filter(c =>
    c.cmd.includes(slashFilter) || c.desc.includes(slashFilter)
  )

  const handleChange = (v: string) => {
    setText(v)
    if (v.startsWith('/')) {
      setShowSlash(true)
      setSlashFilter(v.slice(1))
    } else {
      setShowSlash(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
    if (e.key === 'Escape') setShowSlash(false)
  }

  const handleSend = () => {
    const trimmed = text.trim()
    if (!trimmed || isGenerating) return
    setText('')
    setShowSlash(false)
    send(trimmed)
  }

  const pickCommand = (cmd: string) => {
    setText(cmd + ' ')
    setShowSlash(false)
    textRef.current?.focus()
    send(cmd)
    setText('')
  }

  // Auto resize
  useEffect(() => {
    const el = textRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [text])

  const hasText = text.trim().length > 0

  return (
    <div className="border-t border-[var(--border)] bg-[var(--bg-chat)] px-4 py-3">
      <div className="max-w-3xl mx-auto relative">
        {/* Slash menu */}
        {showSlash && filteredCmds.length > 0 && (
          <div className="absolute bottom-full left-0 right-0 mb-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl overflow-hidden shadow-2xl z-20">
            {filteredCmds.map(c => (
              <button key={c.cmd} onClick={() => pickCommand(c.cmd)}
                className="flex items-center justify-between w-full px-4 py-2.5 text-sm hover:bg-[var(--bg-hover)] transition-colors cursor-pointer">
                <span className="font-mono text-indigo-400">{c.cmd}</span>
                <span className="text-[var(--text-3)] text-xs">{c.desc}</span>
              </button>
            ))}
          </div>
        )}

        {/* Input row */}
        <div className={`flex items-end gap-2 bg-[var(--bg-input)] border rounded-2xl px-3 py-2 transition-colors ${hasText ? 'border-indigo-500/40' : 'border-[var(--border)]'}`}>
          <button onClick={() => { setText('/'); setShowSlash(true); setSlashFilter(''); textRef.current?.focus() }}
            className="p-1.5 rounded-lg text-[var(--text-3)] hover:text-[var(--text-2)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer flex-shrink-0 mb-0.5">
            <Slash size={15}/>
          </button>

          <textarea
            ref={textRef}
            value={text}
            onChange={e => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息，或用 / 呼出快捷命令..."
            rows={1}
            className="flex-1 bg-transparent text-sm text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none resize-none leading-relaxed py-1"
            style={{ minHeight: '24px', maxHeight: '160px' }}
          />

          <button
            onClick={isGenerating ? stop : handleSend}
            className={`p-2 rounded-xl transition-all duration-150 cursor-pointer flex-shrink-0 mb-0.5 ${
              isGenerating
                ? 'bg-red-600/20 text-red-400 hover:bg-red-600/30 border border-red-700/40'
                : hasText
                ? 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-sm shadow-indigo-900/40'
                : 'bg-[var(--bg-hover)] text-[var(--text-3)] cursor-not-allowed'
            }`}
            disabled={!isGenerating && !hasText}
          >
            {isGenerating ? <Square size={15} fill="currentColor"/> : <ArrowUp size={15} strokeWidth={2.5}/>}
          </button>
        </div>
        <p className="text-center text-[10px] text-[var(--text-3)] mt-2">Enter 发送 · Shift+Enter 换行</p>
      </div>
    </div>
  )
}
