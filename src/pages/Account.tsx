import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Copy, Check, Crown, Zap, Gem, Gift, ChevronDown, ChevronUp, X } from 'lucide-react'
import {
  fetchPlans, fetchMyCredits, fetchMySubscription, fetchMyReferralCode,
  fetchMyReferrerStatus, fetchMyReferrerBalance, fetchCreditLog,
  type PlansResponse, type PlanConfig, type CreditBalance, type UserSubscription,
  type ReferralCode, type ReferrerStatus, type ReferrerBalance, type CreditLogEntry,
} from '../services/billing'
import { getUsername, isLoggedIn } from '../lib/auth'

const TIER_LABEL: Record<string, string> = {
  free: '免费',
  pro_monthly: 'Pro 月卡',
  max_monthly: 'Max 月卡',
  flagship_yearly: '旗舰年卡',
}

const TIER_ICON: Record<string, any> = {
  free: Gift,
  pro_monthly: Zap,
  max_monthly: Crown,
  flagship_yearly: Gem,
}

// 套餐排序 (用于卡片 + 对比表)
const TIER_ORDER: ('free' | 'pro_monthly' | 'max_monthly' | 'flagship_yearly')[] = [
  'free', 'pro_monthly', 'max_monthly', 'flagship_yearly',
]

const fmtDate = (ts?: number) => ts ? new Date(ts * 1000).toLocaleDateString('zh-CN') : '-'
const fmtTime = (ts?: number) => ts ? new Date(ts * 1000).toLocaleString('zh-CN') : '-'
const daysLeft = (ts?: number) => ts ? Math.max(0, Math.ceil((ts - Date.now()/1000) / 86400)) : 0

// FAQ 内容 (硬编码)
const FAQS = [
  {
    q: '月卡到期不续费会怎样?',
    a: '自动降级到免费版, 已购买的"加买积分" 永不过期可继续使用, 月送积分会清零. 视频导出会重新带上 monoi 水印.',
  },
  {
    q: '升级到 Max 后, 没用完的 Pro 月卡怎么办?',
    a: '按未使用天数折算成 Max 时长. 例如还剩 15 天的 Pro 升级 Max, 等于 Max 月卡时长延长 15 × (99/199) ≈ 7.5 天.',
  },
  {
    q: '怎么取消自动续费?',
    a: '账户中心 → 当前订阅 → 取消自动续费. 当前周期内仍可正常使用直到到期.',
  },
  {
    q: '数字人配额怎么算? 一条 30 秒视频算 1 条吗?',
    a: '是的, 不论视频时长, **生成一次就算 1 条配额**. 单视频时长上限按套餐档位 (Free 5 分钟 / Pro 15 / Max 30 / 旗舰 60).',
  },
  {
    q: '商用授权具体能干什么?',
    a: 'Max+ 可以用 monoi 帮客户做付费视频接活. 旗舰还有"转售授权" 可以代理 monoi 给客户使用.',
  },
  {
    q: 'API 访问什么时候开?',
    a: 'V2 阶段开放 (预计 2026 Q3), 旗舰用户优先开 API key. 用于自动化批量生成或接入 SaaS 工作流.',
  },
  {
    q: '积分用完了怎么办?',
    a: '可以单独买积分包 (¥9.9-499 四档). 月会员买积分有折扣 (Pro ¥1=15, Max ¥1=20, 旗舰 ¥1=25).',
  },
  {
    q: '退款政策?',
    a: '所有套餐和积分包**不支持退款**, 请按需购买. 月卡可随时取消自动续费, 当期用完为止.',
  },
]

// 对比表行配置
const COMPARE_ROWS: Array<{
  key: keyof PlanConfig | 'price'
  label: string
  group?: string
  render?: (p: PlanConfig) => React.ReactNode
}> = [
  { key: 'price', label: '价格', group: '基础', render: p => p.price_yuan === 0 ? '免费' : `¥${p.price_yuan}/${p.period_days === 365 ? '年' : '月'}` },
  { key: 'monthly_credits', label: '月送积分', render: p => p.monthly_credits.toLocaleString() },
  { key: 'digital_human_quota', label: '数字人合成', render: p => `${p.digital_human_quota} 条/月` },
  { key: 'max_video_minutes', label: '单视频时长', render: p => p.unlimited_duration ? '不限' : `≤ ${p.max_video_minutes} 分钟` },
  { key: 'max_resolution', label: '导出最高清晰度', render: p => p.max_resolution },
  { key: 'clone_voice_slots', label: '克隆音色 slot', render: p => `${p.clone_voice_slots} 个` },
  { key: 'priority_gpu', label: '优先 GPU 队列', group: '功能', render: p => p.priority_gpu ? '✓' : '✗' },
  { key: 'watermark', label: '视频水印', render: p => p.watermark ? '带 monoi 水印' : '无水印' },
  { key: 'commercial_license', label: '商用授权', render: p => p.commercial_license ? '✓' : '✗' },
  { key: 'transferable_license', label: '转售/代理授权', render: p => p.transferable_license ? '✓' : '✗' },
  { key: 'multi_platform_accounts', label: '多平台账号数', render: p => `${p.multi_platform_accounts} 个` },
  { key: 'team_seats', label: '团队子账号', render: p => p.team_seats > 0 ? `${p.team_seats} 个` : '—' },
  { key: 'vip_support', label: 'VIP 1v1 客服', group: '服务', render: p => p.vip_support ? '✓' : '✗' },
  { key: 'early_access', label: '提前体验新功能', render: p => p.early_access ? '✓' : '✗' },
  { key: 'api_access', label: 'API 访问 (V2)', render: p => p.api_access ? '✓' : '✗' },
  { key: 'referral_boost', label: '推广分成提升', render: p => p.referral_boost ? '一次性 30%' : '按等级' },
  { key: 'support_response_hours', label: '客服响应', render: p => `${p.support_response_hours}h` },
  { key: 'credit_pack_rate', label: '加买积分单价', group: '积分包', render: p => `¥1 = ${p.credit_pack_rate} 积分` },
]

// 套餐卡片显示的核心卖点 (按 tier 不同)
function planHighlights(tier: string, p: PlanConfig): string[] {
  const base = [
    `${p.monthly_credits} 积分/月`,
    `${p.digital_human_quota} 条数字人/月`,
    `${p.unlimited_duration ? '不限时长' : `≤ ${p.max_video_minutes} 分钟`}`,
    `${p.max_resolution} 导出`,
    `${p.clone_voice_slots} 个克隆音色`,
  ]
  if (tier === 'free') {
    base.push('视频带 monoi 水印')
  } else if (tier === 'pro_monthly') {
    base.push('无水印', `${p.multi_platform_accounts} 个平台账号`)
  } else if (tier === 'max_monthly') {
    base.push('优先 GPU 队列', '商用授权', `${p.multi_platform_accounts} 个平台账号`)
  } else if (tier === 'flagship_yearly') {
    base.push('VIP 1v1 客服', '提前体验新功能', '商用 + 转售授权', `团队 ${p.team_seats} 席位`, 'API 访问')
  }
  return base
}

export default function Account() {
  const nav = useNavigate()
  const [plans, setPlans] = useState<PlansResponse | null>(null)
  const [credits, setCredits] = useState<CreditBalance | null>(null)
  const [sub, setSub] = useState<UserSubscription | null>(null)
  const [refCode, setRefCode] = useState<ReferralCode | null>(null)
  const [refStatus, setRefStatus] = useState<ReferrerStatus | null>(null)
  const [refBalance, setRefBalance] = useState<ReferrerBalance | null>(null)
  const [creditLog, setCreditLog] = useState<CreditLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)
  const [upgradeDialog, setUpgradeDialog] = useState<string | null>(null)
  const [compareOpen, setCompareOpen] = useState(true)        // 详细对比表默认展开
  const [faqOpen, setFaqOpen] = useState<number | null>(null)

  useEffect(() => {
    if (!isLoggedIn()) { nav('/login'); return }
    Promise.all([
      fetchPlans(),
      fetchMyCredits().catch(e => { console.warn(e); return null }),
      fetchMySubscription().catch(e => { console.warn(e); return null }),
      fetchMyReferralCode().catch(e => { console.warn(e); return null }),
      fetchMyReferrerStatus().catch(e => { console.warn(e); return null }),
      fetchMyReferrerBalance().catch(e => { console.warn(e); return null }),
      fetchCreditLog(20).catch(e => { console.warn(e); return [] }),
    ]).then(([p, c, s, rc, rs, rb, cl]) => {
      setPlans(p); setCredits(c); setSub(s); setRefCode(rc); setRefStatus(rs); setRefBalance(rb); setCreditLog(cl as CreditLogEntry[])
      setLoading(false)
    }).catch(e => { setErr(e.message || '加载失败'); setLoading(false) })
  }, [nav])

  const copyLink = () => {
    if (!refCode) return
    navigator.clipboard.writeText(refCode.link).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    })
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-[var(--text-2)]">加载中...</div>
  if (err) return <div className="min-h-screen flex items-center justify-center text-red-400 px-4">{err}</div>

  const curTier = sub?.tier || 'free'
  const curPlan: PlanConfig | undefined = curTier === 'free' ? plans?.free : plans?.plans[curTier]

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      {/* Header */}
      <div className="border-b border-[var(--border)] bg-[var(--bg-card)] sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <button onClick={() => nav('/app')} className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] cursor-pointer">
            <ArrowLeft size={18}/>
          </button>
          <div className="text-base font-semibold">账户中心</div>
          <div className="ml-auto text-sm text-[var(--text-3)]">{getUsername()}</div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-6">

        {/* 当前订阅 + 积分余额 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-5 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
            <div className="text-xs text-[var(--text-3)] mb-1.5">当前套餐</div>
            <div className="flex items-baseline gap-2 mb-3">
              <span className="text-2xl font-semibold">{TIER_LABEL[curTier] || curTier}</span>
              {curPlan && curPlan.price_yuan > 0 && (
                <span className="text-xs text-[var(--text-3)]">¥{curPlan.price_yuan}/{curPlan.period_days === 365 ? '年' : '月'}</span>
              )}
            </div>
            {curTier !== 'free' && sub?.current_period_end ? (
              <>
                <div className="text-xs text-[var(--text-2)] mb-3">
                  到期 {fmtDate(sub.current_period_end)} · 剩 {daysLeft(sub.current_period_end)} 天
                  {sub.expired && <span className="text-red-400 ml-2">已过期</span>}
                </div>
                {curPlan && (
                  <div className="text-[11px] text-[var(--text-3)] mb-1.5">本月已用 / 本月总额度</div>
                )}
                {curPlan && (
                  <div className="space-y-1.5">
                    <UsageBar label="数字人" used={0} total={curPlan.digital_human_quota} unit="条"/>
                    <UsageBar label="积分" used={(credits?.monthly ? curPlan.monthly_credits - credits.monthly : 0)} total={curPlan.monthly_credits} unit=""/>
                  </div>
                )}
              </>
            ) : (
              <div className="text-xs text-[var(--text-3)]">免费体验中 · {curPlan?.monthly_credits || 50} 积分 · 视频带 monoi 水印</div>
            )}
          </div>

          <div className="p-5 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
            <div className="text-xs text-[var(--text-3)] mb-1.5">积分余额</div>
            <div className="text-2xl font-semibold mb-3">{credits?.total ?? 0}</div>
            <div className="text-xs text-[var(--text-2)] flex gap-3">
              <span>月送 <b className="text-[var(--text)]">{credits?.monthly ?? 0}</b></span>
              <span>加买 <b className="text-[var(--text)]">{credits?.purchased ?? 0}</b></span>
            </div>
          </div>
        </div>

        {/* 套餐卡片 4 张 */}
        <div>
          <div className="text-base font-semibold mb-1">选择套餐</div>
          <div className="text-xs text-[var(--text-3)] mb-4">月卡随时取消自动续费, 旗舰年付一次锁一年享专属权益</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {TIER_ORDER.map(tier => {
              const p = tier === 'free' ? plans!.free : plans!.plans[tier]
              if (!p) return null
              const Icon = TIER_ICON[tier]
              const isCurrent = curTier === tier
              const isMax = tier === 'max_monthly'
              const isFlagship = tier === 'flagship_yearly'
              return (
                <div key={tier} className={`relative p-4 rounded-2xl border-2 flex flex-col gap-3 ${
                  isCurrent ? 'border-[var(--text)] bg-[var(--bg-hover)]' :
                  isMax ? 'border-amber-400 bg-[var(--bg-card)]' :
                  isFlagship ? 'border-purple-500 bg-[var(--bg-card)]' :
                  'border-[var(--border)] bg-[var(--bg-card)]'
                }`}>
                  {isMax && !isCurrent && (
                    <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full bg-amber-400 text-black text-[10px] font-medium">⭐ 最受欢迎</div>
                  )}
                  {isFlagship && !isCurrent && (
                    <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full bg-purple-500 text-white text-[10px] font-medium">💎 工作室专属</div>
                  )}
                  {isCurrent && (
                    <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full bg-[var(--text)] text-[var(--bg)] text-[10px] font-medium">✓ 当前套餐</div>
                  )}

                  <div className="flex items-center gap-2">
                    <Icon size={18} className={isFlagship ? 'text-purple-500' : isMax ? 'text-amber-400' : 'text-[var(--text-2)]'}/>
                    <span className="text-base font-semibold">{p.name}</span>
                  </div>

                  <div className="text-2xl font-semibold">
                    {p.price_yuan === 0 ? '免费' : `¥${p.price_yuan}`}
                    {p.price_yuan > 0 && (
                      <span className="text-xs text-[var(--text-3)] font-normal ml-1">
                        / {p.period_days === 365 ? '年' : '月'}
                      </span>
                    )}
                  </div>

                  <ul className="text-xs text-[var(--text-2)] space-y-1 flex-1">
                    {planHighlights(tier, p).map((h, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span className="text-[var(--text-3)] mt-0.5">·</span>
                        <span>{h}</span>
                      </li>
                    ))}
                  </ul>

                  <button
                    onClick={() => !isCurrent && setUpgradeDialog(tier)}
                    disabled={isCurrent}
                    className={`mt-1 py-2.5 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                      isCurrent ? 'bg-[var(--bg-hover)] text-[var(--text-3)] cursor-not-allowed' :
                      isMax ? 'bg-amber-400 text-black hover:opacity-90' :
                      isFlagship ? 'bg-purple-500 text-white hover:opacity-90' :
                      tier === 'free' ? 'bg-[var(--bg-hover)] text-[var(--text-2)]' :
                      'bg-[var(--text)] text-[var(--bg)] hover:opacity-80'
                    }`}
                  >
                    {isCurrent ? '当前使用' : tier === 'free' ? '免费版' : `开通 ${p.name}`}
                  </button>
                </div>
              )
            })}
          </div>
        </div>

        {/* 详细对比表 */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden">
          <button onClick={() => setCompareOpen(o => !o)} className="w-full flex items-center justify-between px-5 py-3.5 cursor-pointer hover:bg-[var(--bg-hover)] transition-colors">
            <span className="text-sm font-medium">详细功能对比</span>
            {compareOpen ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}
          </button>
          {compareOpen && plans && (
            <div className="overflow-x-auto border-t border-[var(--border)]">
              <table className="w-full text-xs">
                <thead className="bg-[var(--bg-hover)]">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-medium text-[var(--text-2)]">功能</th>
                    {TIER_ORDER.map(t => {
                      const isMax = t === 'max_monthly'
                      return (
                        <th key={t} className={`text-center px-3 py-2.5 font-medium ${isMax ? 'text-amber-500' : 'text-[var(--text-2)]'}`}>
                          {TIER_LABEL[t]}
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {COMPARE_ROWS.map((row, i) => {
                    const prevGroup = i > 0 ? COMPARE_ROWS[i-1].group : undefined
                    const showGroupHeader = row.group && row.group !== prevGroup
                    return (
                      <>
                        {showGroupHeader && (
                          <tr key={`g-${i}`} className="bg-[var(--bg-input)]">
                            <td colSpan={5} className="px-4 py-1.5 text-[10px] text-[var(--text-3)] uppercase">{row.group}</td>
                          </tr>
                        )}
                        <tr key={i} className="border-t border-[var(--border-subtle)]">
                          <td className="px-4 py-2 text-[var(--text-2)]">{row.label}</td>
                          {TIER_ORDER.map(t => {
                            const p = t === 'free' ? plans.free : plans.plans[t]
                            return <td key={t} className="text-center px-3 py-2 text-[var(--text)]">{p && row.render ? row.render(p) : '-'}</td>
                          })}
                        </tr>
                      </>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 积分包 */}
        <div>
          <div className="text-base font-semibold mb-1">单独购买积分</div>
          <div className="text-xs text-[var(--text-3)] mb-4">
            标准价 ¥1 = 10 积分; Pro 用户 ¥1=15, Max 用户 ¥1=20, 旗舰用户 ¥1=25 (会员有阶梯折扣)
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {plans && Object.entries(plans.credit_packs).map(([code, pack]) => (
              <div key={code} className="p-4 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] flex flex-col gap-2">
                <div className="text-xs text-[var(--text-3)]">{pack.name}</div>
                <div className="text-xl font-semibold">¥{pack.price_yuan}</div>
                <div className="text-xs text-[var(--text-2)]">{pack.credits} 积分</div>
                <button onClick={() => setUpgradeDialog(code)} className="mt-1 py-1.5 rounded-lg text-xs bg-[var(--bg-hover)] hover:bg-[var(--text-3)] hover:text-[var(--bg)] cursor-pointer transition-colors">
                  购买
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* 推广 */}
        {refCode && refStatus && (
          <div className="p-5 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
            <div className="flex items-center justify-between mb-3">
              <div className="text-base font-semibold">我的推广</div>
              <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--bg-hover)] text-[var(--text-2)]">
                {refStatus.level === 'normal' ? '普通用户' : refStatus.level === 'certified' ? '认证推广员' : '核心合伙人'}
              </span>
            </div>
            <div className="text-xs text-[var(--text-3)] mb-2">推广码: <span className="font-mono text-[var(--text-2)]">{refCode.referral_code}</span></div>
            <div className="flex flex-col sm:flex-row gap-2 items-stretch">
              <div className="flex-1 px-3 py-2 rounded-lg bg-[var(--bg-input)] text-xs text-[var(--text-2)] break-all font-mono">{refCode.link}</div>
              <button onClick={copyLink} className="px-4 py-2 rounded-lg bg-[var(--text)] text-[var(--bg)] text-sm hover:opacity-80 cursor-pointer inline-flex items-center justify-center gap-1.5">
                {copied ? <><Check size={14}/> 已复制</> : <><Copy size={14}/> 复制链接</>}
              </button>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3 text-xs text-[var(--text-2)]">
              <div>
                <div className="text-[10px] text-[var(--text-3)]">累计带来付费</div>
                <div className="text-base font-semibold text-[var(--text)]">{refStatus.total_paying_users}</div>
              </div>
              <div>
                <div className="text-[10px] text-[var(--text-3)]">累计推广流水</div>
                <div className="text-base font-semibold text-[var(--text)]">¥{(refStatus.total_revenue_brought || 0).toFixed(2)}</div>
              </div>
              <div>
                <div className="text-[10px] text-[var(--text-3)]">现金余额</div>
                <div className="text-base font-semibold text-[var(--text)]">¥{(refBalance?.cash_balance || 0).toFixed(2)}</div>
              </div>
            </div>
            {refStatus.level === 'normal' && (
              <div className="mt-3 text-[11px] text-[var(--text-3)] leading-relaxed">
                💡 普通用户推荐拿积分奖励. 累计带来 5 个付费用户或 ¥500 流水后, 自动升级为<b>认证推广员</b> (拿现金 30% 首单 + 10%×3 月续费). 月推 20 人或 ¥3000 流水升<b>核心合伙人</b> (50% + 15%×3 月).
              </div>
            )}
          </div>
        )}

        {/* FAQ */}
        <div className="p-5 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
          <div className="text-base font-semibold mb-3">常见问题</div>
          <div className="flex flex-col gap-1">
            {FAQS.map((f, i) => (
              <div key={i} className="border-b border-[var(--border-subtle)] last:border-b-0">
                <button onClick={() => setFaqOpen(faqOpen === i ? null : i)} className="w-full flex items-center justify-between py-2.5 text-left cursor-pointer hover:text-[var(--text)] transition-colors">
                  <span className="text-sm">{f.q}</span>
                  {faqOpen === i ? <ChevronUp size={14} className="text-[var(--text-3)]"/> : <ChevronDown size={14} className="text-[var(--text-3)]"/>}
                </button>
                {faqOpen === i && (
                  <div className="pb-3 text-xs text-[var(--text-2)] leading-relaxed">{f.a}</div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 积分流水 */}
        {creditLog.length > 0 && (
          <div className="p-5 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
            <div className="text-base font-semibold mb-3">积分流水 (最近 20 条)</div>
            <div className="flex flex-col gap-1.5 text-xs">
              {creditLog.map(log => (
                <div key={log.id} className="flex items-center justify-between py-1.5 border-b border-[var(--border-subtle)] last:border-b-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[var(--text-3)] text-[10px]">{fmtTime(log.created_at)}</span>
                    <span className="text-[var(--text-2)]">{log.feature || log.source}</span>
                  </div>
                  <span className={log.delta > 0 ? 'text-green-500 font-medium' : 'text-red-400 font-medium'}>
                    {log.delta > 0 ? '+' : ''}{log.delta}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 升级/购买对话框 (V1: 引导客服微信) */}
      {upgradeDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setUpgradeDialog(null)}>
          <div onClick={e => e.stopPropagation()} className="relative bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-ios-lg w-full max-w-md p-6 flex flex-col gap-4">
            <button onClick={() => setUpgradeDialog(null)} className="absolute top-4 right-4 p-1 rounded text-[var(--text-3)] hover:bg-[var(--bg-hover)] cursor-pointer"><X size={14}/></button>
            <div className="text-base font-semibold">购买说明</div>
            <div className="text-sm text-[var(--text-2)] leading-relaxed">
              <p>支付通道还在接入中, 暂时手工开通:</p>
              <ol className="mt-3 ml-5 list-decimal space-y-1.5 text-xs">
                <li>添加客服微信 <span className="font-mono bg-[var(--bg-input)] px-1.5 py-0.5 rounded">monoi-service</span></li>
                <li>截图你想买的套餐/积分包给客服</li>
                <li>客服报价后扫码付款</li>
                <li>客服 24 小时内在后台为你开通</li>
              </ol>
              <p className="mt-3 text-xs text-[var(--text-3)]">支付集成完成后, 这里会变成扫码立刻付款.</p>
            </div>
            <button onClick={() => setUpgradeDialog(null)} className="self-end px-4 py-2 rounded-lg bg-[var(--text)] text-[var(--bg)] text-sm hover:opacity-80 cursor-pointer">知道了</button>
          </div>
        </div>
      )}
    </div>
  )
}


// 用量进度条 (订阅卡里的"本月使用")
function UsageBar({ label, used, total, unit }: { label: string; used: number; total: number; unit: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0
  return (
    <div>
      <div className="flex justify-between text-[11px] text-[var(--text-3)] mb-0.5">
        <span>{label}</span>
        <span>{used} / {total}{unit && ` ${unit}`}</span>
      </div>
      <div className="h-1 rounded-full bg-[var(--bg-input)] overflow-hidden">
        <div className="h-full bg-[var(--text)] transition-all" style={{ width: `${pct}%` }}/>
      </div>
    </div>
  )
}
