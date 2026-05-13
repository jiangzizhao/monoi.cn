import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Copy, Check, Crown, Zap, Gem, Gift, ChevronDown, ChevronUp, X,
  QrCode, Download, User, Wallet, History, Share2, Shield, Edit2, Camera,
} from 'lucide-react'
import { QRCodeCanvas } from 'qrcode.react'
import {
  fetchPlans, fetchMyCredits, fetchMySubscription, fetchMyReferralCode,
  fetchMyReferrerStatus, fetchMyReferrerBalance, fetchCreditLog,
  fetchMyProfile, updateProfile, changePassword,
  type PlansResponse, type PlanConfig, type CreditBalance, type UserSubscription,
  type ReferralCode, type ReferrerStatus, type ReferrerBalance, type CreditLogEntry,
  type UserProfile,
} from '../services/billing'
import { isLoggedIn } from '../lib/auth'


// ========== 常量 ==========

type TabKey = 'profile' | 'membership' | 'credits' | 'transactions' | 'referral' | 'security'

const TABS: { key: TabKey; label: string; Icon: any }[] = [
  { key: 'profile',      label: '个人资料', Icon: User },
  { key: 'membership',   label: '会员中心', Icon: Crown },
  { key: 'credits',      label: '充值积分', Icon: Wallet },
  { key: 'transactions', label: '消费记录', Icon: History },
  { key: 'referral',     label: '我的推广', Icon: Share2 },
  { key: 'security',     label: '安全设置', Icon: Shield },
]

const TIER_LABEL: Record<string, string> = {
  free: '免费', pro_monthly: 'Pro', max_monthly: 'Max', flagship_yearly: '旗舰',
}
const TIER_ICON: Record<string, any> = {
  free: Gift, pro_monthly: Zap, max_monthly: Crown, flagship_yearly: Gem,
}
const TIER_ORDER: ('free' | 'pro_monthly' | 'max_monthly' | 'flagship_yearly')[] = [
  'free', 'pro_monthly', 'max_monthly', 'flagship_yearly',
]

const FAQS = [
  { q: '月卡到期不续费会怎样?', a: '自动降级到免费版, 已购买的"加买积分" 永不过期可继续使用, 月送积分会清零.' },
  { q: '升级到 Max 后, 没用完的 Pro 月卡怎么办?', a: '按未使用天数折算成 Max 时长.' },
  { q: '怎么取消自动续费?', a: '账户中心 → 当前订阅 → 取消自动续费. 当前周期内仍可正常使用直到到期.' },
  { q: '数字人配额怎么算?', a: '不论视频时长, 生成一次就算 1 条配额. 单视频时长上限按套餐档位.' },
  { q: '商用授权能干什么?', a: 'Max+ 可以用 monoi 帮客户做付费视频接活. 旗舰还有"转售授权" 可以代理 monoi 给客户.' },
  { q: 'API 访问什么时候开?', a: 'V2 阶段开放 (预计 2026 Q3), 旗舰用户优先开 API key.' },
  { q: '积分用完了怎么办?', a: '可以单独买积分包. 月会员买积分有阶梯折扣 (Pro 1.5x / Max 2x / 旗舰 2.5x).' },
  { q: '退款政策?', a: '所有套餐和积分包不支持退款, 请按需购买. 月卡可随时取消自动续费, 当期用完为止.' },
]

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
  { key: 'max_resolution', label: '导出清晰度', render: p => p.max_resolution },
  { key: 'clone_voice_slots', label: '克隆音色', render: p => `${p.clone_voice_slots} 个` },
  { key: 'priority_gpu', label: '优先 GPU 队列', group: '功能', render: p => p.priority_gpu ? '✓' : '✗' },
  { key: 'watermark', label: '视频水印', render: p => p.watermark ? '带 monoi 水印' : '无水印' },
  { key: 'commercial_license', label: '商用授权', render: p => p.commercial_license ? '✓' : '✗' },
  { key: 'transferable_license', label: '转售授权', render: p => p.transferable_license ? '✓' : '✗' },
  { key: 'multi_platform_accounts', label: '多平台账号数', render: p => `${p.multi_platform_accounts} 个` },
  { key: 'team_seats', label: '团队子账号', render: p => p.team_seats > 0 ? `${p.team_seats} 个` : '—' },
  { key: 'vip_support', label: 'VIP 1v1 客服', group: '服务', render: p => p.vip_support ? '✓' : '✗' },
  { key: 'early_access', label: '提前体验新功能', render: p => p.early_access ? '✓' : '✗' },
  { key: 'api_access', label: 'API 访问', render: p => p.api_access ? '✓' : '✗' },
  { key: 'referral_boost', label: '推广分成提升', render: p => p.referral_boost ? '一次性 30%' : '按等级' },
  { key: 'support_response_hours', label: '客服响应', render: p => `${p.support_response_hours}h` },
  { key: 'credit_pack_rate', label: '加买积分单价', group: '积分包', render: p => `¥1 = ${p.credit_pack_rate} 积分` },
]

function planHighlights(tier: string, p: PlanConfig): string[] {
  const base = [
    `${p.monthly_credits} 积分/月`,
    `${p.digital_human_quota} 条数字人/月`,
    `${p.unlimited_duration ? '不限时长' : `≤ ${p.max_video_minutes} 分钟`}`,
    `${p.max_resolution} 导出`,
    `${p.clone_voice_slots} 个克隆音色`,
  ]
  if (tier === 'free') base.push('视频带 monoi 水印')
  else if (tier === 'pro_monthly') base.push('无水印', `${p.multi_platform_accounts} 个平台账号`)
  else if (tier === 'max_monthly') base.push('优先 GPU 队列', '商用授权', `${p.multi_platform_accounts} 个平台账号`)
  else if (tier === 'flagship_yearly') base.push('VIP 1v1 客服', '提前体验新功能', '商用 + 转售授权', `团队 ${p.team_seats} 席位`)
  return base
}

const fmtDate = (ts?: number | string) => {
  if (!ts) return '-'
  const n = typeof ts === 'string' ? new Date(ts).getTime() / 1000 : ts
  return new Date(n * 1000).toLocaleDateString('zh-CN')
}
const fmtTime = (ts?: number) => ts ? new Date(ts * 1000).toLocaleString('zh-CN') : '-'
const daysLeft = (ts?: number) => ts ? Math.max(0, Math.ceil((ts - Date.now()/1000) / 86400)) : 0


// ========== 主组件 ==========

export default function Account() {
  const nav = useNavigate()

  // tab 从 URL hash 读 (#profile / #membership ...), 默认 profile
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    const h = window.location.hash.replace('#', '')
    return (TABS.find(t => t.key === h)?.key as TabKey) || 'profile'
  })
  useEffect(() => {
    window.location.hash = activeTab
  }, [activeTab])

  // 共享数据
  const [plans, setPlans] = useState<PlansResponse | null>(null)
  const [me, setMe] = useState<UserProfile | null>(null)
  const [credits, setCredits] = useState<CreditBalance | null>(null)
  const [sub, setSub] = useState<UserSubscription | null>(null)
  const [refCode, setRefCode] = useState<ReferralCode | null>(null)
  const [refStatus, setRefStatus] = useState<ReferrerStatus | null>(null)
  const [refBalance, setRefBalance] = useState<ReferrerBalance | null>(null)
  const [creditLog, setCreditLog] = useState<CreditLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  // 弹窗
  const [upgradeDialog, setUpgradeDialog] = useState<string | null>(null)
  const [qrOpen, setQrOpen] = useState(false)

  useEffect(() => {
    if (!isLoggedIn()) { nav('/login'); return }
    reloadAll()
  }, [nav])

  const reloadAll = () => {
    setLoading(true)
    Promise.all([
      fetchPlans(),
      fetchMyProfile().catch(e => { console.warn(e); return null }),
      fetchMyCredits().catch(e => { console.warn(e); return null }),
      fetchMySubscription().catch(e => { console.warn(e); return null }),
      fetchMyReferralCode().catch(e => { console.warn(e); return null }),
      fetchMyReferrerStatus().catch(e => { console.warn(e); return null }),
      fetchMyReferrerBalance().catch(e => { console.warn(e); return null }),
      fetchCreditLog(50).catch(e => { console.warn(e); return [] }),
    ]).then(([p, m, c, s, rc, rs, rb, cl]) => {
      setPlans(p); setMe(m); setCredits(c); setSub(s); setRefCode(rc); setRefStatus(rs); setRefBalance(rb); setCreditLog(cl as CreditLogEntry[])
      setLoading(false)
    }).catch(e => { setErr(e.message || '加载失败'); setLoading(false) })
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-[var(--text-2)]">加载中...</div>
  if (err) return <div className="min-h-screen flex items-center justify-center text-red-400 px-4">{err}</div>

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      {/* Header */}
      <div className="border-b border-[var(--border)] bg-[var(--bg-card)] sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <button onClick={() => nav('/app')} className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] cursor-pointer"><ArrowLeft size={18}/></button>
          <div className="text-base font-semibold">账户中心</div>
          <div className="ml-auto text-sm text-[var(--text-3)]">{me?.username || ''}</div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 flex flex-col lg:flex-row gap-6">

        {/* 左侧/顶部 nav */}
        <nav className="lg:w-52 flex-shrink-0">
          {/* 手机/平板 横向 scroll */}
          <div className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible pb-1 lg:pb-0">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm whitespace-nowrap transition-colors cursor-pointer ${
                  activeTab === t.key
                    ? 'bg-[var(--text)] text-[var(--bg)]'
                    : 'text-[var(--text-2)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                <t.Icon size={15}/>
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </nav>

        {/* 右侧内容 */}
        <div className="flex-1 min-w-0 flex flex-col gap-6">
          {activeTab === 'profile' && <ProfileTab me={me} sub={sub} credits={credits} refCode={refCode} plans={plans} onReload={reloadAll}/>}
          {activeTab === 'membership' && <MembershipTab sub={sub} plans={plans} credits={credits} onUpgrade={t => setUpgradeDialog(t)}/>}
          {activeTab === 'credits' && <CreditsTab credits={credits} plans={plans} sub={sub} onBuyPack={c => setUpgradeDialog(c)}/>}
          {activeTab === 'transactions' && <TransactionsTab creditLog={creditLog}/>}
          {activeTab === 'referral' && <ReferralTab refCode={refCode} refStatus={refStatus} refBalance={refBalance} onShowQr={() => setQrOpen(true)}/>}
          {activeTab === 'security' && <SecurityTab me={me} onReload={reloadAll}/>}
        </div>
      </div>

      {/* 二维码弹窗 */}
      {qrOpen && refCode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setQrOpen(false)}>
          <div onClick={e => e.stopPropagation()} className="relative bg-white text-black rounded-2xl shadow-ios-lg w-full max-w-xs p-6 flex flex-col items-center gap-4">
            <button onClick={() => setQrOpen(false)} className="absolute top-3 right-3 p-1 rounded text-gray-400 hover:bg-gray-100 cursor-pointer"><X size={14}/></button>
            <div className="text-sm font-medium">我的推广二维码</div>
            <div id="monoi-qr-wrap" className="p-3 bg-white rounded-lg border border-gray-200">
              <QRCodeCanvas value={refCode.link} size={220} level="M" includeMargin={false}/>
            </div>
            <div className="text-xs text-gray-600 text-center break-all px-2 font-mono">{refCode.link}</div>
            <div className="text-[11px] text-gray-500 text-center leading-relaxed">
              分享到朋友圈, 别人扫码注册即绑定为你的下线<br/>注册成功双方各得 30 积分
            </div>
            <button onClick={() => {
              const canvas = document.querySelector('#monoi-qr-wrap canvas') as HTMLCanvasElement
              if (!canvas) return
              const a = document.createElement('a')
              a.href = canvas.toDataURL('image/png')
              a.download = `monoi-推广-${refCode.referral_code}.png`
              a.click()
            }} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-black text-white text-xs hover:opacity-80 cursor-pointer">
              <Download size={12}/> 保存图片
            </button>
          </div>
        </div>
      )}

      {/* 升级/购买弹窗 (V1: 引导客服微信) */}
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


// ========== Tab 1: 个人资料 ==========

function ProfileTab({ me, sub, credits, refCode, plans, onReload }: {
  me: UserProfile | null; sub: UserSubscription | null; credits: CreditBalance | null
  refCode: ReferralCode | null; plans: PlansResponse | null; onReload: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [username, setUsername] = useState(me?.username || '')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const save = async () => {
    if (!username.trim() || username.length < 2) { setMsg('用户名至少 2 个字符'); return }
    setSaving(true)
    try {
      await updateProfile({ username: username.trim() })
      setMsg('已保存')
      setEditing(false)
      onReload()
    } catch (e: any) {
      setMsg(e.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const curTier = sub?.tier || 'free'
  const TierIcon = TIER_ICON[curTier]
  const curPlan = curTier === 'free' ? plans?.free : plans?.plans[curTier]

  return (
    <>
      {/* 头像区 */}
      <div className="p-6 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] flex items-center gap-5">
        <div className="relative">
          <div className="w-20 h-20 rounded-full bg-[var(--text)] text-[var(--bg)] flex items-center justify-center text-2xl font-bold">
            {me?.username?.[0]?.toUpperCase() || 'M'}
          </div>
          <button title="上传头像 (功能待开发)" className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-[var(--bg-card)] border border-[var(--border)] flex items-center justify-center text-[var(--text-2)] hover:bg-[var(--bg-hover)] cursor-pointer">
            <Camera size={13}/>
          </button>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {editing ? (
              <input value={username} onChange={e => setUsername(e.target.value)}
                className="bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-1 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--text-3)]"/>
            ) : (
              <span className="text-lg font-semibold">{me?.username}</span>
            )}
            {!editing ? (
              <button onClick={() => { setUsername(me?.username || ''); setEditing(true) }} className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-3)] cursor-pointer">
                <Edit2 size={13}/>
              </button>
            ) : (
              <>
                <button onClick={save} disabled={saving} className="px-2 py-0.5 rounded bg-[var(--text)] text-[var(--bg)] text-xs hover:opacity-80 cursor-pointer">保存</button>
                <button onClick={() => setEditing(false)} className="px-2 py-0.5 rounded border border-[var(--border)] text-xs cursor-pointer">取消</button>
              </>
            )}
          </div>
          {msg && <div className="text-xs text-green-500 mb-1">{msg}</div>}
          <div className="text-xs text-[var(--text-3)]">注册于 {fmtDate(me?.created_at)}</div>
        </div>
      </div>

      {/* 账号信息 */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--border)] text-sm font-medium">账号信息</div>
        <div className="divide-y divide-[var(--border-subtle)]">
          <Row label="邮箱" value={me?.email || '-'} note="(注册时绑定, 不可改; 用于找回密码)"/>
          <Row label="手机号" value={me?.phone_masked || '-'} action={
            <span className="text-xs text-[var(--text-3)]">换绑 → 安全设置</span>
          }/>
          <Row label="当前套餐" value={
            <div className="flex items-center gap-2">
              <TierIcon size={14} className="text-[var(--text-2)]"/>
              <span>{TIER_LABEL[curTier]}</span>
              {curPlan && curPlan.price_yuan > 0 && (
                <span className="text-xs text-[var(--text-3)]">¥{curPlan.price_yuan}/{curPlan.period_days === 365 ? '年' : '月'}</span>
              )}
              {curTier !== 'free' && sub?.current_period_end && (
                <span className="text-xs text-[var(--text-3)] ml-2">剩 {daysLeft(sub.current_period_end)} 天</span>
              )}
            </div>
          }/>
          <Row label="积分余额" value={
            <span><b>{credits?.total || 0}</b> <span className="text-xs text-[var(--text-3)]">(月送 {credits?.monthly || 0} + 加买 {credits?.purchased || 0})</span></span>
          }/>
          <Row label="我的推广码" value={
            <span className="font-mono text-sm">{refCode?.referral_code || '-'}</span>
          } note="分享你的推广链接, 别人注册成功双方各得 30 积分"/>
        </div>
      </div>
    </>
  )
}

function Row({ label, value, note, action }: { label: string; value: React.ReactNode; note?: string; action?: React.ReactNode }) {
  return (
    <div className="px-5 py-3 flex items-center gap-3">
      <span className="text-sm text-[var(--text-3)] w-24 flex-shrink-0">{label}</span>
      <span className="flex-1 text-sm text-[var(--text)] flex items-center gap-2 min-w-0">
        {value}
        {note && <span className="text-[11px] text-[var(--text-3)]">{note}</span>}
      </span>
      {action}
    </div>
  )
}


// ========== Tab 2: 会员中心 ==========

function MembershipTab({ sub, plans, credits, onUpgrade }: {
  sub: UserSubscription | null; plans: PlansResponse | null; credits: CreditBalance | null
  onUpgrade: (tier: string) => void
}) {
  const [compareOpen, setCompareOpen] = useState(true)
  const [faqOpen, setFaqOpen] = useState<number | null>(null)
  const curTier = sub?.tier || 'free'
  const curPlan: PlanConfig | undefined = curTier === 'free' ? plans?.free : plans?.plans[curTier]

  return (
    <>
      {/* 当前订阅 + 用量 */}
      <div className="p-5 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
        <div className="text-xs text-[var(--text-3)] mb-1.5">当前套餐</div>
        <div className="flex items-baseline gap-2 mb-3">
          <span className="text-2xl font-semibold">{TIER_LABEL[curTier]}</span>
          {curPlan && curPlan.price_yuan > 0 && (
            <span className="text-xs text-[var(--text-3)]">¥{curPlan.price_yuan}/{curPlan.period_days === 365 ? '年' : '月'}</span>
          )}
        </div>
        {curTier !== 'free' && sub?.current_period_end ? (
          <>
            <div className="text-xs text-[var(--text-2)] mb-3">到期 {fmtDate(sub.current_period_end)} · 剩 {daysLeft(sub.current_period_end)} 天</div>
            {curPlan && (
              <div className="space-y-1.5">
                <UsageBar label="数字人" used={0} total={curPlan.digital_human_quota} unit="条"/>
                <UsageBar label="积分" used={credits?.monthly ? curPlan.monthly_credits - credits.monthly : 0} total={curPlan.monthly_credits} unit=""/>
              </div>
            )}
          </>
        ) : (
          <div className="text-xs text-[var(--text-3)]">免费体验中 · {curPlan?.monthly_credits || 50} 积分 · 视频带 monoi 水印</div>
        )}
      </div>

      {/* 4 套餐选择 */}
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
                {isMax && !isCurrent && <Badge color="bg-amber-400 text-black">⭐ 最受欢迎</Badge>}
                {isFlagship && !isCurrent && <Badge color="bg-purple-500 text-white">💎 工作室专属</Badge>}
                {isCurrent && <Badge color="bg-[var(--text)] text-[var(--bg)]">✓ 当前</Badge>}
                <div className="flex items-center gap-2">
                  <Icon size={18} className={isFlagship ? 'text-purple-500' : isMax ? 'text-amber-400' : 'text-[var(--text-2)]'}/>
                  <span className="text-base font-semibold">{p.name}</span>
                </div>
                <div className="text-2xl font-semibold">
                  {p.price_yuan === 0 ? '免费' : `¥${p.price_yuan}`}
                  {p.price_yuan > 0 && <span className="text-xs text-[var(--text-3)] font-normal ml-1">/ {p.period_days === 365 ? '年' : '月'}</span>}
                </div>
                <ul className="text-xs text-[var(--text-2)] space-y-1 flex-1">
                  {planHighlights(tier, p).map((h, i) => (
                    <li key={i} className="flex items-start gap-1.5"><span className="text-[var(--text-3)] mt-0.5">·</span><span>{h}</span></li>
                  ))}
                </ul>
                <button onClick={() => !isCurrent && onUpgrade(tier)} disabled={isCurrent}
                  className={`mt-1 py-2.5 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                    isCurrent ? 'bg-[var(--bg-hover)] text-[var(--text-3)] cursor-not-allowed' :
                    isMax ? 'bg-amber-400 text-black hover:opacity-90' :
                    isFlagship ? 'bg-purple-500 text-white hover:opacity-90' :
                    tier === 'free' ? 'bg-[var(--bg-hover)] text-[var(--text-2)]' :
                    'bg-[var(--text)] text-[var(--bg)] hover:opacity-80'
                  }`}>
                  {isCurrent ? '当前使用' : tier === 'free' ? '免费版' : `开通 ${p.name}`}
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* 对比表 */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden">
        <button onClick={() => setCompareOpen(o => !o)} className="w-full flex items-center justify-between px-5 py-3.5 cursor-pointer hover:bg-[var(--bg-hover)]">
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
                    return <th key={t} className={`text-center px-3 py-2.5 font-medium ${isMax ? 'text-amber-500' : 'text-[var(--text-2)]'}`}>{TIER_LABEL[t]}</th>
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
                        <tr key={`g-${i}`} className="bg-[var(--bg-input)]"><td colSpan={5} className="px-4 py-1.5 text-[10px] text-[var(--text-3)] uppercase">{row.group}</td></tr>
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

      {/* FAQ */}
      <div className="p-5 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
        <div className="text-base font-semibold mb-3">常见问题</div>
        <div className="flex flex-col gap-1">
          {FAQS.map((f, i) => (
            <div key={i} className="border-b border-[var(--border-subtle)] last:border-b-0">
              <button onClick={() => setFaqOpen(faqOpen === i ? null : i)} className="w-full flex items-center justify-between py-2.5 text-left cursor-pointer">
                <span className="text-sm">{f.q}</span>
                {faqOpen === i ? <ChevronUp size={14} className="text-[var(--text-3)]"/> : <ChevronDown size={14} className="text-[var(--text-3)]"/>}
              </button>
              {faqOpen === i && <div className="pb-3 text-xs text-[var(--text-2)] leading-relaxed">{f.a}</div>}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return <div className={`absolute -top-2.5 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full text-[10px] font-medium ${color}`}>{children}</div>
}

function UsageBar({ label, used, total, unit }: { label: string; used: number; total: number; unit: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0
  return (
    <div>
      <div className="flex justify-between text-[11px] text-[var(--text-3)] mb-0.5">
        <span>{label}</span><span>{used} / {total}{unit && ` ${unit}`}</span>
      </div>
      <div className="h-1 rounded-full bg-[var(--bg-input)] overflow-hidden">
        <div className="h-full bg-[var(--text)] transition-all" style={{ width: `${pct}%` }}/>
      </div>
    </div>
  )
}


// ========== Tab 3: 充值积分 ==========

function CreditsTab({ credits, plans, sub, onBuyPack }: {
  credits: CreditBalance | null; plans: PlansResponse | null; sub: UserSubscription | null
  onBuyPack: (code: string) => void
}) {
  const curTier = sub?.tier || 'free'
  const tierRate = curTier === 'free' ? 10 : plans?.plans[curTier]?.credit_pack_rate || 10

  return (
    <>
      {/* 余额卡 */}
      <div className="p-6 rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--bg-card)] to-[var(--bg-hover)]">
        <div className="text-xs text-[var(--text-3)] mb-2">当前积分余额</div>
        <div className="text-4xl font-bold mb-3">{credits?.total ?? 0}</div>
        <div className="text-xs text-[var(--text-2)] flex gap-4">
          <span>月送 <b className="text-[var(--text)]">{credits?.monthly ?? 0}</b> <span className="text-[10px] text-[var(--text-3)]">(月底清零)</span></span>
          <span>加买 <b className="text-[var(--text)]">{credits?.purchased ?? 0}</b> <span className="text-[10px] text-[var(--text-3)]">(永不过期)</span></span>
        </div>
      </div>

      {/* 充值激励文案 */}
      <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/30">
        <div className="flex items-start gap-2.5">
          <div className="text-lg">🎁</div>
          <div className="flex-1">
            <div className="text-sm font-medium text-amber-900 dark:text-amber-300">你是 {TIER_LABEL[curTier]} 用户, 加买积分有专属折扣</div>
            <div className="text-xs text-amber-800 dark:text-amber-400 mt-1">
              当前充值倍率: <b>¥1 = {tierRate} 积分</b>
              {tierRate > 10 && <span> (比标准价多 {Math.round((tierRate - 10) / 10 * 100)}%)</span>}
              {curTier === 'free' && <span> · 升级 Max 后 ¥1 = 20 积分, 充值更划算</span>}
            </div>
          </div>
        </div>
      </div>

      {/* 积分包 4 档 */}
      <div>
        <div className="text-base font-semibold mb-1">购买积分包</div>
        <div className="text-xs text-[var(--text-3)] mb-4">买完积分永不过期, 可叠加月送积分使用</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {plans && Object.entries(plans.credit_packs).map(([code, pack]) => {
            const baseRate = pack.credits / pack.price_yuan
            const bonus = Math.max(0, Math.round((baseRate / 10 - 1) * 100))
            const isBest = code === 'pack_499'
            return (
              <div key={code} className={`relative p-4 rounded-xl border-2 flex flex-col gap-2 ${isBest ? 'border-amber-400 bg-[var(--bg-card)]' : 'border-[var(--border)] bg-[var(--bg-card)]'}`}>
                {isBest && <div className="absolute -top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-amber-400 text-black text-[9px] font-medium">最划算</div>}
                <div className="text-xs text-[var(--text-3)]">{pack.name}</div>
                <div className="text-2xl font-semibold">¥{pack.price_yuan}</div>
                <div className="text-sm text-[var(--text-2)]">{pack.credits.toLocaleString()} 积分</div>
                {bonus > 0 && <div className="text-[10px] text-amber-500 font-medium">送 {bonus}%</div>}
                <button onClick={() => onBuyPack(code)} className="mt-1 py-2 rounded-lg text-xs bg-[var(--text)] text-[var(--bg)] hover:opacity-80 cursor-pointer">购买</button>
              </div>
            )
          })}
        </div>
      </div>

      {/* 积分扣减规则 */}
      <div className="p-5 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
        <div className="text-sm font-medium mb-3">积分能做什么</div>
        <div className="text-xs text-[var(--text-2)] grid grid-cols-1 sm:grid-cols-2 gap-y-1.5 gap-x-4">
          <div className="flex justify-between"><span>数字人合成</span><span className="text-[var(--text-3)]">2 积分/秒 (30s ≈ 60 分)</span></div>
          <div className="flex justify-between"><span>配音 (预设)</span><span className="text-[var(--text-3)]">0.5 积分/秒 (30s ≈ 15 分)</span></div>
          <div className="flex justify-between"><span>配音 (克隆)</span><span className="text-[var(--text-3)]">1.5 积分/秒 (30s ≈ 45 分)</span></div>
          <div className="flex justify-between"><span>一键合成</span><span className="text-[var(--text-3)]">10 积分/次</span></div>
          <div className="flex justify-between"><span>口播剪辑</span><span className="text-[var(--text-3)]">5 积分/次</span></div>
          <div className="flex justify-between"><span>AI 文案 / 素材匹配</span><span className="text-green-500">免费 ✓</span></div>
          <div className="flex justify-between"><span>封面生成</span><span className="text-green-500">免费 ✓</span></div>
          <div className="flex justify-between"><span>自动发布</span><span className="text-green-500">免费 ✓</span></div>
        </div>
      </div>
    </>
  )
}


// ========== Tab 4: 消费记录 ==========

function TransactionsTab({ creditLog }: { creditLog: CreditLogEntry[] }) {
  const [subTab, setSubTab] = useState<'credit' | 'order'>('credit')
  return (
    <>
      <div className="flex border-b border-[var(--border)]">
        {[
          { k: 'credit', l: '积分流水' },
          { k: 'order', l: '订单记录' },
        ].map(t => (
          <button key={t.k} onClick={() => setSubTab(t.k as any)}
            className={`px-4 py-2.5 text-sm cursor-pointer transition-colors ${subTab === t.k ? 'text-[var(--text)] border-b-2 border-[var(--text)]' : 'text-[var(--text-3)]'}`}>
            {t.l}
          </button>
        ))}
      </div>

      {subTab === 'credit' && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden">
          {creditLog.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-[var(--text-3)]">还没有积分流水</div>
          ) : (
            <div className="divide-y divide-[var(--border-subtle)]">
              {creditLog.map(log => (
                <div key={log.id} className="px-5 py-3 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-[var(--text-3)] w-32">{fmtTime(log.created_at)}</span>
                    <span className="text-[var(--text-2)]">{log.feature || log.source}</span>
                  </div>
                  <span className={log.delta > 0 ? 'text-green-500 font-medium' : 'text-red-400 font-medium'}>
                    {log.delta > 0 ? '+' : ''}{log.delta}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {subTab === 'order' && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] px-5 py-8 text-center text-sm text-[var(--text-3)]">
          订单记录功能开发中, 等支付接通后这里会显示所有套餐 + 积分包订单
        </div>
      )}
    </>
  )
}


// ========== Tab 5: 我的推广 ==========

function ReferralTab({ refCode, refStatus, refBalance, onShowQr }: {
  refCode: ReferralCode | null; refStatus: ReferrerStatus | null; refBalance: ReferrerBalance | null
  onShowQr: () => void
}) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    if (!refCode) return
    navigator.clipboard.writeText(refCode.link).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    })
  }
  if (!refCode || !refStatus) return null
  return (
    <>
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
          <button onClick={copy} className="px-4 py-2 rounded-lg bg-[var(--text)] text-[var(--bg)] text-sm hover:opacity-80 cursor-pointer inline-flex items-center justify-center gap-1.5">
            {copied ? <><Check size={14}/> 已复制</> : <><Copy size={14}/> 复制链接</>}
          </button>
          <button onClick={onShowQr} className="px-4 py-2 rounded-lg border border-[var(--border)] text-[var(--text-2)] text-sm hover:bg-[var(--bg-hover)] cursor-pointer inline-flex items-center justify-center gap-1.5">
            <QrCode size={14}/> 二维码
          </button>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3 text-xs text-[var(--text-2)]">
          <Stat label="累计带来付费" value={refStatus.total_paying_users.toString()}/>
          <Stat label="累计推广流水" value={`¥${(refStatus.total_revenue_brought || 0).toFixed(2)}`}/>
          <Stat label="现金余额" value={`¥${(refBalance?.cash_balance || 0).toFixed(2)}`}/>
        </div>
        {refStatus.level === 'normal' && (
          <div className="mt-3 text-[11px] text-[var(--text-3)] leading-relaxed">
            💡 普通用户推荐拿积分奖励. 累计带来 5 个付费用户或 ¥500 流水后, 自动升级为认证推广员 (拿现金 30% 首单 + 10%×3 月续费). 月推 20 人或 ¥3000 流水升核心合伙人 (50% + 15%×3 月).
          </div>
        )}
      </div>

      <div className="p-5 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
        <div className="text-sm font-medium mb-2">推广规则</div>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[var(--text-3)] border-b border-[var(--border-subtle)]">
              <th className="text-left py-2">级别</th>
              <th className="text-center py-2">首单分成</th>
              <th className="text-center py-2">续费分成</th>
              <th className="text-center py-2">触发条件</th>
            </tr>
          </thead>
          <tbody className="text-[var(--text-2)]">
            <tr className="border-b border-[var(--border-subtle)]">
              <td className="py-2">普通用户</td>
              <td className="text-center">30% 积分</td>
              <td className="text-center">无</td>
              <td className="text-center text-[10px]">默认</td>
            </tr>
            <tr className="border-b border-[var(--border-subtle)]">
              <td className="py-2">认证推广员</td>
              <td className="text-center text-green-500">30% 现金</td>
              <td className="text-center">10%×3 月</td>
              <td className="text-center text-[10px]">5 付费 或 ¥500 流水</td>
            </tr>
            <tr>
              <td className="py-2">核心合伙人</td>
              <td className="text-center text-green-500">50% 现金</td>
              <td className="text-center">15%×3 月</td>
              <td className="text-center text-[10px]">月推 20 人 或 ¥3000</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] text-[var(--text-3)]">{label}</div>
      <div className="text-base font-semibold text-[var(--text)]">{value}</div>
    </div>
  )
}


// ========== Tab 6: 安全设置 ==========

function SecurityTab({ me, onReload }: { me: UserProfile | null; onReload: () => void }) {
  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState('')

  const submit = async () => {
    setMsg('')
    if (!oldPwd || !newPwd) return
    if (newPwd.length < 6) { setMsg('新密码至少 6 位'); return }
    if (newPwd !== confirmPwd) { setMsg('两次输入不一致'); return }
    setSubmitting(true)
    try {
      await changePassword(oldPwd, newPwd)
      setMsg('密码修改成功')
      setOldPwd(''); setNewPwd(''); setConfirmPwd('')
      onReload()
    } catch (e: any) {
      setMsg(e.message || '修改失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <div className="p-5 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
        <div className="text-base font-semibold mb-3">修改密码</div>
        <div className="flex flex-col gap-2.5 max-w-sm">
          <input type="password" placeholder="原密码" value={oldPwd} onChange={e => setOldPwd(e.target.value)}
            className="bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--text-3)]"/>
          <input type="password" placeholder="新密码 (≥ 6 位)" value={newPwd} onChange={e => setNewPwd(e.target.value)}
            className="bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--text-3)]"/>
          <input type="password" placeholder="确认新密码" value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)}
            className="bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--text-3)]"/>
          {msg && <div className={`text-xs ${msg.includes('成功') ? 'text-green-500' : 'text-red-400'}`}>{msg}</div>}
          <button onClick={submit} disabled={submitting || !oldPwd || !newPwd}
            className="self-start px-4 py-2 rounded-lg bg-[var(--text)] text-[var(--bg)] text-sm hover:opacity-80 disabled:opacity-40 cursor-pointer">
            {submitting ? '提交中' : '修改密码'}
          </button>
        </div>
      </div>

      <div className="p-5 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
        <div className="text-base font-semibold mb-3">手机号换绑</div>
        <div className="text-sm text-[var(--text-2)] mb-2">当前手机号: <span className="font-mono">{me?.phone_masked || '-'}</span></div>
        <div className="text-xs text-[var(--text-3)]">需要双因素验证 (新旧手机都收验证码), 功能开发中</div>
      </div>

      <div className="p-5 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
        <div className="text-base font-semibold mb-3">第三方绑定</div>
        <div className="flex items-center justify-between py-2 border-b border-[var(--border-subtle)]">
          <span className="text-sm">微信</span>
          <span className="text-xs text-[var(--text-3)]">未绑定 (V2 开放)</span>
        </div>
        <div className="flex items-center justify-between py-2">
          <span className="text-sm">支付宝</span>
          <span className="text-xs text-[var(--text-3)]">未绑定 (V2 开放)</span>
        </div>
      </div>
    </>
  )
}
