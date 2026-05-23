import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Copy, Check, Crown, Zap, Gem, Gift, ChevronDown, ChevronUp, X,
  QrCode, Download, User, Wallet, History, Share2, Shield, Edit2, Camera,
  TrendingUp, ArrowRight, Sticker,
} from 'lucide-react'
import { PersonLibrary } from '../components/chat/forms/PersonLibrary'
import { QRCodeCanvas } from 'qrcode.react'
import {
  fetchPlans, fetchMyCredits, fetchMySubscription, fetchMyReferralCode,
  fetchMyReferrerStatus, fetchMyReferrerBalance, fetchCreditLog, fetchMyOrders,
  fetchMyProfile, updateProfile, changePassword, fetchMyReferralRecords, rebindPhone,
  checkReferrerUpgrade,
  type PlansResponse, type PlanConfig, type CreditBalance, type UserSubscription,
  type ReferralCode, type ReferrerStatus, type ReferrerBalance, type CreditLogEntry,
  type OrderEntry,
  type UserProfile, type ReferredUser, type CommissionDetail,
} from '../services/billing'
import { sendSmsCode, getToken } from '../lib/auth'
import { isLoggedIn } from '../lib/auth'
import { PaymentDialog } from '../components/PaymentDialog'


// ========== 常量 ==========

type TabKey = 'profile' | 'membership' | 'credits' | 'transactions' | 'referral' | 'cutouts' | 'security'

const TABS: { key: TabKey; label: string; Icon: any }[] = [
  { key: 'profile',      label: '个人资料', Icon: User },
  { key: 'membership',   label: '会员中心', Icon: Crown },
  { key: 'credits',      label: '充值积分', Icon: Wallet },
  { key: 'transactions', label: '我的账单', Icon: History },
  { key: 'cutouts',      label: '我的人物', Icon: Sticker },
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

// 对比表 — 简化版本, 只显示**真实生效**的字段 + 真正落地的功能
// (单视频时长 / 清晰度 / 优先 GPU / 水印 / 商用授权 / 转售授权 / 多平台账号 / 团队席位 / API
//  现在没在代码里强制限制, 暂时不列, 避免误导用户)
type TierKey = 'free' | 'pro_monthly' | 'max_monthly' | 'flagship_yearly'
const COMPARE_ROWS: Array<{
  label: string
  group?: string
  // 每档显示的内容, 直接写死方便维护
  values: Record<TierKey, string>
}> = [
  // —— 基础 ——
  { label: '价格', group: '基础', values: {
    free: '免费', pro_monthly: '¥99/月', max_monthly: '¥199/月', flagship_yearly: '¥2980/年',
  }},
  { label: '月送积分', values: {
    free: '60/天 × 7 天', pro_monthly: '1,500', max_monthly: '4,000', flagship_yearly: '5,000/月',
  }},
  { label: '克隆音色', values: {
    free: '✗', pro_monthly: '1 个', max_monthly: '3 个', flagship_yearly: '5 个',
  }},
  { label: '数字人形象', values: {
    free: '1 个', pro_monthly: '5 个', max_monthly: '10 个', flagship_yearly: '不限',
  }},

  // —— 主要功能 ——
  { label: '配音预设', group: '主要功能', values: {
    free: '✓', pro_monthly: '✓', max_monthly: '✓', flagship_yearly: '✓',
  }},
  { label: '文案 (原创/仿写/方言)', values: {
    free: '✓', pro_monthly: '✓', max_monthly: '✓', flagship_yearly: '✓',
  }},
  { label: '数字人合成', values: {
    free: '✓', pro_monthly: '✓', max_monthly: '✓', flagship_yearly: '✓',
  }},
  { label: '封面 + 封面模板', values: {
    free: '✓', pro_monthly: '✓', max_monthly: '✓', flagship_yearly: '✓',
  }},
  { label: '克隆声音', values: {
    free: '✗', pro_monthly: '✓', max_monthly: '✓', flagship_yearly: '✓',
  }},
  { label: '素材智能匹配', values: {
    free: '✗', pro_monthly: '✓', max_monthly: '✓', flagship_yearly: '✓',
  }},
  { label: '口播剪辑导出草稿', values: {
    free: '✗', pro_monthly: '✓', max_monthly: '✓', flagship_yearly: '✓',
  }},
  { label: '一键合成 (PIP+BGM+字幕)', values: {
    free: '✗', pro_monthly: '✓', max_monthly: '✓', flagship_yearly: '✓',
  }},
  { label: '抠图人物', values: {
    free: '✗', pro_monthly: '✓', max_monthly: '✓', flagship_yearly: '✓',
  }},
  { label: '去人声 (Demucs)', values: {
    free: '✗', pro_monthly: '✗', max_monthly: '✓', flagship_yearly: '✓',
  }},
  { label: '自动发布', values: {
    free: '✗', pro_monthly: '✗', max_monthly: '✓ Beta', flagship_yearly: '✓ Beta',
  }},

  // —— 专享 ——
  { label: '提前体验新功能', group: '专享', values: {
    free: '✗', pro_monthly: '✗', max_monthly: '✓', flagship_yearly: '✓',
  }},
  { label: 'VIP 1v1 客服', values: {
    free: '✗', pro_monthly: '✗', max_monthly: '✗', flagship_yearly: '✓',
  }},
]

function planHighlights(tier: string, p: PlanConfig): string[] {
  // 每档卡片只列**最直观的差异**, 详细对比表里看完整功能.
  if (tier === 'free') {
    return [
      `${p.monthly_credits} 积分 (7 天体验)`,
      '配音预设',
      '数字人 (1 个形象)',
      '文案 / 封面',
    ]
  }
  if (tier === 'pro_monthly') {
    return [
      `${p.monthly_credits} 积分/月`,
      '配音预设 + 1 个克隆声音',
      '数字人 (5 个形象)',
      '口播剪辑导出草稿',
      '一键合成 + 素材匹配 + 抠图',
      '封面模板',
    ]
  }
  if (tier === 'max_monthly') {
    return [
      `${p.monthly_credits} 积分/月`,
      'Pro 全部功能',
      '3 个克隆声音',
      '数字人 (10 个形象)',
      '去人声 (Demucs)',
      '自动发布 (Beta)',
      '提前体验新功能',
    ]
  }
  if (tier === 'flagship_yearly') {
    return [
      `${p.monthly_credits} 积分/月`,
      'Max 全部功能',
      '5 个克隆声音',
      '数字人 (不限形象)',
      'VIP 1v1 客服',
      '提前体验新功能',
    ]
  }
  return []
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
  // 监听 hash 变化 — 已经在 /account 页时, 别处 nav('/account#xxx') 也能切 tab
  useEffect(() => {
    const onHashChange = () => {
      const h = window.location.hash.replace('#', '')
      const matched = TABS.find(t => t.key === h)?.key as TabKey | undefined
      if (matched) setActiveTab(matched)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  // 共享数据
  const [plans, setPlans] = useState<PlansResponse | null>(null)
  const [me, setMe] = useState<UserProfile | null>(null)
  const [credits, setCredits] = useState<CreditBalance | null>(null)
  const [sub, setSub] = useState<UserSubscription | null>(null)
  const [refCode, setRefCode] = useState<ReferralCode | null>(null)
  const [refStatus, setRefStatus] = useState<ReferrerStatus | null>(null)
  const [refBalance, setRefBalance] = useState<ReferrerBalance | null>(null)
  const [creditLog, setCreditLog] = useState<CreditLogEntry[]>([])
  const [orders, setOrders] = useState<OrderEntry[]>([])
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
      fetchMyOrders(50).catch(e => { console.warn(e); return [] }),
    ]).then(([p, m, c, s, rc, rs, rb, cl, od]) => {
      setPlans(p); setMe(m); setCredits(c); setSub(s); setRefCode(rc); setRefStatus(rs); setRefBalance(rb)
      setCreditLog(cl as CreditLogEntry[])
      setOrders(od as OrderEntry[])
      setLoading(false)
    }).catch(e => { setErr(e.message || '加载失败'); setLoading(false) })
  }

  // 把 product_code (pack_99 / pro_monthly / max_monthly...) 转成友好名字 "体验包" / "Pro 月卡"
  // 同时给 credit_log 里的 feature 字段 (voice_clone / digital_human / pack_99 等) 一个友好名
  const friendlyName = (code?: string): string => {
    if (!code) return '-'
    if (plans?.credit_packs?.[code]) return plans.credit_packs[code].name
    if (plans?.plans?.[code]) return plans.plans[code].name
    if (code === 'free') return '免费版'
    // 消耗类 feature 友好名
    const featureMap: Record<string, string> = {
      voice_preset: '预设音色配音', voice_clone: '克隆音色配音',
      narration_clean: '口播剪辑导出', compose_no_dh: '一键合成', digital_human: '数字人合成',
      script: '文案生成', footage_match: '素材匹配', cover_generate: '封面生成', publish: '自动发布',
      free_signup: '注册赠送', subscription_grant: '会员月度积分', purchase: '加购积分包',
    }
    return featureMap[code] || code
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
          {activeTab === 'transactions' && <TransactionsTab creditLog={creditLog} orders={orders} friendlyName={friendlyName}/>}
          {activeTab === 'cutouts' && <MyCutoutsTab/>}
          {activeTab === 'referral' && <ReferralTab refCode={refCode} refStatus={refStatus} refBalance={refBalance} onShowQr={() => setQrOpen(true)} onReload={reloadAll}/>}
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

      {/* 升级/购买弹窗 — 套餐 + 积分包都走 PaymentDialog (区分 productType) */}
      {upgradeDialog && plans && plans.plans[upgradeDialog] && (
        <PaymentDialog
          open={true}
          planId={upgradeDialog}
          productType="subscription"
          planName={plans.plans[upgradeDialog].name}
          amountYuan={plans.plans[upgradeDialog].price_yuan}
          periodLabel={plans.plans[upgradeDialog].period_days === 365 ? '/年' : '/月'}
          highlights={planHighlights(upgradeDialog, plans.plans[upgradeDialog])}
          onClose={() => setUpgradeDialog(null)}
          onPaid={() => reloadAll()}
        />
      )}
      {upgradeDialog && plans && plans.credit_packs[upgradeDialog] && (
        <PaymentDialog
          open={true}
          planId={upgradeDialog}
          productType="credit_pack"
          planName={plans.credit_packs[upgradeDialog].name}
          amountYuan={plans.credit_packs[upgradeDialog].price_yuan}
          periodLabel=""
          highlights={[
            `${plans.credit_packs[upgradeDialog].credits.toLocaleString()} 积分`,
            '永不过期 · 跟月送积分叠加',
            '所有功能通用',
          ]}
          onClose={() => setUpgradeDialog(null)}
          onPaid={() => reloadAll()}
        />
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
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const directBase = (import.meta as any).env?.VITE_DIRECT_API_URL || 'https://monoi.nat100.top'

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

  const uploadAvatar = async (file: File) => {
    if (!file.type.startsWith('image/')) { setMsg('请选图片文件'); return }
    if (file.size > 5 * 1024 * 1024) { setMsg('图片太大 (>5MB)'); return }
    setUploading(true)
    setMsg('')
    try {
      const signRes = await fetch(directBase + '/api/oss/sign-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken() || ''}` },
        // prefix: 'avatars' — uploads/ 有 24h 生命周期会被删, avatars/ 在持久白名单
        body: JSON.stringify({ filename: file.name, content_type: file.type, prefix: 'avatars' }),
      })
      if (!signRes.ok) throw new Error('签名失败')
      const { put_url, oss_key, content_type } = await signRes.json()
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.onload = () => { (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error(`PUT ${xhr.status}`)) }
        xhr.onerror = () => reject(new Error('上传失败'))
        xhr.open('PUT', put_url)
        xhr.setRequestHeader('Content-Type', content_type)
        xhr.send(file)
      })
      await updateProfile({ avatar_oss_key: oss_key })
      setMsg('头像已更新')
      onReload()
      // 通知 Sidebar / AppShell 重新拉 profile, 否则它们用挂载时的旧头像直到页面刷新
      window.dispatchEvent(new CustomEvent('monoi:profile-updated'))
    } catch (e: any) {
      setMsg(e.message || '上传失败')
    } finally {
      setUploading(false)
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
          <div className="w-20 h-20 rounded-full bg-[var(--text)] text-[var(--bg)] flex items-center justify-center text-2xl font-bold overflow-hidden">
            {me?.avatar_url ? (
              <img src={me.avatar_url} alt="" className="w-full h-full object-cover"/>
            ) : (
              <span>{me?.username?.[0]?.toUpperCase() || 'M'}</span>
            )}
          </div>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            title="上传头像 (jpg/png/webp ≤5MB)"
            className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-[var(--bg-card)] border border-[var(--border)] flex items-center justify-center text-[var(--text-2)] hover:bg-[var(--bg-hover)] cursor-pointer disabled:opacity-50"
          >
            <Camera size={13}/>
          </button>
          <input
            ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) uploadAvatar(f)
              if (fileRef.current) fileRef.current.value = ''
            }}
          />
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
            <span>
              <b>{credits?.total || 0}</b>
              <span className="text-xs text-[var(--text-3)] ml-1">
                (月送 {credits?.monthly || 0} + 加买 {credits?.purchased || 0})
              </span>
            </span>
          } note={credits && credits.monthly_quota > 0 ? `本月已用 ${credits.monthly_used_pct.toFixed(0)}%` : ''}/>
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
              <div className="space-y-2.5">
                <UsageBar
                  label="本月积分"
                  used={credits?.monthly_used ?? 0}
                  total={credits?.monthly_quota || curPlan.monthly_credits}
                  unit="积分"
                  resetAt={credits?.reset_at}
                  showAlert
                />
                {credits && credits.purchased > 0 && (
                  <div className="flex items-center justify-between text-[11px] text-[var(--text-3)] pt-1">
                    <span>额外积分包 (不过期)</span>
                    <span className="text-[var(--text-2)] font-medium">+{credits.purchased}</span>
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="text-xs text-[var(--text-2)] mb-3">免费体验 · 视频带 monoi 水印</div>
            {credits?.daily_grant && (
              <div className="space-y-2.5">
                <UsageBar
                  label={`新人 7 天体验 (第 ${credits.daily_grant.day_index}/${credits.daily_grant.total_days} 天)`}
                  used={credits.monthly_used}
                  total={credits.monthly_quota}
                  unit="积分"
                  showAlert
                />
                <div className="flex items-center justify-between text-[11px] text-[var(--text-3)]">
                  <span>
                    {credits.daily_grant.days_remaining > 0 ? (
                      credits.daily_grant.granted_today
                        ? `今日已领 ${credits.daily_grant.daily_amount} 积分 · 还能领 ${credits.daily_grant.days_remaining - 1} 天`
                        : `今日可领 ${credits.daily_grant.daily_amount} 积分 (打开页面自动到账)`
                    ) : (
                      <span className="text-amber-500">7 天体验已结束, 升级套餐继续享受月度积分</span>
                    )}
                  </span>
                </div>
                {credits.purchased > 0 && (
                  <div className="flex items-center justify-between text-[11px] text-[var(--text-3)] pt-1">
                    <span>额外积分包 (不过期)</span>
                    <span className="text-[var(--text-2)] font-medium">+{credits.purchased}</span>
                  </div>
                )}
              </div>
            )}
          </>
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
              <div key={tier} className={`relative p-4 rounded-2xl border-2 flex flex-col gap-3 bg-[var(--bg-card)] ${
                isCurrent ? 'border-[var(--text)] bg-[var(--bg-hover)]' :
                isMax ? 'border-amber-400' :
                'border-[var(--border)]'
              }`}>
                {isMax && !isCurrent && <Badge color="bg-amber-400 text-black">最受欢迎</Badge>}
                {isFlagship && !isCurrent && <Badge color="bg-[var(--text)] text-[var(--bg)]">工作室专属</Badge>}
                {isCurrent && <Badge color="bg-[var(--text)] text-[var(--bg)]">✓ 当前</Badge>}
                <div className="flex items-center gap-2">
                  <Icon size={18} className={isMax ? 'text-amber-500' : 'text-[var(--text-2)]'}/>
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
                    tier === 'free' ? 'bg-[var(--bg-hover)] text-[var(--text-2)] hover:bg-[var(--bg-hover)]' :
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
                  {TIER_ORDER.map(t => (
                    <th key={t} className="text-center px-3 py-2.5 font-medium text-[var(--text-2)]">{TIER_LABEL[t]}</th>
                  ))}
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
                        {TIER_ORDER.map(t => (
                          <td key={t} className="text-center px-3 py-2 text-[var(--text)]">{row.values[t as TierKey]}</td>
                        ))}
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

function UsageBar({ label, used, total, unit, resetAt, showAlert }: {
  label: string; used: number; total: number; unit: string
  resetAt?: number                      // 月度 reset 时间戳 (秒), 显示 reset 倒计时
  showAlert?: boolean                   // 80%/95% 阈值变色 + 文字提示
}) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0
  // 颜色阈值: 0-79% 默认 (text), 80-94% 黄, 95-100% 红
  const barColor = showAlert
    ? (pct >= 95 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-[var(--text)]')
    : 'bg-[var(--text)]'
  const alertText = showAlert && pct >= 95 ? '额度即将耗尽, 考虑升级或买积分包'
    : showAlert && pct >= 80 ? '额度快用完, 考虑升级或买积分包' : ''
  const alertColor = pct >= 95 ? 'text-red-500' : 'text-amber-500'
  return (
    <div>
      <div className="flex justify-between text-[11px] text-[var(--text-3)] mb-0.5">
        <span>{label}</span>
        <span>
          {used} / {total}{unit && ` ${unit}`}
          {resetAt && resetAt > Date.now() / 1000 && (
            <span className="ml-2">· {Math.max(0, Math.ceil((resetAt - Date.now()/1000) / 86400))} 天后 reset</span>
          )}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-[var(--bg-input)] overflow-hidden">
        <div className={`h-full ${barColor} transition-all`} style={{ width: `${pct}%` }}/>
      </div>
      {alertText && <div className={`text-[10px] ${alertColor} mt-1`}>⚠ {alertText}</div>}
    </div>
  )
}


// ========== Tab 3: 充值积分 ==========

function CreditsTab({ credits, plans, sub, onBuyPack }: {
  credits: CreditBalance | null; plans: PlansResponse | null; sub: UserSubscription | null
  onBuyPack: (code: string) => void
}) {
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

      {/* 积分包 4 档 — 必须 Pro 及以上会员才能买 */}
      {(() => {
        const isFreeUser = (sub?.tier || 'free') === 'free'
        return (
          <div>
            <div className="flex items-baseline justify-between mb-1">
              <div className="text-base font-semibold">购买积分包</div>
              {isFreeUser && (
                <div className="text-xs text-amber-500">⚠️ 需先开通 Pro 及以上会员</div>
              )}
            </div>
            <div className="text-xs text-[var(--text-3)] mb-4">
              {isFreeUser ? '免费用户只能用每月赠送积分; 加买积分包需先开会员' : '买完积分永不过期, 可叠加月送积分使用'}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {plans && Object.entries(plans.credit_packs).map(([code, pack]) => {
                const baseRate = pack.credits / pack.price_yuan
                const bonus = Math.max(0, Math.round((baseRate / 10 - 1) * 100))
                const isBest = code === 'pack_499'
                return (
                  <div key={code} className={`relative p-4 rounded-xl border-2 flex flex-col gap-2 ${isBest && !isFreeUser ? 'border-amber-400 bg-[var(--bg-card)]' : 'border-[var(--border)] bg-[var(--bg-card)]'} ${isFreeUser ? 'opacity-50' : ''}`}>
                    {isBest && !isFreeUser && <div className="absolute -top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-amber-400 text-black text-[9px] font-medium">最划算</div>}
                    <div className="text-xs text-[var(--text-3)]">{pack.name}</div>
                    <div className="text-2xl font-semibold">¥{pack.price_yuan}</div>
                    <div className="text-sm text-[var(--text-2)]">{pack.credits.toLocaleString()} 积分</div>
                    {bonus > 0 && <div className="text-[10px] text-amber-500 font-medium">送 {bonus}%</div>}
                    <button onClick={() => !isFreeUser && onBuyPack(code)} disabled={isFreeUser}
                      className={`mt-1 py-2 rounded-lg text-xs ${isFreeUser ? 'bg-[var(--bg-hover)] text-[var(--text-3)] cursor-not-allowed' : 'bg-[var(--text)] text-[var(--bg)] hover:opacity-80 cursor-pointer'}`}
                      title={isFreeUser ? '免费用户不能买积分包, 先开通 Pro' : ''}>
                      {isFreeUser ? '需先开会员' : '购买'}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* 积分用途 (笼统描述, 不暴露具体哪些免费哪些收费, 后端 credit_log 仍记账给 admin) */}
      <div className="p-5 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
        <div className="text-sm font-medium mb-2">积分说明</div>
        <div className="text-xs text-[var(--text-2)] leading-relaxed">
          月送积分每月 reset, 加买积分永不过期. 使用功能时优先扣月送积分, 用完再扣加买积分.
        </div>
      </div>
    </>
  )
}


// ========== Tab 4: 消费记录 ==========

function TransactionsTab({ creditLog, orders, friendlyName }: {
  creditLog: CreditLogEntry[]; orders: OrderEntry[]; friendlyName: (code?: string) => string
}) {
  const [subTab, setSubTab] = useState<'credit' | 'order'>('credit')
  const STATUS_LABEL: Record<string, string> = {
    pending: '待支付', paid: '已支付', expired: '已取消', refunded: '已退款',
  }
  const STATUS_COLOR: Record<string, string> = {
    pending: 'text-amber-500', paid: 'text-green-500', expired: 'text-[var(--text-3)]', refunded: 'text-red-400',
  }
  const CHANNEL_LABEL: Record<string, string> = {
    wechat: '微信支付', alipay: '支付宝', manual: '手工开通',
  }
  return (
    <>
      <div className="flex border-b border-[var(--border)]">
        {[
          { k: 'credit', l: '积分赠送' },
          { k: 'order', l: '订单记录' },
        ].map(t => (
          <button key={t.k} onClick={() => setSubTab(t.k as any)}
            className={`px-4 py-2.5 text-sm cursor-pointer transition-colors ${subTab === t.k ? 'text-[var(--text)] border-b-2 border-[var(--text)]' : 'text-[var(--text-3)]'}`}>
            {t.l}
          </button>
        ))}
      </div>

      {subTab === 'credit' && (() => {
        const grants = creditLog.filter(l => l.delta > 0)
        return (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden">
            {grants.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-[var(--text-3)]">还没有积分赠送</div>
            ) : (
              <div className="divide-y divide-[var(--border-subtle)]">
                {grants.map(log => (
                  <div key={log.id} className="px-5 py-3 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] text-[var(--text-3)] w-32">{fmtTime(log.created_at)}</span>
                      <span className="text-[var(--text-2)]">{friendlyName(log.feature || log.source)}</span>
                    </div>
                    <span className="text-green-500 font-medium">+{log.delta}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })()}

      {subTab === 'order' && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden">
          {orders.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-[var(--text-3)]">还没有订单</div>
          ) : (
            <div className="divide-y divide-[var(--border-subtle)]">
              {orders.map(o => (
                <div key={o.id} className="px-5 py-3.5 flex items-center justify-between gap-3 text-xs">
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-[var(--text)] font-medium">{friendlyName(o.product_code)}</span>
                      <span className={`text-[10px] ${STATUS_COLOR[o.status] || 'text-[var(--text-3)]'}`}>· {STATUS_LABEL[o.status] || o.status}</span>
                    </div>
                    <div className="text-[10px] text-[var(--text-3)] flex items-center gap-2">
                      <span>{fmtTime(o.created_at)}</span>
                      {o.payment_channel && <span>· {CHANNEL_LABEL[o.payment_channel] || o.payment_channel}</span>}
                      {o.credits_added ? <span>· +{o.credits_added} 积分</span> : null}
                    </div>
                  </div>
                  <span className="text-base font-semibold text-[var(--text)] flex-shrink-0">¥{o.amount_yuan}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
}


// ========== Tab 5: 我的推广 ==========

function ReferralTab({ refCode, refStatus, refBalance, onShowQr, onReload }: {
  refCode: ReferralCode | null; refStatus: ReferrerStatus | null; refBalance: ReferrerBalance | null
  onShowQr: () => void; onReload: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [records, setRecords] = useState<{ referred_users: ReferredUser[]; commissions: CommissionDetail[] } | null>(null)
  const [guideOpen, setGuideOpen] = useState(false)
  const [subTab, setSubTab] = useState<'users' | 'commissions'>('users')
  const [upgrading, setUpgrading] = useState(false)

  useEffect(() => {
    fetchMyReferralRecords(100).then(setRecords).catch(console.warn)
  }, [])

  // 升级阈值 + 当前进度计算 (跟 billing.py 的 COMMISSION_RULES 对齐)
  const eligibility = (() => {
    if (!refStatus) return null
    if (refStatus.level === 'normal') {
      const usersNeeded = 5, revenueNeeded = 500
      const usersGot = refStatus.total_paying_users
      const revenueGot = refStatus.total_revenue_brought || 0
      const eligible = usersGot >= usersNeeded || revenueGot >= revenueNeeded
      return { nextLevel: 'certified', nextLevelLabel: '认证推广员', eligible,
        progressUsers: { got: usersGot, need: usersNeeded },
        progressRevenue: { got: revenueGot, need: revenueNeeded } }
    }
    if (refStatus.level === 'certified') {
      const usersNeeded = 20, revenueNeeded = 3000
      const usersGot = refStatus.month_paying_users || 0
      const revenueGot = refStatus.month_revenue_brought || 0
      const eligible = usersGot >= usersNeeded || revenueGot >= revenueNeeded
      return { nextLevel: 'partner', nextLevelLabel: '核心合伙人', eligible,
        progressUsers: { got: usersGot, need: usersNeeded, label: '月推付费用户' },
        progressRevenue: { got: revenueGot, need: revenueNeeded, label: '月推流水' } }
    }
    return null  // partner 已经顶
  })()

  const handleUpgrade = async () => {
    if (upgrading || !eligibility?.eligible) return
    setUpgrading(true)
    try {
      const r = await checkReferrerUpgrade()
      if (r.upgraded) {
        alert(`已升级为${eligibility.nextLevelLabel}!`)
        onReload()
      } else {
        alert('未达升级条件')
      }
    } catch (e: any) {
      alert(e.message || '升级失败')
    } finally {
      setUpgrading(false)
    }
  }

  const copy = () => {
    if (!refCode) return
    navigator.clipboard.writeText(refCode.link).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    })
  }
  if (!refCode || !refStatus) return null

  return (
    <>
      {/* 广告位 banner — 拉拢推广动机 */}
      <button
        onClick={() => setGuideOpen(true)}
        className="text-left w-full p-5 rounded-2xl bg-gradient-to-r from-[var(--text)] to-[var(--text)]/80 text-[var(--bg)] hover:opacity-95 cursor-pointer transition-opacity"
      >
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp size={16}/>
              <span className="text-xs opacity-80">推广激励</span>
            </div>
            <div className="text-xl font-bold mb-1">邀请 1 人付费, 月入 ¥60</div>
            <div className="text-xs opacity-80">推广 Max 月卡, 30% 持续分成 · 月推 20 人月入 ¥6000</div>
          </div>
          <div className="hidden sm:flex items-center gap-1 text-sm opacity-80">
            <span>查看推广规则</span>
            <ArrowRight size={14}/>
          </div>
        </div>
      </button>

      {/* 推广码 + 链接 + 二维码 + 累计 */}
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
            普通用户推荐拿积分奖励. 累计带来 5 个付费用户或 ¥500 流水后升级认证推广员 (现金 30% 持续分成). 月推 20 人或 ¥3000 流水升核心合伙人 (50% 首单 + 15%×3 续费).
          </div>
        )}

        {/* 升级进度 + 升级按钮 (达条件就高亮蹦出来) */}
        {eligibility && (
          <div className={`mt-4 p-3.5 rounded-xl ${eligibility.eligible ? 'bg-amber-50 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-900/50' : 'bg-[var(--bg-hover)] border border-[var(--border)]'}`}>
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="text-xs font-medium text-[var(--text-2)]">
                {eligibility.eligible ? `已达升级条件 → ${eligibility.nextLevelLabel}` : `距离升级 ${eligibility.nextLevelLabel}`}
              </div>
              {eligibility.eligible && (
                <button onClick={handleUpgrade} disabled={upgrading}
                  className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-medium disabled:opacity-50 cursor-pointer transition-colors">
                  {upgrading ? '升级中...' : `立即升级`}
                </button>
              )}
            </div>
            <div className="space-y-1.5">
              <ProgressLine label={(eligibility.progressUsers as any).label || '累计付费用户'}
                got={eligibility.progressUsers.got} need={eligibility.progressUsers.need} unit="人"/>
            </div>
          </div>
        )}
      </div>

      {/* 推广明细 */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden">
        <div className="flex border-b border-[var(--border)]">
          <button onClick={() => setSubTab('users')}
            className={`px-4 py-2.5 text-sm cursor-pointer transition-colors ${subTab === 'users' ? 'text-[var(--text)] border-b-2 border-[var(--text)]' : 'text-[var(--text-3)]'}`}>
            推广用户 ({records?.referred_users.length || 0})
          </button>
          <button onClick={() => setSubTab('commissions')}
            className={`px-4 py-2.5 text-sm cursor-pointer transition-colors ${subTab === 'commissions' ? 'text-[var(--text)] border-b-2 border-[var(--text)]' : 'text-[var(--text-3)]'}`}>
            佣金记录 ({records?.commissions.length || 0})
          </button>
        </div>

        {subTab === 'users' && (
          records?.referred_users.length ? (
            <div className="divide-y divide-[var(--border-subtle)]">
              <div className="px-5 py-2 grid grid-cols-4 gap-2 text-[10px] text-[var(--text-3)] uppercase bg-[var(--bg-hover)]">
                <span>用户</span>
                <span>注册时间</span>
                <span className="text-center">订单数</span>
                <span className="text-right">累计付费</span>
              </div>
              {records.referred_users.map(u => (
                <div key={u.user_id} className="px-5 py-3 grid grid-cols-4 gap-2 text-xs items-center">
                  <div>
                    <div className="text-[var(--text)]">{u.username}</div>
                    <div className="text-[10px] text-[var(--text-3)] font-mono">{u.phone_masked}</div>
                  </div>
                  <span className="text-[var(--text-3)] text-[10px]">{fmtTime(u.bound_at)}</span>
                  <span className="text-center text-[var(--text-2)]">{u.order_count || '-'}</span>
                  <span className={`text-right ${u.total_paid_amount > 0 ? 'text-green-500 font-medium' : 'text-[var(--text-3)]'}`}>
                    {u.total_paid_amount > 0 ? `¥${u.total_paid_amount.toFixed(2)}` : '未付费'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-5 py-8 text-center text-sm text-[var(--text-3)]">还没人通过你的推广码注册. 分享链接给好友试试 ↑</div>
          )
        )}

        {subTab === 'commissions' && (
          records?.commissions.length ? (
            <div className="divide-y divide-[var(--border-subtle)]">
              <div className="px-5 py-2 grid grid-cols-12 gap-2 text-[10px] text-[var(--text-3)] uppercase bg-[var(--bg-hover)]">
                <span className="col-span-3">时间</span>
                <span className="col-span-2">类型</span>
                <span className="col-span-3">关联用户/订单</span>
                <span className="col-span-2 text-right">收益</span>
                <span className="col-span-2 text-center">状态</span>
              </div>
              {records.commissions.map(c => {
                const typeLabel = c.commission_type === 'register_bonus' ? '注册奖励' :
                  c.commission_type === 'first_order' ? '首单' : `续费 ${c.renewal_month_index || 1}/3`
                return (
                  <div key={c.id} className="px-5 py-3 grid grid-cols-12 gap-2 text-xs items-center">
                    <span className="col-span-3 text-[10px] text-[var(--text-3)]">{fmtTime(c.created_at)}</span>
                    <span className="col-span-2 text-[var(--text-2)]">{typeLabel}</span>
                    <div className="col-span-3 min-w-0">
                      <div className="text-[var(--text)] truncate">{c.buyer_username || '-'}</div>
                      {c.product_code && <div className="text-[10px] text-[var(--text-3)] truncate">{c.product_code}</div>}
                    </div>
                    <span className="col-span-2 text-right text-green-500 font-medium">
                      {c.cash_yuan > 0 ? `¥${c.cash_yuan.toFixed(2)}` : `+${c.credits} 积分`}
                    </span>
                    <span className="col-span-2 text-center text-[10px] text-[var(--text-3)]">
                      {c.status === 'settled' ? '已结算' : c.status === 'pending' ? '待结算' : '已撤销'}
                    </span>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="px-5 py-8 text-center text-sm text-[var(--text-3)]">还没有佣金记录</div>
          )
        )}
      </div>

      {/* 推广规则表 */}
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

      {/* 推广技巧 modal */}
      {guideOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setGuideOpen(false)}>
          <div onClick={e => e.stopPropagation()} className="relative bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-ios-lg w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 flex flex-col gap-4">
            <button onClick={() => setGuideOpen(false)} className="absolute top-4 right-4 p-1 rounded text-[var(--text-3)] hover:bg-[var(--bg-hover)] cursor-pointer"><X size={14}/></button>
            <div className="text-lg font-semibold">推广员规则说明</div>

            <section className="text-sm text-[var(--text-2)] leading-relaxed space-y-4">
              <div>
                <div className="font-medium text-[var(--text)] mb-1.5">注册奖励</div>
                <ul className="text-xs space-y-1 list-disc ml-5">
                  <li>对方通过你的链接注册成功 → 双方各得 <b>30 积分</b> (不需付费)</li>
                  <li>同一手机号 / 同一设备多账号刷量不计入</li>
                  <li>奖励即时到账, 不分等级</li>
                </ul>
              </div>

              <div>
                <div className="font-medium text-[var(--text)] mb-1.5">等级权益</div>
                <div className="overflow-x-auto -mx-1">
                  <table className="w-full text-[11px] border-collapse">
                    <thead>
                      <tr className="border-b border-[var(--border)] text-[var(--text-3)]">
                        <th className="py-1.5 px-2 text-left font-normal">等级</th>
                        <th className="py-1.5 px-2 text-left font-normal">注册奖励</th>
                        <th className="py-1.5 px-2 text-left font-normal">付费分成</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-[var(--border-subtle)]">
                        <td className="py-1.5 px-2 text-[var(--text)]">普通用户</td>
                        <td className="py-1.5 px-2">30 积分</td>
                        <td className="py-1.5 px-2 text-[var(--text-3)]">无</td>
                      </tr>
                      <tr className="border-b border-[var(--border-subtle)]">
                        <td className="py-1.5 px-2 text-[var(--text)]">认证推广员</td>
                        <td className="py-1.5 px-2">30 积分</td>
                        <td className="py-1.5 px-2"><b>30% 持续分成</b></td>
                      </tr>
                      <tr>
                        <td className="py-1.5 px-2 text-[var(--text)]">核心合伙人</td>
                        <td className="py-1.5 px-2">30 积分</td>
                        <td className="py-1.5 px-2"><b>50% 首单 + 15%×3 续费</b></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <div className="font-medium text-[var(--text)] mb-1.5">升级路径</div>
                <ul className="text-xs space-y-1 list-disc ml-5">
                  <li>普通用户 → 累计带来 <b>5 付费用户</b> 或 <b>¥500 流水</b> → 自动升 <b>认证推广员</b></li>
                  <li>认证推广员 → 月推 <b>20 人</b> 或 <b>¥3000 流水</b> → 自动升 <b>核心合伙人</b></li>
                  <li>等级一旦达成不会回退, 持续享有对应分成比例</li>
                </ul>
              </div>

              <div>
                <div className="font-medium text-[var(--text)] mb-1.5">分成结算</div>
                <ul className="text-xs space-y-1 list-disc ml-5">
                  <li>对方付费后 <b>T+7 天</b> 结算到现金余额 (过 7 天退款窗口)</li>
                  <li>分成按对方实付金额计算, 不含优惠券抵扣部分</li>
                  <li>认证推广员 / 核心合伙人都是 <b>终身分成</b>, 对方一直续费你一直拿</li>
                </ul>
              </div>

              <div>
                <div className="font-medium text-[var(--text)] mb-1.5">提现说明</div>
                <ul className="text-xs space-y-1 list-disc ml-5">
                  <li>认证推广员 / 核心合伙人, 现金余额 <b>≥ ¥100</b> 可申请提现</li>
                  <li>提现方式: 微信 / 支付宝, 1-3 个工作日到账</li>
                  <li>异常订单 (3 月内退费率 &gt; 30%) 不计入佣金</li>
                </ul>
              </div>

              <div>
                <div className="font-medium text-[var(--text)] mb-1.5">联系与申诉</div>
                <p className="text-xs">分成 / 提现 / 等级有异议, 加客服微信沟通, 工作日 24h 内回复.</p>
              </div>
            </section>

            <button onClick={() => setGuideOpen(false)} className="self-end px-4 py-2 rounded-lg bg-[var(--text)] text-[var(--bg)] text-sm hover:opacity-80 cursor-pointer">知道了</button>
          </div>
        </div>
      )}
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

function ProgressLine({ label, got, need, unit, prefix = '' }: { label: string; got: number; need: number; unit: string; prefix?: string }) {
  const pct = Math.min(100, (got / need) * 100)
  const done = got >= need
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex justify-between text-[11px]">
        <span className="text-[var(--text-2)]">{label}</span>
        <span className={done ? 'text-amber-500 font-medium' : 'text-[var(--text-3)]'}>
          {prefix}{typeof got === 'number' && got % 1 !== 0 ? got.toFixed(2) : got} / {prefix}{need}{unit}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-[var(--bg-hover)] overflow-hidden">
        <div className={`h-full transition-all ${done ? 'bg-amber-500' : 'bg-[var(--text-3)]'}`} style={{ width: `${pct}%` }}/>
      </div>
    </div>
  )
}


// ========== Tab 6: 安全设置 ==========

function MyCutoutsTab() {
  const [selectedOssKey, setSelectedOssKey] = useState('')
  const [selectedUrl, setSelectedUrl] = useState('')
  const [err, setErr] = useState('')

  return (
    <div className="flex flex-col gap-4">
      <div className="p-5 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
        <div className="text-base font-semibold mb-1">我的人物</div>
        <div className="text-xs text-[var(--text-3)]">
          抠过的人物图都在这里. 最多保存 <span className="text-[var(--text-2)] font-medium">10 张</span>,
          满了上传新的会**自动删除最久没用的**那张. 想保留可以点选中后下载 PNG 到本地.
        </div>
      </div>

      <div className="p-5 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
        <PersonLibrary
          selectedOssKey={selectedOssKey}
          onSelect={(ossKey, previewUrl) => {
            setSelectedOssKey(ossKey)
            setSelectedUrl(previewUrl)
            setErr('')
          }}
          stroke={{ enabled: false, color: '#FFFFFF', width: 0 }}
          onUploadingChange={() => {}}
          onError={setErr}
        />
        {err && (
          <div className="mt-2 text-xs text-red-400 bg-red-950/20 border border-red-900/30 rounded-lg px-3 py-2">{err}</div>
        )}
        {selectedUrl && (
          <div className="mt-4 flex flex-col gap-3">
            <div className="rounded-lg bg-[repeating-conic-gradient(#ddd_0deg_25%,#fff_0deg_50%)] [background-size:20px_20px] p-4 flex items-center justify-center">
              <img src={selectedUrl} alt="人物" className="max-w-full max-h-[40vh] object-contain"/>
            </div>
            <button onClick={() => {
              const a = document.createElement('a')
              a.href = selectedUrl
              a.download = `monoi-cutout-${Date.now()}.png`
              document.body.appendChild(a)
              a.click()
              document.body.removeChild(a)
            }}
              className="py-2.5 rounded-lg bg-[var(--text)] text-[var(--bg)] text-sm hover:opacity-80 cursor-pointer flex items-center justify-center gap-2">
              <Download size={14}/> 下载透明 PNG
            </button>
          </div>
        )}
      </div>

      <div className="text-[11px] text-[var(--text-3)] px-1 leading-relaxed">
        想抠新的图? 回到聊天界面, 点底部工具栏的 <Sticker size={11} className="inline -mt-0.5"/> "抠图" 按钮.
      </div>
    </div>
  )
}


function SecurityTab({ me, onReload }: { me: UserProfile | null; onReload: () => void }) {
  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState('')
  const [rebindOpen, setRebindOpen] = useState(false)

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
        <div className="flex items-center justify-between mb-3">
          <div className="text-base font-semibold">手机号换绑</div>
          <button onClick={() => setRebindOpen(true)} className="text-xs text-[var(--text-2)] hover:text-[var(--text)] underline cursor-pointer">
            换绑手机号
          </button>
        </div>
        <div className="text-sm text-[var(--text-2)] mb-1">当前手机号: <span className="font-mono">{me?.phone_masked || '-'}</span></div>
        <div className="text-[11px] text-[var(--text-3)]">需要双因素验证 (新旧手机都要收验证码), 防止账号被盗</div>
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

      {/* 手机号换绑 弹窗 */}
      {rebindOpen && <RebindPhoneModal currentPhone={me?.phone || ''} onClose={() => setRebindOpen(false)} onDone={onReload}/>}
    </>
  )
}


// ========== 手机号换绑 modal ==========

function RebindPhoneModal({ currentPhone, onClose, onDone }: {
  currentPhone: string; onClose: () => void; onDone: () => void
}) {
  const [newPhone, setNewPhone] = useState('')
  const [newCode, setNewCode] = useState('')
  const [oldCode, setOldCode] = useState('')
  const [newCdwn, setNewCdwn] = useState(0)
  const [oldCdwn, setOldCdwn] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (newCdwn <= 0) return
    const t = setTimeout(() => setNewCdwn(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [newCdwn])
  useEffect(() => {
    if (oldCdwn <= 0) return
    const t = setTimeout(() => setOldCdwn(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [oldCdwn])

  const validPhone = (p: string) => /^1\d{10}$/.test(p)

  const sendNew = async () => {
    setMsg('')
    if (!validPhone(newPhone)) { setMsg('新手机号格式不对'); return }
    try {
      const r = await sendSmsCode(newPhone, 'rebind_phone')
      setNewCdwn(60)
      setMsg(r.dev_code ? `新手机验证码已发 (mock: ${r.dev_code})` : '新手机验证码已发送')
    } catch (e: any) { setMsg(e.message) }
  }

  const sendOld = async () => {
    setMsg('')
    if (!currentPhone) { setMsg('当前账号未绑定手机号, 不需要验证旧手机'); return }
    try {
      const r = await sendSmsCode(currentPhone, 'rebind_phone')
      setOldCdwn(60)
      setMsg(r.dev_code ? `旧手机验证码已发 (mock: ${r.dev_code})` : '旧手机验证码已发送')
    } catch (e: any) { setMsg(e.message) }
  }

  const submit = async () => {
    setMsg('')
    if (!validPhone(newPhone)) { setMsg('新手机号格式不对'); return }
    if (newCode.length !== 6) { setMsg('新手机验证码 6 位'); return }
    if (currentPhone && oldCode.length !== 6) { setMsg('旧手机验证码 6 位'); return }
    setSubmitting(true)
    try {
      await rebindPhone(newPhone, newCode, oldCode || newCode)
      setMsg('换绑成功')
      onDone()
      setTimeout(onClose, 800)
    } catch (e: any) {
      setMsg(e.message || '换绑失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="relative bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-ios-lg w-full max-w-md p-6 flex flex-col gap-3">
        <button onClick={onClose} className="absolute top-4 right-4 p-1 rounded text-[var(--text-3)] hover:bg-[var(--bg-hover)] cursor-pointer"><X size={14}/></button>
        <div className="text-base font-semibold">换绑手机号</div>
        <div className="text-xs text-[var(--text-3)]">需双因素验证: 新手机 + 旧手机各收一条验证码</div>

        {/* 新手机号 */}
        <div className="flex flex-col gap-1.5 mt-2">
          <label className="text-xs text-[var(--text-2)]">新手机号</label>
          <div className="flex gap-2">
            <input
              type="tel" value={newPhone}
              onChange={e => setNewPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
              placeholder="11 位手机号" maxLength={11}
              className="flex-1 bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--text-3)]"
            />
            <button onClick={sendNew} disabled={newCdwn > 0 || !validPhone(newPhone)}
              className="px-3 rounded-lg text-xs border border-[var(--border)] hover:bg-[var(--bg-hover)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap">
              {newCdwn > 0 ? `${newCdwn}s 后重发` : '发送验证码'}
            </button>
          </div>
          <input
            type="text" value={newCode}
            onChange={e => setNewCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="新手机验证码 (6 位)" maxLength={6}
            className="bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--text-3)]"
          />
        </div>

        {/* 旧手机号 (如果有) */}
        {currentPhone ? (
          <div className="flex flex-col gap-1.5 mt-2">
            <label className="text-xs text-[var(--text-2)]">旧手机号 {currentPhone.slice(0,3)}****{currentPhone.slice(-4)}</label>
            <div className="flex gap-2">
              <input
                type="text" value={oldCode}
                onChange={e => setOldCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="旧手机验证码 (6 位)" maxLength={6}
                className="flex-1 bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--text-3)]"
              />
              <button onClick={sendOld} disabled={oldCdwn > 0}
                className="px-3 rounded-lg text-xs border border-[var(--border)] hover:bg-[var(--bg-hover)] disabled:opacity-40 cursor-pointer whitespace-nowrap">
                {oldCdwn > 0 ? `${oldCdwn}s 后重发` : '发送验证码'}
              </button>
            </div>
          </div>
        ) : (
          <div className="text-[11px] text-[var(--text-3)] mt-2">你当前账号还未绑定手机号, 跳过旧手机验证</div>
        )}

        {msg && <div className={`text-xs mt-2 ${msg.includes('成功') || msg.includes('已发') ? 'text-green-500' : 'text-red-400'}`}>{msg}</div>}

        <div className="flex justify-end gap-2 mt-3">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-[var(--text-2)] hover:bg-[var(--bg-hover)] cursor-pointer">取消</button>
          <button onClick={submit} disabled={submitting}
            className="px-4 py-2 rounded-lg bg-[var(--text)] text-[var(--bg)] text-sm hover:opacity-80 disabled:opacity-40 cursor-pointer">
            {submitting ? '换绑中' : '确认换绑'}
          </button>
        </div>
      </div>
    </div>
  )
}
