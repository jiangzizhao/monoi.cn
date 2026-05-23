import { useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, X } from 'lucide-react'
import { consumePrefill } from '../../../lib/formPrefill'

interface Props {
  defaultScript?: string         // 从对话里上一次的 script_card / 转录文本预填
  onSubmit: (script: string) => void
  onClose: () => void
}

export function FootageMatchForm({ defaultScript = '', onSubmit, onClose }: Props) {
  // Agentic AI 串步预填优先于 defaultScript (AI 主动塞的 script 比 ChatInput 推断的更准)
  const initial = consumePrefill<{ script?: string; text?: string }>('__form_footage__')
  const [text, setText] = useState(initial?.script || initial?.text || defaultScript)
  const [error, setError] = useState('')

  const charCount = text.replace(/\s/g, '').length

  const handleSubmit = () => {
    const trimmed = text.trim()
    if (!trimmed) {
      setError('请粘贴文案')
      return
    }
    if (trimmed.length < 20) {
      setError('文案太短 (<20 字), 给点上下文我才好提关键词')
      return
    }
    onSubmit(trimmed)
  }

  const modal = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative bg-[var(--bg-card)] border border-[var(--border)] rounded-[22px] shadow-ios-lg w-full max-w-2xl max-h-[88vh] flex flex-col sheet-enter"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div className="text-base font-semibold text-[var(--text)]">素材 · 智能匹配</div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-[var(--text-2)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
          >
            <X size={16}/>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-[var(--text-2)]">口播文案</span>
              <span className="text-[11px] text-[var(--text-3)]">{charCount} 字</span>
            </div>
            <textarea
              autoFocus
              value={text}
              onChange={(e) => { setText(e.target.value); setError('') }}
              placeholder="把文案粘贴在这里 (建议 100 字以上, 越长拆得越细)..."
              rows={8}
              className={`w-full bg-[var(--bg-input)] border rounded-lg px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none transition-colors resize-none ${error ? 'border-red-500/60' : 'border-[var(--border)] focus:border-[var(--text-3)]'}`}
              style={{ minHeight: '180px', maxHeight: '360px' }}
            />
          </div>

          {error && (
            <div className="flex items-center gap-1.5 text-xs text-red-400">
              <AlertCircle size={12}/>
              <span>{error}</span>
            </div>
          )}

          <p className="text-[11px] text-[var(--text-3)] leading-relaxed">
            接下来 AI 会用约 5-10 秒按句子提取关键词, 然后并发拉素材
            (每句 5-8 个候选). 你逐句挑你喜欢的, 完了能导出清单.
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--border)]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-[var(--text-2)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors cursor-pointer"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!text.trim()}
            className={`px-4 py-2 text-sm rounded-lg transition-all cursor-pointer ${
              text.trim()
                ? 'bg-[var(--text)] text-[var(--bg)] hover:opacity-80'
                : 'bg-[var(--bg-hover)] text-[var(--text-3)] cursor-not-allowed'
            }`}
          >
            开始匹配
          </button>
        </div>
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}
