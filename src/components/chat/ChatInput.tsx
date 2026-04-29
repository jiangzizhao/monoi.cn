import { useState, useRef, useEffect } from 'react'
import { ArrowUp, FileText, Mic, Video, Film, Scissors, Image, Send, Download } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useChatStore } from '../../store/chatStore'
import { useChat } from '../../hooks/useChat'
import { CopywritingForm } from './forms/CopywritingForm'

const MODULES: { label: string; Icon: LucideIcon }[] = [
  { label: '文案',  Icon: FileText  },
  { label: '配音',  Icon: Mic       },
  { label: '口播',  Icon: Video     },
  { label: '素材',  Icon: Film      },
  { label: '剪辑',  Icon: Scissors  },
  { label: '封面',  Icon: Image     },
  { label: '发布',  Icon: Send      },
  { label: '导出',  Icon: Download  },
]

const MODULE_OPTIONS: Record<string, { id: string; label: string; desc: string }[]> = {
  '文案': [
    { id: '__form_original__', label: '原创', desc: '从零写一篇新文案' },
    { id: '__form_rewrite__', label: '仿写', desc: '粘贴链接或视频改写' },
  ],
  '配音': [
    { id: '我想用预设音色配音', label: '预设音色', desc: '从音色库中选择' },
    { id: '我想上传已有录音', label: '上传录音', desc: '已录好的音频直接用' },
    { id: '我想克隆我的声音', label: '克隆声音', desc: '上传样本复刻你的声音' },
  ],
  '口播': [
    { id: '我想上传自己录制的口播视频', label: '自录上传', desc: '上传已录好的口播' },
    { id: '我想用数字人做口播', label: '数字人', desc: '上传形象图驱动口播' },
    { id: '我想用AI生成口播视频', label: 'AI生成', desc: '根据文案自动生成' },
  ],
  '素材': [
    { id: '帮我根据文案找匹配的视频素材', label: '开始匹配素材', desc: '文案拆词匹配视频片段' },
  ],
  '剪辑': [
    { id: '帮我生成剪辑分镜表', label: '生成分镜表', desc: '小林风格节奏分镜' },
  ],
  '封面': [
    { id: '帮我用AI生成封面图', label: 'AI生成封面', desc: '根据文案生成封面' },
  ],
  '发布': [
    { id: '帮我生成各平台的发布文案', label: '生成发布文案', desc: '抖音/小红书/视频号/B站' },
  ],
  '导出': [
    { id: '告诉我推荐的导出参数', label: '查看导出参数', desc: 'H.264 / 1080p 最佳设置' },
  ],
}

interface Props {
  moduleMenu: string | null
  onModuleClick: (label: string) => void
  onModuleMenuClose: () => void
}

export function ChatInput({ moduleMenu, onModuleClick, onModuleMenuClose }: Props) {
  const [text, setText] = useState('')
  const [copyForm, setCopyForm] = useState<'original' | 'rewrite' | null>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const { isGenerating } = useChatStore()
  const { send, stop } = useChat()

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
    if (e.key === 'Escape') onModuleMenuClose()
  }

  const handleSend = () => {
    const trimmed = text.trim()
    if (!trimmed || isGenerating) return
    setText('')
    onModuleMenuClose()
    send(trimmed)
  }

  const pickModuleOption = (optId: string) => {
    onModuleMenuClose()
    if (optId === '__form_original__') {
      setCopyForm('original')
    } else if (optId === '__form_rewrite__') {
      setCopyForm('rewrite')
    } else {
      send(optId)
    }
  }

  const handleModuleClick = (label: string) => {
    if (moduleMenu === label) {
      onModuleMenuClose()
    } else {
      onModuleClick(label)
    }
  }

  useEffect(() => {
    const el = textRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [text])

  useEffect(() => {
    if (moduleMenu) textRef.current?.focus()
  }, [moduleMenu])

  const options = moduleMenu ? (MODULE_OPTIONS[moduleMenu] ?? []) : []
  const hasText = text.trim().length > 0

  return (
    <>
    <div className="border-t border-[var(--border)] bg-[var(--bg-chat)] px-4 pt-3 pb-4">
      <div className="max-w-3xl mx-auto relative">

        {/* Copywriting form popup */}
        {copyForm && (
          <CopywritingForm
            mode={copyForm}
            onSubmit={(msg) => { setCopyForm(null); send(msg) }}
            onClose={() => setCopyForm(null)}
          />
        )}

        {/* Module option popup */}
        {moduleMenu && options.length > 0 && (
          <div className="absolute bottom-full left-0 right-0 mb-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl overflow-hidden shadow-2xl z-20">
            <div className="px-4 py-2.5 border-b border-[var(--border)]">
              <span className="text-xs text-[var(--text-3)]">{moduleMenu} · 选择方式</span>
            </div>
            {options.map(opt => (
              <button
                key={opt.id}
                onClick={() => pickModuleOption(opt.id)}
                className="flex items-center justify-between w-full px-4 py-3 hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
              >
                <span className="text-sm font-medium text-[var(--text)]">{opt.label}</span>
                <span className="text-xs text-[var(--text-3)]">{opt.desc}</span>
              </button>
            ))}
          </div>
        )}

        {/* Backdrop */}
        {moduleMenu && (
          <div className="fixed inset-0 z-10" onClick={onModuleMenuClose}/>
        )}

        {/* Input row */}
        <div className={`relative z-20 flex items-end gap-2 bg-[var(--bg-input)] border rounded-2xl px-3 py-2 transition-colors ${hasText ? 'border-[var(--text-3)]' : 'border-[var(--border)]'}`}>
          <textarea
            ref={textRef}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息..."
            rows={1}
            className="flex-1 bg-transparent text-sm text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none resize-none leading-relaxed py-1"
            style={{ minHeight: '24px', maxHeight: '160px' }}
          />
          <button
            onClick={isGenerating ? stop : handleSend}
            className={`p-2 rounded-xl transition-all duration-150 cursor-pointer flex-shrink-0 mb-0.5 ${
              isGenerating
                ? 'bg-[var(--bg-hover)] text-[var(--text-2)] hover:bg-[var(--border)] border border-[var(--border)]'
                : hasText
                ? 'bg-[var(--text)] text-[var(--bg)] hover:opacity-80'
                : 'bg-[var(--bg-hover)] text-[var(--text-3)] cursor-not-allowed'
            }`}
            disabled={!isGenerating && !hasText}
          >
            {isGenerating
              ? <span className="w-3.5 h-3.5 block rounded-sm bg-current"/>
              : <ArrowUp size={15} strokeWidth={2.5}/>
            }
          </button>
        </div>

        {/* Module icons row */}
        <div className="flex items-center gap-0.5 mt-2 px-1">
          {MODULES.map(({ label, Icon }) => (
            <button
              key={label}
              title={label}
              onClick={() => handleModuleClick(label)}
              className={`p-2 rounded-lg transition-all cursor-pointer ${
                moduleMenu === label
                  ? 'text-[var(--text)] bg-[var(--bg-hover)]'
                  : 'text-[var(--text-3)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              <Icon size={15} strokeWidth={1.8}/>
            </button>
          ))}
        </div>
      </div>
    </div>
    </>
  )
}
