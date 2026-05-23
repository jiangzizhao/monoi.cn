// 顶部 tab bar — 切换 monoi 三大工作区 (创作 / 录屏 / 闪说). 跟 Claude UI 一致.
// 放在 Sidebar 最顶部 (不在主区域). 手机端 sidebar 抽屉里, 点 tab 后 onPick() 关掉抽屉.

import { NavLink } from 'react-router-dom'
import { MessageSquare, Video, Mic } from 'lucide-react'

const TABS = [
  { to: '/app/chat',   label: '创作', Icon: MessageSquare },
  { to: '/app/record', label: '录屏', Icon: Video },
  { to: '/app/voice',  label: '闪说', Icon: Mic },
]

interface Props {
  onPick?: () => void  // 切 tab 后回调 (手机 sidebar 用来关抽屉)
}

export function TopTabBar({ onPick }: Props) {
  return (
    <div className="border-b border-[var(--border)] px-2 pt-2 pb-1.5 bg-[var(--bg)]">
      <div className="flex items-center gap-1">
        {TABS.map(t => (
          <NavLink
            key={t.to}
            to={t.to}
            onClick={() => onPick?.()}
            className={({ isActive }) =>
              `flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded-lg transition-all cursor-pointer whitespace-nowrap ${
                isActive
                  ? 'bg-[var(--bg-hover)] text-[var(--text)] font-medium'
                  : 'text-[var(--text-3)] hover:text-[var(--text-2)] hover:bg-[var(--bg-hover)]'
              }`
            }
          >
            <t.Icon size={13}/>
            <span>{t.label}</span>
          </NavLink>
        ))}
      </div>
    </div>
  )
}
