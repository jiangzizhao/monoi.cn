import { RefreshCw } from 'lucide-react'
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

export function ScriptCard({ data, onRegenerate, onDialect }:
  { data: ScriptResult; onRegenerate?: () => void; onDialect?: (dialect: string) => void; onFootage?: () => void; onStoryboard?: () => void }) {
  return (
    <div className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden">
      <div className="relative p-4">
        <div className="absolute top-3 right-3 flex items-center gap-1">
          <CopyButton text={data.script}/>
        </div>
        <p className="text-[var(--text)] text-sm leading-relaxed whitespace-pre-wrap pr-16">{data.script}</p>
        <div className="mt-2 text-xs text-[var(--text-3)]">{data.script.length} 字</div>
      </div>

      <div className="border-t border-[var(--border)] px-3 py-2.5 flex flex-col gap-2">
        {onRegenerate && (
          <div className="flex flex-wrap gap-1.5">
            <button onClick={onRegenerate} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-[var(--text-2)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] transition-all cursor-pointer border border-[var(--border)]">
              <RefreshCw size={12} strokeWidth={2}/> 重新生成
            </button>
          </div>
        )}
        {onDialect && (
          <div className="flex items-center flex-wrap gap-1.5">
            <span className="text-xs text-[var(--text-3)] mr-1">方言</span>
            {DIALECT_GROUP.map(d => (
              <button
                key={d.id}
                onClick={() => onDialect(d.id)}
                className="px-2.5 py-1.5 rounded-lg text-xs text-[var(--text-2)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] transition-all cursor-pointer border border-[var(--border)]"
                title={`改写成${d.label}`}
              >
                {d.label}
              </button>
            ))}
          </div>
        )}
        {onDialect && (
          <div className="flex items-center flex-wrap gap-1.5">
            <span className="text-xs text-[var(--text-3)] mr-1">语言</span>
            {LANGUAGE_GROUP.map(d => (
              <button
                key={d.id}
                onClick={() => onDialect(d.id)}
                className="px-2.5 py-1.5 rounded-lg text-xs text-[var(--text-2)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] transition-all cursor-pointer border border-[var(--border)]"
                title={`改写成${d.label}`}
              >
                {d.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
