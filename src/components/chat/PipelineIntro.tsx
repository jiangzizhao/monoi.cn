// PipelineIntro — Agentic AI 多步流程预告 chip.
// AI 在回包里输出 { type: 'pipeline_intro', data: { steps: [...] } } 时, MessageBubble 渲染本组件.
// 用户看到 N 步流程描述 + 开始/取消按钮. 不显示积分消耗 (产品设计原则: 用户看油针不看流量计).
//
// 点 "开始": 标记 started, 发一句普通话 "好, 开始" 给 AI, AI 据此继续走第一步.
// 点 "取消": 标记 dismissed, chip 灰掉, 不发任何东西给 AI.

import { ArrowRight, Check, X } from 'lucide-react'
import type { PipelineStep } from '../../types'

interface Props {
  steps: PipelineStep[]
  started?: boolean
  dismissed?: boolean
  onStart: () => void
  onDismiss: () => void
}

export function PipelineIntro({ steps, started, dismissed, onStart, onDismiss }: Props) {
  const locked = started || dismissed

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 flex flex-col gap-3">
      <div className="text-xs text-[var(--text-3)]">本次流程</div>

      {/* 步骤链 */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        {steps.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--bg-hover)] border border-[var(--border-subtle)]">
              <span className="w-4 h-4 rounded-full bg-[var(--text)] text-[var(--bg)] text-[10px] font-bold flex items-center justify-center flex-shrink-0">{i + 1}</span>
              <div className="flex flex-col">
                <span className="text-sm text-[var(--text)] leading-tight font-medium">{s.label}</span>
                <span className="text-[10px] text-[var(--text-3)] leading-tight">{s.desc}</span>
              </div>
            </div>
            {i < steps.length - 1 && <ArrowRight size={12} className="text-[var(--text-3)] flex-shrink-0"/>}
          </div>
        ))}
      </div>

      {/* 状态 / 操作按钮 */}
      {!locked && (
        <div className="flex gap-2 mt-1">
          <button onClick={onStart}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[var(--text)] text-[var(--bg)] text-sm font-medium hover:opacity-80 cursor-pointer transition-opacity">
            <Check size={14}/> 开始
          </button>
          <button onClick={onDismiss}
            className="px-4 py-2 rounded-lg border border-[var(--border)] text-[var(--text-2)] text-sm hover:bg-[var(--bg-hover)] cursor-pointer transition-colors">
            <X size={14}/>
          </button>
        </div>
      )}
      {started && (
        <div className="text-xs text-green-500 flex items-center gap-1.5"><Check size={12}/> 已开始流程, 接下来一步步推进</div>
      )}
      {dismissed && (
        <div className="text-xs text-[var(--text-3)]">已取消</div>
      )}
    </div>
  )
}
