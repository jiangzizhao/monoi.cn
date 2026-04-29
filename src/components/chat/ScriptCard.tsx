import { useState } from 'react'
import { ChevronDown, RefreshCw, Search, Scissors } from 'lucide-react'
import { CopyButton } from '../ui/CopyButton'
import { Badge } from '../ui/Badge'
import type { ScriptResult } from '../../types'

const PLATFORM_STYLE: Record<string, string> = {
  douyin: 'text-pink-400', xiaohongshu: 'text-rose-400', shipinhao: 'text-green-400',
}
const PLATFORM_LABEL: Record<string, string> = {
  douyin: '抖音', xiaohongshu: '小红书', shipinhao: '视频号',
}

export function ScriptCard({ data, onRegenerate, onFootage, onStoryboard }:
  { data: ScriptResult; onRegenerate?: () => void; onFootage?: () => void; onStoryboard?: () => void }) {
  const [showAnalysis, setShowAnalysis] = useState(false)
  const [showOriginal, setShowOriginal] = useState(false)

  return (
    <div className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden">

      {/* 原文（仿写时显示） */}
      {data.original && (
        <div className="border-b border-[var(--border)]">
          <button onClick={() => setShowOriginal(v => !v)}
            className="flex items-center gap-1.5 w-full px-4 py-2.5 text-xs text-[var(--text-2)] hover:text-[var(--text)] transition-colors cursor-pointer">
            <ChevronDown size={13} className={`transition-transform duration-200 ${showOriginal ? 'rotate-180' : ''}`}/>
            参考原文
          </button>
          {showOriginal && (
            <div className="px-4 pb-3 text-xs text-[var(--text-3)] leading-relaxed whitespace-pre-wrap border-t border-[var(--border)] pt-3">
              {data.original}
            </div>
          )}
        </div>
      )}

      {/* Script body */}
      <div className="relative p-4">
        <div className="absolute top-3 right-3 flex items-center gap-1">
          <CopyButton text={data.script}/>
        </div>
        <p className="text-[var(--text)] text-sm leading-relaxed whitespace-pre-wrap pr-16">{data.script}</p>
        <div className="mt-2 text-xs text-[var(--text-3)]">{data.script.length} 字</div>
      </div>

      {/* Analysis */}
      {data.analysis && (
        <div className="border-t border-[var(--border)]">
          <button onClick={() => setShowAnalysis(v => !v)}
            className="flex items-center gap-1.5 w-full px-4 py-2.5 text-xs text-[var(--text-2)] hover:text-[var(--text)] transition-colors cursor-pointer">
            <ChevronDown size={13} className={`transition-transform duration-200 ${showAnalysis ? 'rotate-180' : ''}`}/>
            结构拆解
          </button>
          {showAnalysis && (
            <div className="px-4 pb-3 text-xs text-[var(--text-2)] leading-relaxed whitespace-pre-wrap">{data.analysis}</div>
          )}
        </div>
      )}

      {/* Titles */}
      {(data.titles.douyin || data.titles.xiaohongshu || data.titles.shipinhao) && (
        <div className="border-t border-[var(--border)] p-3 flex flex-col gap-1.5">
          <div className="text-xs text-[var(--text-3)] mb-1">标题推荐</div>
          {Object.entries(data.titles).map(([k, v]) => !v ? null : (
            <div key={k} className="flex items-start justify-between gap-2 text-sm">
              <div className="flex items-start gap-2 min-w-0">
                <span className={`text-xs font-medium flex-shrink-0 mt-0.5 ${PLATFORM_STYLE[k]}`}>{PLATFORM_LABEL[k]}</span>
                <span className="text-[var(--text)] truncate">{v}</span>
              </div>
              <CopyButton text={v}/>
            </div>
          ))}
        </div>
      )}

      {/* Tags */}
      {data.tags.length > 0 && (
        <div className="border-t border-[var(--border)] px-3 py-2.5 flex flex-wrap gap-1.5">
          {data.tags.map(t => <Badge key={t} color="indigo">#{t}</Badge>)}
        </div>
      )}

      {/* Actions */}
      <div className="border-t border-[var(--border)] px-3 py-2.5 flex flex-wrap gap-2">
        {onRegenerate && (
          <button onClick={onRegenerate} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-[var(--text-2)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] transition-all cursor-pointer border border-[var(--border)]">
            <RefreshCw size={12} strokeWidth={2}/> 重新生成
          </button>
        )}
        {onFootage && (
          <button onClick={onFootage} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-[var(--text-2)] hover:text-indigo-300 hover:bg-indigo-950/40 transition-all cursor-pointer border border-[var(--border)] hover:border-indigo-500/40">
            <Search size={12} strokeWidth={2}/> 用这篇找素材
          </button>
        )}
        {onStoryboard && (
          <button onClick={onStoryboard} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-[var(--text-2)] hover:text-amber-300 hover:bg-amber-950/30 transition-all cursor-pointer border border-[var(--border)] hover:border-amber-500/30">
            <Scissors size={12} strokeWidth={2}/> 用这篇生成分镜
          </button>
        )}
      </div>
    </div>
  )
}
