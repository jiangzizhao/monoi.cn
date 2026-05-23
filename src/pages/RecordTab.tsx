// 录屏 tab — 占位页面. Phase 3 实现真录屏 (PIP screen + camera).

import { Video, Sparkles, Lock } from 'lucide-react'

export default function RecordTab() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 py-10 bg-[var(--bg-chat)] overflow-y-auto">
      <div className="max-w-md text-center">
        <div className="w-16 h-16 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] flex items-center justify-center mx-auto mb-5">
          <Video size={28} className="text-amber-500"/>
        </div>
        <h1 className="text-xl font-semibold text-[var(--text)] mb-2">录屏 · PIP</h1>
        <p className="text-sm text-[var(--text-3)] leading-relaxed mb-6">
          屏幕 + 摄像头同时录, 画中画 (PIP) 模式. 知识付费 / 教培讲师必备.
        </p>
        <div className="text-left bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-5 flex flex-col gap-3 mb-6">
          <div className="text-xs font-medium text-[var(--text-2)] flex items-center gap-1.5">
            <Sparkles size={12}/> 即将上线
          </div>
          <ul className="text-xs text-[var(--text-3)] space-y-2">
            <li>• 录屏幕 (全屏 / 单窗口 / 自选区域)</li>
            <li>• 摄像头 PIP 叠加, 圆 / 方角 / 圆角方块, 9 宫格位置可调</li>
            <li>• 录完直接进口播剪辑 / 一键合成流程</li>
            <li>• 桌面客户端版 (Windows) 加运动模糊 + 鼠标跟踪 zoom</li>
          </ul>
        </div>
        <div className="text-[11px] text-[var(--text-3)] flex items-center justify-center gap-1.5">
          <Lock size={11}/> 开发中, 预计 1-2 周内上线
        </div>
      </div>
    </div>
  )
}
