import { useState, useEffect, useRef } from 'react'
import { RefreshCw, ChevronDown } from 'lucide-react'
import { CopyButton } from '../ui/CopyButton'
import type { ScriptResult } from '../../types'

const DIALECT_GROUP = [
  { id: 'cantonese', label: '粤语' },
  { id: 'sichuan',   label: '川渝' },
  { id: 'henan',     label: '河南' },
  { id: 'northeast', label: '东北' },
]
const LANGUAGE_GROUP = [
  { id: 'japanese',  label: '日语' },
  { id: 'english',   label: '英语' },
  { id: 'korean',    label: '韩语' },
]

function DropdownButton({ label, options, onPick }:
  { label: string; options: { id: string; label: string }[]; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-[var(--text-2)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] transition-all cursor-pointer border border-[var(--border)]"
      >
        {label}
        <ChevronDown size={12} className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}/>
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-10 min-w-[120px] rounded-lg border border-[var(--border)] bg-[var(--bg-card)] shadow-lg py-1 flex flex-col">
          {options.map(o => (
            <button
              key={o.id}
              onClick={() => { onPick(o.id); setOpen(false) }}
              className="text-left px-3 py-1.5 text-xs text-[var(--text-2)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function ScriptCard({ data, onRegenerate, onDialect }:
  { data: ScriptResult; onRegenerate?: () => void; onDialect?: (dialect: string) => void; onFootage?: () => void; onStoryboard?: () => void }) {
  return (
    <div className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg-card)]">
      <div className="relative p-4">
        <div className="absolute top-3 right-3 flex items-center gap-1">
          <CopyButton text={data.script}/>
        </div>
        <p className="text-[var(--text)] text-sm leading-relaxed whitespace-pre-wrap pr-16">{data.script}</p>
        <div className="mt-2 text-xs text-[var(--text-3)]">{data.script.length} 字</div>
      </div>

      <div className="border-t border-[var(--border)] px-3 py-2.5 flex flex-wrap items-center gap-1.5">
        {onRegenerate && (
          <button onClick={onRegenerate} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-[var(--text-2)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] transition-all cursor-pointer border border-[var(--border)]">
            <RefreshCw size={12} strokeWidth={2}/> 重新生成
          </button>
        )}
        {onDialect && (
          <>
            <DropdownButton label="方言" options={DIALECT_GROUP} onPick={onDialect}/>
            <DropdownButton label="语言" options={LANGUAGE_GROUP} onPick={onDialect}/>
          </>
        )}
      </div>
    </div>
  )
}
