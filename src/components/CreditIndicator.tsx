// 对话框右下角的"积分用量"小指示器, 跟 Claude Code 状态条风格类似.
// 显示 套餐 + 剩余积分 + 用量进度小圆. 30s 自动刷新.
// 点击跳 /account 会员中心.

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchMyCredits, type CreditBalance } from '../services/billing'

const TIER_LABEL: Record<string, string> = {
  free: '免费', pro_monthly: 'Pro', max_monthly: 'Max', flagship_yearly: '旗舰',
}

export function CreditIndicator() {
  const nav = useNavigate()
  const [credits, setCredits] = useState<CreditBalance | null>(null)

  useEffect(() => {
    let canceled = false
    const load = () => {
      fetchMyCredits()
        .then(c => { if (!canceled) setCredits(c) })
        .catch(() => {})
    }
    load()
    // 30s 轮询 — 让用户随时看到余额变化
    const id = setInterval(load, 30_000)
    return () => { canceled = true; clearInterval(id) }
  }, [])

  if (!credits) return null

  const pct = credits.monthly_quota > 0
    ? Math.min(100, Math.round((credits.monthly_used / credits.monthly_quota) * 100))
    : 0
  // 用量颜色: 0-79% 默认, 80-94% 黄, 95+ 红
  const ringColor = pct >= 95 ? 'text-red-500' : pct >= 80 ? 'text-amber-500' : 'text-[var(--text-3)]'
  const tier = TIER_LABEL[credits.tier] || credits.tier

  // tooltip 不暴露具体积分数 — 跟"用户看油针不看流量计"原则一致.
  // 只用颜色 + 进度环表达"还够 / 快用完 / 该充值了" 这种粗粒度状态.
  const stateHint = pct >= 95 ? '额度即将用完, 点击查看' : pct >= 80 ? '本月额度用了不少, 点击查看' : `${tier} 套餐 · 点击查看额度`
  return (
    <button
      onClick={() => nav('/app/account#membership')}
      title={stateHint}
      className="ml-auto flex items-center justify-center p-1.5 rounded-lg hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
    >
      {/* 只显示圆环 — 用量按 % 转, 颜色 80% 黄 / 95% 红预警, 数字藏在 tooltip 里 */}
      <svg width="16" height="16" viewBox="0 0 16 16" className={ringColor}>
        <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" opacity="0.25"/>
        <circle
          cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8"
          strokeDasharray={`${(pct / 100) * 40.84} 40.84`}
          strokeLinecap="round"
          transform="rotate(-90 8 8)"
        />
      </svg>
    </button>
  )
}
