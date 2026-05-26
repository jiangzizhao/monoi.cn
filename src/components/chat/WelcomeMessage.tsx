// 新对话首屏 — 之前只有一句问候, 用户得等 AI 回复才看到选项, 而且 AI 偶尔
// 不输出完整 9 项菜单. 现在把菜单写死前端 -> 100% 稳定显示.
//
// 每项点击直接 dispatch monoi:open-form 事件 -> ChatInput 收到打开对应弹窗,
// 跟 chat 里的 chip 选项走同一条路.

import { WELCOME_OPTIONS } from '../../lib/welcomeOptions'
import { Logo } from '../Logo'

export function WelcomeMessage() {
  const pick = (id: string) => {
    window.dispatchEvent(new CustomEvent('monoi:open-form', { detail: id }))
  }
  return (
    <div className="flex items-start gap-3 msg-enter">
      <Logo className="w-8 h-8 rounded-xl object-contain flex-shrink-0 mt-0.5"/>
      <div className="flex-1 min-w-0 flex flex-col gap-4 pt-1">
        <div className="flex flex-col gap-1.5">
          <p className="text-[var(--text)] leading-relaxed">
            你好! 我是 monoi, 你的视频口播创作助手. 我能帮你完成从文案到发布的全流程. 你想从哪里开始?
          </p>
          <p className="text-sm text-[var(--text-3)]">选一个方向, 我带你走:</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {WELCOME_OPTIONS.map(opt => (
            <button
              key={opt.id}
              onClick={() => pick(opt.id)}
              className="text-left px-3.5 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--text-3)] hover:bg-[var(--bg-hover)] transition-all cursor-pointer"
            >
              <div className="text-sm font-medium text-[var(--text)] leading-tight">{opt.label}</div>
              <div className="text-xs text-[var(--text-3)] mt-0.5 leading-tight">{opt.desc}</div>
            </button>
          ))}
        </div>
        <p className="text-xs text-[var(--text-3)]">
          也可以直接在下方输入框描述你的需求, 或点底部图标选模块.
        </p>
      </div>
    </div>
  )
}
