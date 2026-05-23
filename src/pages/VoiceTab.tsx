// 闪说 tab — 占位页面. Phase 2 实现 funasr 实时 ASR + 翻译 + 接入写文案流程.

import { Mic, Sparkles, Lock } from 'lucide-react'

export default function VoiceTab() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 py-10 bg-[var(--bg-chat)] overflow-y-auto">
      <div className="max-w-md text-center">
        <div className="w-16 h-16 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] flex items-center justify-center mx-auto mb-5">
          <Mic size={28} className="text-amber-500"/>
        </div>
        <h1 className="text-xl font-semibold text-[var(--text)] mb-2">闪说 · 语音口述</h1>
        <p className="text-sm text-[var(--text-3)] leading-relaxed mb-6">
          对着麦克风说, 实时转文字. 直接进 monoi 文案 / 配音 / 数字人 / 合成流程.
        </p>
        <div className="text-left bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-5 flex flex-col gap-3 mb-6">
          <div className="text-xs font-medium text-[var(--text-2)] flex items-center gap-1.5">
            <Sparkles size={12}/> 即将上线
          </div>
          <ul className="text-xs text-[var(--text-3)] space-y-2">
            <li>• 大麦克风按钮, 边说边出字 (实时 ASR, &lt; 500ms 延迟)</li>
            <li>• 文字可编辑, 错别字一键改</li>
            <li>• 一键翻译成英文 (中英对照)</li>
            <li>• 直接接入: 写文案 / 配音 / 数字人 / 合成 4 条下游链路</li>
          </ul>
        </div>
        <div className="text-[11px] text-[var(--text-3)] flex items-center justify-center gap-1.5">
          <Lock size={11}/> 开发中, 预计 5-7 天内上线
        </div>
      </div>
    </div>
  )
}
