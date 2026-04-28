import { useState } from 'react'
import { CopyButton } from '../ui/CopyButton'
import { Badge } from '../ui/Badge'
import type { PlatformCopyResult } from '../../types'

const TABS = [
  { key: 'douyin',       label: '抖音',  color: 'text-pink-400' },
  { key: 'xiaohongshu',  label: '小红书', color: 'text-rose-400' },
  { key: 'shipinhao',    label: '视频号', color: 'text-green-400' },
  { key: 'bilibili',     label: 'B站',   color: 'text-sky-400' },
]

export function PlatformCopyCard({ data }: { data: PlatformCopyResult }) {
  const [active, setActive] = useState('douyin')
  const cur = data[active as keyof typeof data] as any

  return (
    <div className="w-full rounded-xl border border-[var(--border)] overflow-hidden">
      {/* Tabs */}
      <div className="flex border-b border-[var(--border)]">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setActive(t.key)}
            className={`flex-1 py-2.5 text-xs font-medium transition-all cursor-pointer ${active === t.key ? `border-b-2 border-indigo-500 ${t.color}` : 'text-[var(--text-3)] hover:text-[var(--text-2)] border-b-2 border-transparent'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="p-3.5 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[10px] text-[var(--text-3)] mb-1">标题</div>
            <div className="text-sm text-[var(--text)] font-medium">{cur?.title || '—'}</div>
          </div>
          {cur?.title && <CopyButton text={cur.title}/>}
        </div>
        <div className="border-t border-[var(--border-subtle)] pt-2.5 flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] text-[var(--text-3)] mb-1">正文/简介</div>
            <div className="text-xs text-[var(--text-2)] whitespace-pre-wrap leading-relaxed">{cur?.description || cur?.body || '—'}</div>
          </div>
          {(cur?.description || cur?.body) && <CopyButton text={cur.description || cur.body}/>}
        </div>
        {cur?.tags && cur.tags.length > 0 && (
          <div className="border-t border-[var(--border-subtle)] pt-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[10px] text-[var(--text-3)]">话题标签</div>
              <CopyButton text={cur.tags.map((t: string) => `#${t}`).join(' ')}/>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {cur.tags.map((t: string) => <Badge key={t} color="indigo">#{t}</Badge>)}
            </div>
          </div>
        )}
        {data.cover?.main_title && (
          <div className="border-t border-[var(--border-subtle)] pt-2.5">
            <div className="text-[10px] text-[var(--text-3)] mb-1">封面文案建议</div>
            <div className="text-xs text-amber-400 font-medium">{data.cover.main_title}</div>
            {data.cover.subtitle && <div className="text-xs text-[var(--text-2)] mt-0.5">{data.cover.subtitle}</div>}
            {data.cover.color_suggestion && <div className="text-[10px] text-[var(--text-3)] mt-1">{data.cover.color_suggestion}</div>}
          </div>
        )}
      </div>
    </div>
  )
}
