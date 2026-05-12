import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Copy, Check, Sparkles, Crown, Zap, Gem } from 'lucide-react'
import {
  fetchPlans, fetchMyCredits, fetchMySubscription, fetchMyReferralCode,
  fetchMyReferrerStatus, fetchMyReferrerBalance, fetchCreditLog,
  type PlansResponse, type CreditBalance, type UserSubscription,
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
  pro_monthly: Zap,
  max_monthly: Crown,
  flagship_yearly: Gem,
}

const fmtDate = (ts?: number) => ts ? new Date(ts * 1000).toLocaleDateString('zh-CN') : '-'
const fmtTime = (ts?: number) => ts ? new Date(ts * 1000).toLocaleString('zh-CN') : '-'

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
  const [upgradeDialog, setUpgradeDialog] = useState<string | null>(null)  // tier code

  useEffect(() => {
    if (!isLoggedIn()) {
      nav('/login')
      return
    }
    Promise.all([
      fetchPlans(),
      fetchMyCredits().catch(e => { console.warn(e); return null }),
      fetchMySubscription().catch(e => { console.warn(e); return null }),
      fetchMyReferralCode().catch(e => { console.warn(e); return null }),
      fetchMyReferrerStatus().catch(e => { console.warn(e); return null }),
      fetchMyReferrerBalance().catch(e => { console.warn(e); return null }),
      fetchCreditLog(20).catch(e => { console.warn(e); return [] }),
    ]).then(([p, c, s, rc, rs, rb, cl]) => {
      setPlans(p)
      setCredits(c)
      setSub(s)
      setRefCode(rc)
      setRefStatus(rs)
      setRefBalance(rb)
      setCreditLog(cl as CreditLogEntry[])
      setLoading(false)
    }).catch(e => {
      setErr(e.message || '加载失败')
      setLoading(false)
    })
  }, [nav])

  const copyLink = () => {
    if (!refCode) return
    navigator.clipboard.writeText(refCode.link).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center text-[var(--text-2)]">
        加载中...
      </div>
    )
  }
  if (err) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center text-red-400 px-4 text-center">
        {err}
      </div>
    )
  }

  const curTier = sub?.tier || 'free'
  const curPlan = curTier === 'free' ? plans?.free : plans?.plans[curTier]

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      {/* Header */}
      <div className="border-b border-[var(--border)] bg-[var(--bg-card)] sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <button onClick={() => nav('/app')} className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] cursor-pointer">
            <ArrowLeft size={18}/>
          </button>
          <div className="text-base font-semibold">账户中心</div>
          <div className="ml-auto text-sm text-[var(--text-3)]">{getUsername()}</div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-6">

        {/* 当前订阅 + 积分余额 (并排) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* 订阅卡 */}
          <div className="p-5 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
            <div className="text-xs text-[var(--text-3)] mb-1.5">当前套餐</div>
            <div className="flex items-baseline gap-2 mb-3">
              <span className="text-2xl font-semibold">{TIER_LABEL[curTier] || curTier}</span>
              {curPlan && curPlan.price_yuan > 0 && (
                <span className="text-xs text-[var(--text-3)]">¥{curPlan.price_yuan}</span>
              )}
            </div>
            {curTier !== 'free' && sub?.current_period_end ? (
              <div className="text-xs text-[var(--text-2)]">
                到期: {fmtDate(sub.current_period_end)}
                {sub.expired && <span className="text-red-400 ml-2">已过期</span>}
              </div>
            ) : (
              <div className="text-xs text-[var(--text-3)]">免费体验中, 50 积分 + 视频带 monoi 水印</div>
            )}
          </div>

          {/* 积分卡 */}
          <div className="p-5 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
            <div className="text-xs text-[var(--text-3)] mb-1.5">积分余额</div>
            <div className="text-2xl font-semibold mb-3">{credits?.total ?? 0}</div>
            <div className="text-xs text-[var(--text-2)] flex gap-3">
              <span>月送 <b className="text-[var(--text)]">{credits?.monthly ?? 0}</b></span>
              <span>加买 <b className="text-[var(--text)]">{credits?.purchased ?? 0}</b></span>
            </div>
          </div>
        </div>

        {/* 套餐列表 (升级入口) */}
        <div>
          <div className="text-sm font-medium mb-3">套餐</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {plans && Object.entries(plans.plans).map(([code, p]) => {
              const Icon = TIER_ICON[code] || Sparkles
              const isCurrent = curTier === code
              return (
                <div key={code} className={`p-4 rounded-2xl border ${isCurrent ? 'border-[var(--text)] bg-[var(--bg-hover)]' : 'border-[var(--border)] bg-[var(--bg-card)]'} flex flex-col gap-2.5`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon size={16} className="text-[var(--text-2)]"/>
                      <span className="text-base font-semibold">{p.name}</span>
                    </div>
                    {isCurrent && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--text)] text-[var(--bg)]">当前</span>}
                  </div>
                  <div className="text-xl font-semibold">
                    ¥{p.price_yuan}
                    <span className="text-xs text-[var(--text-3)] font-normal ml-1">
                      / {code === 'flagship_yearly' ? '年' : '月'}
                    </span>
                  </div>
                  <ul className="text-xs text-[var(--text-2)] space-y-1 flex-1">
                    <li>· 月送 <b>{p.monthly_credits}</b> 积分</li>
                    <li>· 数字人 <b>{p.digital_human_quota}</b> 条/月</li>
                    <li>· 克隆音色 <b>{p.clone_voice_slots}</b> 个</li>
                    {p.priority_gpu && <li>· 优先 GPU 队列</li>}
                    {p.commercial_license && <li>· 商用授权</li>}
                    {p.multi_platform_account && <li>· 多平台多账号</li>}
                    {p.team_seats && <li>· 团队多席位</li>}
                  </ul>
                  <button
                    onClick={() => setUpgradeDialog(code)}
                    disabled={isCurrent}
                    className={`mt-1 py-2 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                      isCurrent
                        ? 'bg-[var(--bg-hover)] text-[var(--text-3)] cursor-not-allowed'
                        : 'bg-[var(--text)] text-[var(--bg)] hover:opacity-80'
                    }`}
                  >
                    {isCurrent ? '当前套餐' : `升级到 ${p.name}`}
                  </button>
                </div>
              )
            })}
          </div>
        </div>

        {/* 积分包 */}
        <div>
          <div className="text-sm font-medium mb-3">单独购买积分</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {plans && Object.entries(plans.credit_packs).map(([code, pack]) => (
              <div key={code} className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] flex flex-col gap-1.5">
                <div className="text-xs text-[var(--text-3)]">{pack.name}</div>
                <div className="text-lg font-semibold">¥{pack.price_yuan}</div>
                <div className="text-xs text-[var(--text-2)]">{pack.credits} 积分</div>
                <button
                  onClick={() => setUpgradeDialog(code)}
                  className="mt-1 py-1.5 rounded-lg text-xs bg-[var(--bg-hover)] hover:bg-[var(--text-3)] hover:text-[var(--bg)] cursor-pointer transition-colors"
                >
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
              <div className="text-sm font-medium">我的推广</div>
              <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--bg-hover)] text-[var(--text-2)]">
                等级: {refStatus.level === 'normal' ? '普通用户' : refStatus.level === 'certified' ? '认证推广员' : '核心合伙人'}
              </span>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 items-stretch">
              <div className="flex-1 px-3 py-2 rounded-lg bg-[var(--bg-input)] text-xs text-[var(--text-2)] break-all font-mono">
                {refCode.link}
              </div>
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
                💡 当前是普通用户, 推荐人只能得积分奖励. 累计带来 5 个付费用户或 ¥500 流水后, 自动升级为<b>认证推广员</b> (拿现金 30% 首单 + 10%×3 月续费). 月推 20 人或 ¥3000 流水升<b>核心合伙人</b> (50% 首单 + 15%×3 月).
              </div>
            )}
          </div>
        )}

        {/* 积分流水 */}
        {creditLog.length > 0 && (
          <div className="p-5 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
            <div className="text-sm font-medium mb-3">积分流水 (最近 20 条)</div>
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
          <div onClick={e => e.stopPropagation()} className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-ios-lg w-full max-w-md p-6 flex flex-col gap-4">
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
            <button onClick={() => setUpgradeDialog(null)} className="self-end px-4 py-2 rounded-lg bg-[var(--text)] text-[var(--bg)] text-sm hover:opacity-80 cursor-pointer">
              知道了
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
