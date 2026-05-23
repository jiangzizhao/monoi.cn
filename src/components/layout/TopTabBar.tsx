// 顶部 tab bar — 切换 monoi 三大工作区 (创作 / 录屏 / 闪说). 跟 Claude UI 一致.
//
// 复用 react-router NavLink 处理 active 状态. 手机端横向 scroll, 不挤压.

import { NavLink } from 'react-router-dom'
import { MessageSquare, Video, Mic } from 'lucide-react'

const TABS = [
  { to: '/app/chat',   label: '创作', Icon: MessageSquare },
  { to: '/app/record', label: '录屏', Icon: Video },
  { to: '/app/voice',  label: '闪说', Icon: Mic },
]

export function TopTabBar() {
  return (
    <div className="border-b border-[var(--border)] bg-[var(--bg)] px-2">
      <div className="flex items-center gap-1 overflow-x-auto">
        {TABS.map(t => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) =>
              `flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg transition-all cursor-pointer whitespace-nowrap ${
                isActive
                  ? 'bg-[var(--bg-hover)] text-[var(--text)] font-medium'
                  : 'text-[var(--text-3)] hover:text-[var(--text-2)] hover:bg-[var(--bg-hover)]'
              }`
            }
          >
            <t.Icon size={14}/>
            <span>{t.label}</span>
          </NavLink>
        ))}
      </div>
    </div>
  )
}
