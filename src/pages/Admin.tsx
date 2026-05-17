import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Users, ShoppingBag, DollarSign, BarChart3, Search, X, AlertTriangle,
  Music, Trash2, Plus, Loader2, Play, Pause, Type,
} from 'lucide-react'
import {
  adminListUsers, adminUserDetail, adminGrantSubscription, adminGrantCredits,
  adminSetReferrerLevel, adminSetAdminFlag, adminListOrders, adminListWithdrawals,
  adminProcessWithdrawal, adminStats,
  adminListBgm, adminAddBgm, adminDeleteBgm,
  adminListFonts, adminUploadFont, adminDeleteFont,
  type AdminUserRow, type AdminOrderRow, type AdminWithdrawalRow, type AdminStats,
  type AdminBgmRow, type AdminFontRow,
} from '../services/admin'
import { fetchMyProfile } from '../services/billing'
import { isLoggedIn } from '../lib/auth'


type TabKey = 'dashboard' | 'users' | 'orders' | 'withdrawals' | 'bgm' | 'fonts'

const TABS: { key: TabKey; label: string; Icon: any }[] = [
  { key: 'dashboard', label: '数据看板', Icon: BarChart3 },
  { key: 'users', label: '用户管理', Icon: Users },
  { key: 'orders', label: '订单管理', Icon: ShoppingBag },
  { key: 'withdrawals', label: '提现申请', Icon: DollarSign },
  { key: 'bgm', label: 'BGM 库', Icon: Music },
  { key: 'fonts', label: '字体库', Icon: Type },
]

const BGM_CATEGORIES = [
  { value: 'upbeat', label: '欢快活力' },
  { value: 'calm', label: '舒缓平静' },
  { value: 'inspirational', label: '励志正能量' },
  { value: 'cinematic', label: '电影感' },
  { value: 'electronic', label: '电子' },
  { value: 'chinese', label: '国风' },
  { value: 'other', label: '其他' },
]
const BGM_CAT_LABEL = Object.fromEntries(BGM_CATEGORIES.map(c => [c.value, c.label]))

const TIER_LABEL: Record<string, string> = {
  free: '免费', pro_monthly: 'Pro', max_monthly: 'Max', flagship_yearly: '旗舰',
}

// 商品名映射 (订单管理 / 流水显示用): plans + credit_packs 全集, 没匹配上 fallback raw code
const PRODUCT_LABEL: Record<string, string> = {
  free: '免费版', pro_monthly: 'Pro 月卡', max_monthly: 'Max 月卡', flagship_yearly: '旗舰年卡',
  pack_99: '体验包 (100 积分)', pack_49: '小包 (600 积分)',
  pack_199: '中包 (3000 积分)', pack_499: '大包 (8000 积分)',
}
const productName = (code?: string) => code ? (PRODUCT_LABEL[code] || code) : '-'

const fmtTime = (ts?: number | string) => {
  if (!ts) return '-'
  const n = typeof ts === 'string' ? new Date(ts).getTime() / 1000 : ts
  return new Date(n * 1000).toLocaleString('zh-CN')
}
const fmtDate = (ts?: number) => ts ? new Date(ts * 1000).toLocaleDateString('zh-CN') : '-'

export default function Admin() {
  const nav = useNavigate()
  const [authChecking, setAuthChecking] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    const h = window.location.hash.replace('#', '')
    return (TABS.find(t => t.key === h)?.key as TabKey) || 'dashboard'
  })

  useEffect(() => {
    if (!isLoggedIn()) { nav('/login'); return }
    fetchMyProfile().then(p => {
      setIsAdmin(!!p.is_admin)
      setAuthChecking(false)
    }).catch(() => {
      setAuthChecking(false)
    })
  }, [nav])

  useEffect(() => { window.location.hash = activeTab }, [activeTab])

  if (authChecking) return <div className="min-h-screen flex items-center justify-center text-[var(--text-2)]">检查权限...</div>
  if (!isAdmin) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-[var(--text-2)] px-4 text-center">
      <AlertTriangle size={32} className="text-amber-500"/>
      <div className="text-base font-medium">权限不足</div>
      <div className="text-sm text-[var(--text-3)]">这个页面只允许管理员访问</div>
      <button onClick={() => nav('/app')} className="mt-2 px-4 py-2 rounded-lg bg-[var(--text)] text-[var(--bg)] text-sm cursor-pointer">返回</button>
    </div>
  )

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <div className="border-b border-[var(--border)] bg-[var(--bg-card)] sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <button onClick={() => nav('/app')} className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] cursor-pointer"><ArrowLeft size={18}/></button>
          <div className="text-base font-semibold">monoi 管理后台</div>
          <span className="text-[10px] px-2 py-0.5 rounded bg-red-500 text-white">admin</span>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex flex-col lg:flex-row gap-6">
        <nav className="lg:w-52 flex-shrink-0">
          <div className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible pb-1">
            {TABS.map(t => (
              <button key={t.key} onClick={() => setActiveTab(t.key)}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm whitespace-nowrap cursor-pointer ${
                  activeTab === t.key ? 'bg-[var(--text)] text-[var(--bg)]' : 'text-[var(--text-2)] hover:bg-[var(--bg-hover)]'
                }`}>
                <t.Icon size={15}/><span>{t.label}</span>
              </button>
            ))}
          </div>
        </nav>

        <div className="flex-1 min-w-0 flex flex-col gap-4">
          {activeTab === 'dashboard' && <DashboardTab/>}
          {activeTab === 'users' && <UsersTab/>}
          {activeTab === 'orders' && <OrdersTab/>}
          {activeTab === 'withdrawals' && <WithdrawalsTab/>}
          {activeTab === 'bgm' && <BgmLibraryTab/>}
          {activeTab === 'fonts' && <FontLibraryTab/>}
        </div>
      </div>
    </div>
  )
}


// ========== 数据看板 ==========

function DashboardTab() {
  const [data, setData] = useState<AdminStats | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    adminStats().then(setData).catch(e => setErr(e.message))
  }, [])

  if (err) return <div className="text-sm text-red-400">{err}</div>
  if (!data) return <div className="text-sm text-[var(--text-3)]">加载中...</div>

  const daily7d = data.revenue?.daily_7d ?? []
  const max7d = Math.max(...daily7d.map(d => d.amount), 1)

  const REF_LEVEL_LABEL: Record<string, string> = { normal: '普通用户', certified: '认证推广员', partner: '核心合伙人' }
  return (
    <>
      {/* 用户 (3) + 营收 (3) 6 卡片 */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <StatCard label="累计注册用户" value={data.users.total} sub={`今日新增 +${data.users.new_today}`}/>
        <StatCard label="付费用户" value={data.users.paying} sub={`转化率 ${data.users.paying_conversion}% · 占注册`}/>
        <StatCard label="今日营收" value={`¥${data.revenue.today.toFixed(0)}`} sub="今日 00:00 起"/>
        <StatCard label="本月营收" value={`¥${data.revenue.month.toFixed(0)}`} sub={`${new Date().getMonth() + 1} 月 1 日起`}/>
        <StatCard label="本周营收" value={`¥${data.revenue.week.toFixed(0)}`} sub="近 7 天滚动"/>
        <StatCard label="累计营收" value={`¥${data.revenue.total.toFixed(0)}`} sub="历史全部 paid"/>
      </div>

      {/* 7 日营收趋势 */}
      <div className="p-5 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
        <div className="text-sm font-medium mb-3">近 7 日每日营收</div>
        <div className="flex items-end gap-2 h-32">
          {daily7d.map((d, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <div className="text-[10px] text-[var(--text-3)]">¥{d.amount.toFixed(0)}</div>
              <div className="w-full bg-[var(--text)] rounded-t" style={{ height: `${(d.amount / max7d) * 100}%`, minHeight: '2px' }}/>
              <div className="text-[10px] text-[var(--text-3)]">{d.days_ago === 0 ? '今天' : `${d.days_ago}天前`}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 套餐分布: 详细表 (人数 + 占付费 % + 占注册 %) */}
      <div className="p-5 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
        <div className="text-sm font-medium mb-3">套餐分布 (付费用户)</div>
        {data.users.paying === 0 ? (
          <div className="text-xs text-[var(--text-3)]">还没有付费用户</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-[var(--text-3)]">
              <tr>
                <th className="text-left pb-2">套餐</th>
                <th className="text-right pb-2">人数</th>
                <th className="text-right pb-2">占付费</th>
                <th className="text-right pb-2">占注册</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {['pro_monthly', 'max_monthly', 'flagship_yearly'].map(tier => {
                const t = data.tiers?.[tier] || { count: 0, pct_of_paying: 0, pct_of_total: 0 }
                return (
                  <tr key={tier}>
                    <td className="py-2 text-[var(--text-2)]">{TIER_LABEL[tier]}</td>
                    <td className="py-2 text-right font-medium">{t.count}</td>
                    <td className="py-2 text-right text-[var(--text-3)]">{t.pct_of_paying}%</td>
                    <td className="py-2 text-right text-[var(--text-3)]">{t.pct_of_total}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* 推广员细分: 3 等级 (人数 / 今日新拉 / 累计拉 / 应得分成 / 累计提现) */}
      <div className="p-5 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
        <div className="text-sm font-medium mb-3">推广员分布</div>
        <table className="w-full text-xs">
          <thead className="text-[var(--text-3)]">
            <tr>
              <th className="text-left pb-2">等级</th>
              <th className="text-right pb-2">人数</th>
              <th className="text-right pb-2">今日新拉</th>
              <th className="text-right pb-2">累计拉</th>
              <th className="text-right pb-2">应得现金</th>
              <th className="text-right pb-2">应得积分</th>
              <th className="text-right pb-2">累计提现</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-subtle)]">
            {['normal', 'certified', 'partner'].map(level => {
              const r = data.referrer_levels?.[level] || {
                count: 0, total_brought: 0, new_today: 0,
                pending_cash: 0, pending_credits: 0, total_withdrawn: 0,
              }
              return (
                <tr key={level}>
                  <td className="py-2 text-[var(--text-2)]">{REF_LEVEL_LABEL[level]}</td>
                  <td className="py-2 text-right font-medium">{r.count}</td>
                  <td className="py-2 text-right text-green-500">+{r.new_today}</td>
                  <td className="py-2 text-right">{r.total_brought}</td>
                  <td className="py-2 text-right text-amber-500">¥{(r.pending_cash || 0).toFixed(2)}</td>
                  <td className="py-2 text-right text-amber-500">{r.pending_credits}</td>
                  <td className="py-2 text-right text-[var(--text-3)]">¥{(r.total_withdrawn || 0).toFixed(2)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* 待处理提现 */}
      {data.pending_withdrawals > 0 && (
        <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/30">
          <div className="text-sm font-medium text-amber-900 dark:text-amber-300">
            ⚠ {data.pending_withdrawals} 个提现申请待处理, 总额 ¥{data.pending_withdraw_amount.toFixed(2)}
          </div>
        </div>
      )}
    </>
  )
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="p-4 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
      <div className="text-xs text-[var(--text-3)] mb-1">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
      {sub && <div className="text-[10px] text-[var(--text-3)] mt-1">{sub}</div>}
    </div>
  )
}


// ========== 用户管理 ==========

function UsersTab() {
  const [users, setUsers] = useState<AdminUserRow[]>([])
  const [total, setTotal] = useState(0)
  const [q, setQ] = useState('')
  const [tier, setTier] = useState('')
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<AdminUserRow | null>(null)
  const PAGE_SIZE = 30

  const load = () => {
    setLoading(true)
    adminListUsers(q, tier, PAGE_SIZE, page * PAGE_SIZE).then(d => {
      setUsers(d.users); setTotal(d.total); setLoading(false)
    }).catch(() => setLoading(false))
  }
  useEffect(load, [q, tier, page])

  return (
    <>
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1 relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]"/>
          <input value={q} onChange={e => { setQ(e.target.value); setPage(0) }}
            placeholder="搜用户名 / 邮箱 / 手机号"
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border)] text-sm focus:outline-none focus:border-[var(--text-3)]"/>
        </div>
        <select value={tier} onChange={e => { setTier(e.target.value); setPage(0) }}
          className="px-3 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border)] text-sm">
          <option value="">所有套餐</option>
          <option value="free">免费</option>
          <option value="pro_monthly">Pro</option>
          <option value="max_monthly">Max</option>
          <option value="flagship_yearly">旗舰</option>
        </select>
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[var(--bg-hover)] text-[var(--text-2)]">
              <tr>
                <th className="text-left px-4 py-2">ID</th>
                <th className="text-left px-4 py-2">用户</th>
                <th className="text-left px-4 py-2">联系方式</th>
                <th className="text-left px-4 py-2">套餐</th>
                <th className="text-right px-4 py-2">积分</th>
                <th className="text-left px-4 py-2">推广</th>
                <th className="text-left px-4 py-2">注册时间</th>
                <th className="text-right px-4 py-2">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {loading ? (
                <tr><td colSpan={8} className="text-center py-8 text-[var(--text-3)]">加载中...</td></tr>
              ) : users.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-8 text-[var(--text-3)]">没匹配的用户</td></tr>
              ) : users.map(u => (
                <tr key={u.id} className="hover:bg-[var(--bg-hover)]">
                  <td className="px-4 py-2 font-mono">{u.id}</td>
                  <td className="px-4 py-2">
                    <span>{u.username}</span>
                    {u.is_admin > 0 && <span className="ml-1 text-[9px] px-1 py-0.5 rounded bg-red-500 text-white">admin</span>}
                  </td>
                  <td className="px-4 py-2">
                    <div className="text-[10px] text-[var(--text-3)]">{u.email}</div>
                    <div className="text-[10px] font-mono">{u.phone_masked}</div>
                  </td>
                  <td className="px-4 py-2">
                    <span className={u.tier === 'free' ? 'text-[var(--text-3)]' : 'text-green-500'}>{TIER_LABEL[u.tier]}</span>
                    {u.sub_end && u.tier !== 'free' && <div className="text-[10px] text-[var(--text-3)]">到 {fmtDate(u.sub_end)}</div>}
                  </td>
                  <td className="px-4 py-2 text-right">{u.credits_total}</td>
                  <td className="px-4 py-2">
                    <div className="text-[10px]">{u.referrer_level === 'normal' ? '普通' : u.referrer_level === 'certified' ? '认证' : '合伙人'}</div>
                    <div className="text-[10px] text-[var(--text-3)]">{u.total_paying_users_brought} 人 / ¥{u.total_revenue_brought.toFixed(0)}</div>
                  </td>
                  <td className="px-4 py-2 text-[10px] text-[var(--text-3)]">{fmtTime(u.created_at)}</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => setSelected(u)} className="text-xs text-[var(--text-2)] underline hover:text-[var(--text)] cursor-pointer">详情</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-[var(--text-3)]">
        <span>共 {total} 用户 · 第 {page + 1} 页</span>
        <div className="flex gap-1">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            className="px-3 py-1 rounded border border-[var(--border)] disabled:opacity-40 cursor-pointer">上一页</button>
          <button onClick={() => setPage(p => p + 1)} disabled={(page + 1) * PAGE_SIZE >= total}
            className="px-3 py-1 rounded border border-[var(--border)] disabled:opacity-40 cursor-pointer">下一页</button>
        </div>
      </div>

      {selected && <UserDetailModal user={selected} onClose={() => setSelected(null)} onReload={load}/>}
    </>
  )
}


function UserDetailModal({ user, onClose, onReload }: {
  user: AdminUserRow; onClose: () => void; onReload: () => void
}) {
  const [detail, setDetail] = useState<any>(null)
  const [actionTab, setActionTab] = useState<'info' | 'subscribe' | 'credits' | 'level'>('info')
  const [actMsg, setActMsg] = useState('')

  useEffect(() => {
    adminUserDetail(user.id).then(setDetail).catch(e => setActMsg(e.message))
  }, [user.id])

  const reload = () => {
    adminUserDetail(user.id).then(setDetail)
    onReload()
  }

  const grantSub = async (tier: string) => {
    setActMsg('')
    try { await adminGrantSubscription(user.id, tier, 'manual_admin'); setActMsg('已开通'); reload() }
    catch (e: any) { setActMsg(e.message) }
  }
  const grantCredits = async (amount: number, note: string) => {
    setActMsg('')
    try { await adminGrantCredits(user.id, amount, note); setActMsg(`已${amount > 0 ? '加' : '扣'} ${Math.abs(amount)} 积分`); reload() }
    catch (e: any) { setActMsg(e.message) }
  }
  const setLevel = async (level: 'normal' | 'certified' | 'partner') => {
    setActMsg('')
    try { await adminSetReferrerLevel(user.id, level); setActMsg('已设置'); reload() }
    catch (e: any) { setActMsg(e.message) }
  }
  const toggleAdmin = async () => {
    setActMsg('')
    try { await adminSetAdminFlag(user.id, user.is_admin ? 0 : 1); setActMsg('已切换'); reload() }
    catch (e: any) { setActMsg(e.message) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="relative bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-ios-lg w-full max-w-3xl max-h-[90vh] overflow-y-auto p-5">
        <button onClick={onClose} className="absolute top-4 right-4 p-1 rounded text-[var(--text-3)] hover:bg-[var(--bg-hover)] cursor-pointer"><X size={14}/></button>
        <div className="text-lg font-semibold mb-1">{user.username} <span className="text-xs text-[var(--text-3)] font-normal">#{user.id}</span></div>
        <div className="text-xs text-[var(--text-3)] mb-4">{user.email} · {user.phone_masked} · 注册 {fmtTime(user.created_at)}</div>

        {/* 子 tab */}
        <div className="flex gap-1 border-b border-[var(--border)] mb-3">
          {[
            { k: 'info', l: '账户信息' }, { k: 'subscribe', l: '改套餐' },
            { k: 'credits', l: '加减积分' }, { k: 'level', l: '推广员等级' },
          ].map(t => (
            <button key={t.k} onClick={() => setActionTab(t.k as any)}
              className={`px-3 py-2 text-sm cursor-pointer ${actionTab === t.k ? 'text-[var(--text)] border-b-2 border-[var(--text)]' : 'text-[var(--text-3)]'}`}>
              {t.l}
            </button>
          ))}
        </div>

        {actMsg && <div className="text-xs mb-2 px-3 py-1.5 rounded bg-[var(--bg-hover)]">{actMsg}</div>}

        {actionTab === 'info' && detail && (
          <div className="space-y-3 text-xs">
            <div>
              <div className="text-[10px] text-[var(--text-3)] uppercase mb-1">订阅</div>
              <div className="bg-[var(--bg-input)] p-2 rounded font-mono">
                {detail.subscription ? `${detail.subscription.tier} · 到 ${fmtDate(detail.subscription.current_period_end)}` : '免费用户'}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-[var(--text-3)] uppercase mb-1">积分余额</div>
              <div className="bg-[var(--bg-input)] p-2 rounded">
                月送 {detail.credit_balance?.monthly_credits || 0} + 加买 {detail.credit_balance?.purchased_credits || 0} = {(detail.credit_balance?.monthly_credits || 0) + (detail.credit_balance?.purchased_credits || 0)}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-[var(--text-3)] uppercase mb-1">推广: 等级 {detail.referrer_status?.level} · 推码 {detail.referrer_status?.referral_code}</div>
              <div className="bg-[var(--bg-input)] p-2 rounded">
                带 {detail.referrer_status?.total_paying_users || 0} 人付费 · 流水 ¥{(detail.referrer_status?.total_revenue_brought || 0).toFixed(2)} · 现金余额 ¥{(detail.referrer_balance?.cash_balance || 0).toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-[var(--text-3)] uppercase mb-1">最近 5 笔订单</div>
              <div className="bg-[var(--bg-input)] p-2 rounded">
                {detail.orders.slice(0, 5).map((o: any) => (
                  <div key={o.id} className="flex justify-between py-0.5 font-mono text-[10px]">
                    <span>{productName(o.product_code)} ¥{o.amount_yuan} {o.status}</span>
                    <span className="text-[var(--text-3)]">{fmtTime(o.created_at)}</span>
                  </div>
                ))}
                {detail.orders.length === 0 && <div className="text-[var(--text-3)]">无</div>}
              </div>
            </div>
            <div>
              <button onClick={toggleAdmin} className="px-3 py-1.5 text-xs rounded border border-[var(--border)] hover:bg-[var(--bg-hover)] cursor-pointer">
                {user.is_admin ? '取消 admin 权限' : '设为 admin'}
              </button>
            </div>
          </div>
        )}

        {actionTab === 'subscribe' && (
          <div className="space-y-2">
            <div className="text-xs text-[var(--text-3)] mb-2">手工开通套餐 (跳过支付, 立即生效, 写订单 status='paid' 备注 admin_grant)</div>
            <div className="flex flex-wrap gap-2">
              {['pro_monthly', 'max_monthly', 'flagship_yearly'].map(t => (
                <button key={t} onClick={() => grantSub(t)} className="px-3 py-2 rounded-lg bg-[var(--text)] text-[var(--bg)] text-xs cursor-pointer hover:opacity-80">
                  开通 {TIER_LABEL[t]}
                </button>
              ))}
            </div>
          </div>
        )}

        {actionTab === 'credits' && (
          <CreditsActionForm onSubmit={grantCredits}/>
        )}

        {actionTab === 'level' && (
          <div className="space-y-2">
            <div className="text-xs text-[var(--text-3)] mb-2">手工设置推广员等级</div>
            <div className="flex gap-2">
              <button onClick={() => setLevel('normal')} className="px-3 py-2 rounded-lg bg-[var(--bg-hover)] text-xs cursor-pointer">普通用户</button>
              <button onClick={() => setLevel('certified')} className="px-3 py-2 rounded-lg bg-[var(--text)] text-[var(--bg)] text-xs cursor-pointer">认证推广员</button>
              <button onClick={() => setLevel('partner')} className="px-3 py-2 rounded-lg bg-[var(--text)] text-[var(--bg)] text-xs cursor-pointer">核心合伙人</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function CreditsActionForm({ onSubmit }: { onSubmit: (amount: number, note: string) => void }) {
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  return (
    <div className="space-y-2">
      <div className="text-xs text-[var(--text-3)]">正数加积分, 负数扣积分</div>
      <div className="flex gap-2">
        <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
          placeholder="例: 1000 或 -100"
          className="flex-1 bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--text-3)]"/>
        <input type="text" value={note} onChange={e => setNote(e.target.value)}
          placeholder="备注 (可选)"
          className="flex-1 bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--text-3)]"/>
        <button onClick={() => { const n = parseInt(amount); if (n) onSubmit(n, note); setAmount('') }}
          className="px-4 py-2 rounded-lg bg-[var(--text)] text-[var(--bg)] text-xs cursor-pointer hover:opacity-80 whitespace-nowrap">
          提交
        </button>
      </div>
    </div>
  )
}


// ========== 订单管理 ==========

function OrdersTab() {
  const [orders, setOrders] = useState<AdminOrderRow[]>([])
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 30

  useEffect(() => {
    adminListOrders(status, PAGE_SIZE, page * PAGE_SIZE).then(d => { setOrders(d.orders); setTotal(d.total) })
  }, [status, page])

  return (
    <>
      <div className="flex gap-2">
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(0) }}
          className="px-3 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border)] text-sm">
          <option value="">所有状态</option>
          <option value="paid">已支付</option>
          <option value="pending">待支付</option>
          <option value="refunded">已退款</option>
        </select>
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[var(--bg-hover)] text-[var(--text-2)]">
              <tr>
                <th className="text-left px-4 py-2">订单号</th>
                <th className="text-left px-4 py-2">用户</th>
                <th className="text-left px-4 py-2">商品</th>
                <th className="text-right px-4 py-2">金额</th>
                <th className="text-left px-4 py-2">支付</th>
                <th className="text-left px-4 py-2">时间</th>
                <th className="text-left px-4 py-2">状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {orders.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-[var(--text-3)]">没有订单</td></tr>
              ) : orders.map(o => (
                <tr key={o.id} className="hover:bg-[var(--bg-hover)]">
                  <td className="px-4 py-2 font-mono text-[10px]">{o.id.slice(0, 20)}...</td>
                  <td className="px-4 py-2">{o.username || `#${o.user_id}`}</td>
                  <td className="px-4 py-2">{productName(o.product_code)}</td>
                  <td className="px-4 py-2 text-right text-green-500 font-medium">¥{o.amount_yuan.toFixed(2)}</td>
                  <td className="px-4 py-2 text-[10px] text-[var(--text-3)]">{o.payment_method?.startsWith('admin_grant') ? '管理员开' : o.payment_method}</td>
                  <td className="px-4 py-2 text-[10px] text-[var(--text-3)]">{fmtTime(o.paid_at || o.created_at)}</td>
                  <td className="px-4 py-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      o.status === 'paid' ? 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400' :
                      o.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {o.status === 'paid' ? '已支付' : o.status === 'pending' ? '待支付' : o.status === 'refunded' ? '已退款' : o.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-[var(--text-3)]">
        <span>共 {total} 订单</span>
        <div className="flex gap-1">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-3 py-1 rounded border border-[var(--border)] disabled:opacity-40 cursor-pointer">上一页</button>
          <button onClick={() => setPage(p => p + 1)} disabled={(page + 1) * PAGE_SIZE >= total} className="px-3 py-1 rounded border border-[var(--border)] disabled:opacity-40 cursor-pointer">下一页</button>
        </div>
      </div>
    </>
  )
}


// ========== 提现 ==========

function WithdrawalsTab() {
  const [items, setItems] = useState<AdminWithdrawalRow[]>([])
  const [status, setStatus] = useState('pending')

  const load = () => { adminListWithdrawals(status).then(setItems) }
  useEffect(() => { load() }, [status])

  const process = async (id: number, action: 'approve' | 'reject' | 'mark_paid') => {
    if (!confirm(`确认${action}?`)) return
    try { await adminProcessWithdrawal(id, action); load() }
    catch (e: any) { alert(e.message) }
  }

  return (
    <>
      <div className="flex gap-2">
        {[
          { k: 'pending', l: '待审核' },
          { k: 'approved', l: '已批准' },
          { k: 'paid', l: '已打款' },
          { k: 'rejected', l: '已拒绝' },
        ].map(s => (
          <button key={s.k} onClick={() => setStatus(s.k)}
            className={`px-3 py-1.5 rounded-lg text-xs cursor-pointer ${status === s.k ? 'bg-[var(--text)] text-[var(--bg)]' : 'bg-[var(--bg-hover)] text-[var(--text-2)]'}`}>
            {s.l}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[var(--bg-hover)] text-[var(--text-2)]">
              <tr>
                <th className="text-left px-4 py-2">用户</th>
                <th className="text-right px-4 py-2">金额</th>
                <th className="text-left px-4 py-2">收款方式</th>
                <th className="text-left px-4 py-2">账户信息</th>
                <th className="text-left px-4 py-2">申请时间</th>
                <th className="text-right px-4 py-2">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {items.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-[var(--text-3)]">没有 {status} 状态的申请</td></tr>
              ) : items.map(w => (
                <tr key={w.id} className="hover:bg-[var(--bg-hover)]">
                  <td className="px-4 py-2">{w.username} <span className="text-[10px] text-[var(--text-3)]">#{w.user_id}</span></td>
                  <td className="px-4 py-2 text-right text-green-500 font-medium">¥{w.amount_yuan.toFixed(2)}</td>
                  <td className="px-4 py-2">{w.payment_method}</td>
                  <td className="px-4 py-2 text-[10px] font-mono">{w.account_info}</td>
                  <td className="px-4 py-2 text-[10px] text-[var(--text-3)]">{fmtTime(w.created_at)}</td>
                  <td className="px-4 py-2 text-right">
                    {status === 'pending' && (
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => process(w.id, 'approve')} className="px-2 py-1 rounded bg-green-500 text-white text-[10px] cursor-pointer">批准</button>
                        <button onClick={() => process(w.id, 'reject')} className="px-2 py-1 rounded bg-red-500 text-white text-[10px] cursor-pointer">拒绝</button>
                      </div>
                    )}
                    {status === 'approved' && (
                      <button onClick={() => process(w.id, 'mark_paid')} className="px-2 py-1 rounded bg-[var(--text)] text-[var(--bg)] text-[10px] cursor-pointer">标记已打款</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}


// ========== BGM 库管理 ==========

const directBase = (import.meta as any).env?.VITE_DIRECT_API_URL || 'https://monoi.nat100.top'

function BgmLibraryTab() {
  const [list, setList] = useState<AdminBgmRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  // 上传表单状态
  const [showForm, setShowForm] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [category, setCategory] = useState('upbeat')
  const [licenseNote, setLicenseNote] = useState('CC0 / 已购买商用授权')
  const [duration, setDuration] = useState(0)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [formErr, setFormErr] = useState('')

  const [playingId, setPlayingId] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const reload = () => {
    setLoading(true); setErr('')
    adminListBgm().then(r => setList(r.bgms || [])).catch(e => setErr(e.message)).finally(() => setLoading(false))
  }
  useEffect(() => { reload() }, [])

  const handleFile = (f: File) => {
    setFile(f); setFormErr('')
    if (!name) setName(f.name.replace(/\.\w+$/, ''))
    // 探测时长
    const a = new Audio(URL.createObjectURL(f))
    a.addEventListener('loadedmetadata', () => {
      setDuration(a.duration || 0)
      URL.revokeObjectURL(a.src)
    })
  }

  const handleSubmit = async () => {
    if (!file) { setFormErr('请先选音频文件'); return }
    if (!name.trim()) { setFormErr('请填写曲名'); return }
    setUploading(true); setFormErr(''); setUploadProgress(0)
    try {
      // 1. 拿签名
      const token = localStorage.getItem('monoi_token') || ''
      const signRes = await fetch(directBase + '/api/oss/sign-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ filename: file.name, content_type: file.type || 'audio/mpeg' }),
      })
      if (!signRes.ok) throw new Error('OSS 签名失败')
      const { put_url, oss_key, content_type } = await signRes.json()

      // 2. PUT 到 OSS
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('PUT', put_url)
        xhr.setRequestHeader('Content-Type', content_type)
        xhr.upload.onprogress = e => {
          if (e.lengthComputable) setUploadProgress(Math.round(e.loaded / e.total * 100))
        }
        xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`OSS PUT ${xhr.status}`))
        xhr.onerror = () => reject(new Error('OSS PUT 网络错误'))
        xhr.send(file)
      })

      // 3. 入库
      await adminAddBgm({
        name: name.trim(),
        category,
        oss_key,
        duration_seconds: duration,
        license_note: licenseNote,
      })

      // 4. 重置 + reload
      setFile(null); setName(''); setDuration(0); setUploadProgress(0); setShowForm(false)
      reload()
    } catch (e: any) {
      setFormErr(e.message || '上传失败')
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`确定删除 "${name}"? 用户已经选过这首的合成不受影响 (OSS 文件仍在), 但新合成不能再选.`)) return
    try {
      await adminDeleteBgm(id)
      reload()
    } catch (e: any) {
      alert('删除失败: ' + e.message)
    }
  }

  const togglePreview = (row: AdminBgmRow) => {
    // 后台没存 preview_url, 但有 oss_key — 用户侧 listBgmLibrary 才会签 URL. 这里偷懒: 让管理员去 OSS 控制台看.
    // 简化方案: 直接调 voice-server 公共 BGM 列表, 找匹配的 preview_url
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
    if (playingId === row.id) { setPlayingId(null); return }
    // 拉一次公共列表找 preview_url
    fetch(directBase + '/api/voice/bgm-library')
      .then(r => r.json())
      .then(d => {
        const t = (d.bgms || []).find((x: any) => x.id === row.id)
        if (!t?.preview_url) { alert('无法预览, 检查 OSS 配置'); return }
        const a = new Audio(t.preview_url)
        a.onended = () => setPlayingId(null)
        a.play().catch(() => {})
        audioRef.current = a
        setPlayingId(row.id)
      })
  }

  // 按类目分组
  const grouped = list.reduce<Record<string, AdminBgmRow[]>>((acc, t) => {
    const k = t.category || 'other'
    ;(acc[k] = acc[k] || []).push(t)
    return acc
  }, {})

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-base font-semibold">BGM 库管理</div>
          <div className="text-xs text-[var(--text-3)] mt-0.5">
            合成视频时, 用户可从这里选商用授权 BGM (无版权风险). 共 {list.length} 首.
          </div>
        </div>
        <button
          onClick={() => setShowForm(s => !s)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--text)] text-[var(--bg)] text-sm cursor-pointer"
        >
          <Plus size={14}/> 添加 BGM
        </button>
      </div>

      {showForm && (
        <div className="bg-[var(--bg-card)] rounded-xl p-4 border border-[var(--border)] flex flex-col gap-3">
          <div className="text-sm font-medium">上传新 BGM</div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-[var(--text-3)]">音频文件 (mp3 推荐, 最大 50MB)</label>
            <input
              type="file" accept="audio/*"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
              className="text-xs text-[var(--text-2)]"
            />
            {file && (
              <div className="text-[11px] text-[var(--text-3)] mt-0.5">
                {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB
                {duration > 0 && ` · ${duration.toFixed(1)}s`}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-[var(--text-3)]">曲名</label>
              <input
                value={name} onChange={e => setName(e.target.value)}
                placeholder="例: 阳光午后 / Summer Vibes"
                className="bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1.5 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-[var(--text-3)]">类目</label>
              <select
                value={category} onChange={e => setCategory(e.target.value)}
                className="bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1.5 text-sm"
              >
                {BGM_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-[var(--text-3)]">授权说明 (展示给用户参考, 留空也行)</label>
            <input
              value={licenseNote} onChange={e => setLicenseNote(e.target.value)}
              placeholder="例: CC0 / 已购买 Artlist 授权 / 站内原创"
              className="bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1.5 text-sm"
            />
          </div>

          {formErr && <p className="text-xs text-red-400">{formErr}</p>}
          {uploading && uploadProgress > 0 && (
            <div className="h-1.5 bg-[var(--bg)] rounded overflow-hidden">
              <div className="h-full bg-[var(--text)] transition-all" style={{ width: `${uploadProgress}%` }}/>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleSubmit}
              disabled={uploading || !file}
              className="px-4 py-2 rounded-lg bg-[var(--text)] text-[var(--bg)] text-sm cursor-pointer disabled:opacity-50"
            >
              {uploading ? <span className="flex items-center gap-1.5"><Loader2 size={12} className="animate-spin"/> 上传中 {uploadProgress}%</span> : '提交'}
            </button>
            <button
              onClick={() => { setShowForm(false); setFile(null); setName(''); setFormErr('') }}
              disabled={uploading}
              className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm cursor-pointer disabled:opacity-50"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {err && <div className="text-xs text-red-400 bg-red-950/20 border border-red-900/30 rounded-lg px-3 py-2">{err}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-[var(--text-3)]">
          <Loader2 size={16} className="animate-spin mr-2"/> 加载中...
        </div>
      ) : list.length === 0 ? (
        <div className="bg-[var(--bg-card)] rounded-xl p-8 border border-[var(--border)] text-center text-sm text-[var(--text-3)]">
          还没添加任何 BGM. 点上方 "添加 BGM" 开始建库.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {Object.entries(grouped).map(([cat, tracks]) => (
            <div key={cat} className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] overflow-hidden">
              <div className="px-4 py-2 border-b border-[var(--border)] text-xs text-[var(--text-2)] font-medium">
                {BGM_CAT_LABEL[cat] || cat} · {tracks.length} 首
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[var(--text-3)] border-b border-[var(--border)]">
                    <th className="px-4 py-2 text-left">试听</th>
                    <th className="px-4 py-2 text-left">曲名</th>
                    <th className="px-4 py-2 text-left">时长</th>
                    <th className="px-4 py-2 text-left">授权说明</th>
                    <th className="px-4 py-2 text-left">添加时间</th>
                    <th className="px-4 py-2 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {tracks.map(t => (
                    <tr key={t.id} className="border-b border-[var(--border)] hover:bg-[var(--bg-hover)]">
                      <td className="px-4 py-2">
                        <button
                          onClick={() => togglePreview(t)}
                          className="w-6 h-6 rounded-full bg-[var(--bg-hover)] hover:bg-[var(--text)] hover:text-[var(--bg)] flex items-center justify-center cursor-pointer"
                        >
                          {playingId === t.id ? <Pause size={10}/> : <Play size={10}/>}
                        </button>
                      </td>
                      <td className="px-4 py-2 text-[var(--text)]">{t.name}</td>
                      <td className="px-4 py-2 text-[var(--text-3)]">{t.duration_seconds > 0 ? `${t.duration_seconds.toFixed(0)}s` : '-'}</td>
                      <td className="px-4 py-2 text-[var(--text-3)] truncate max-w-[200px]">{t.license_note || '-'}</td>
                      <td className="px-4 py-2 text-[var(--text-3)]">{fmtTime(t.created_at)}</td>
                      <td className="px-4 py-2 text-right">
                        <button
                          onClick={() => handleDelete(t.id, t.name)}
                          className="p-1 rounded text-red-400 hover:bg-red-950/30 cursor-pointer"
                          title="删除"
                        >
                          <Trash2 size={14}/>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </>
  )
}


// ========== 字体库管理 ==========

function FontLibraryTab() {
  const [list, setList] = useState<AdminFontRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  // 上传表单
  const [showForm, setShowForm] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [label, setLabel] = useState('')
  const [tag, setTag] = useState('')
  const [licenseNote, setLicenseNote] = useState('')
  const [uploading, setUploading] = useState(false)
  const [formErr, setFormErr] = useState('')

  const reload = () => {
    setLoading(true); setErr('')
    adminListFonts().then(r => setList(r.fonts || [])).catch(e => setErr(e.message)).finally(() => setLoading(false))
  }
  useEffect(() => { reload() }, [])

  const handleFile = (f: File) => {
    setFile(f); setFormErr('')
    if (!label) setLabel(f.name.replace(/\.\w+$/, ''))
  }

  const handleSubmit = async () => {
    if (!file) { setFormErr('请先选字体文件'); return }
    if (!label.trim()) { setFormErr('请填字体名'); return }
    if (!/\.(ttf|otf|ttc)$/i.test(file.name)) { setFormErr('只支持 .ttf / .otf / .ttc'); return }
    setUploading(true); setFormErr('')
    try {
      await adminUploadFont({
        file,
        label: label.trim(),
        tag: tag.trim(),
        license_note: licenseNote.trim(),
      })
      // 重置 + reload
      setFile(null); setLabel(''); setTag(''); setLicenseNote(''); setShowForm(false)
      reload()
    } catch (e: any) {
      setFormErr(e.message || '上传失败')
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (id: number, label: string) => {
    if (!confirm(`删除字体 "${label}"? 已用该字体的封面渲染不受影响 (磁盘文件也会一起删).`)) return
    try {
      await adminDeleteFont(id)
      reload()
    } catch (e: any) {
      alert('删除失败: ' + e.message)
    }
  }

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-base font-semibold">字体库管理</div>
          <div className="text-xs text-[var(--text-3)] mt-0.5">
            合成封面时, 用户可选这些字体. 内置已有 10 个 (思源黑体/优设标题/站酷系列等), 这里加自定义字体.
            <span className="text-amber-500"> 注意: 只能传免费可商用字体, 法律责任自担.</span>
          </div>
        </div>
        <button
          onClick={() => setShowForm(s => !s)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--text)] text-[var(--bg)] text-sm cursor-pointer"
        >
          <Plus size={14}/> 上传字体
        </button>
      </div>

      {showForm && (
        <div className="bg-[var(--bg-card)] rounded-xl p-4 border border-[var(--border)] flex flex-col gap-3">
          <div className="text-sm font-medium">上传新字体</div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-[var(--text-3)]">字体文件 (.ttf / .otf / .ttc, 最大 30MB)</label>
            <input
              type="file" accept=".ttf,.otf,.ttc"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
              className="text-xs text-[var(--text-2)]"
            />
            {file && (
              <div className="text-[11px] text-[var(--text-3)] mt-0.5">
                {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-[var(--text-3)]">字体名 (用户能看到)</label>
              <input
                value={label} onChange={e => setLabel(e.target.value)}
                placeholder="例: 庞门正道粗书"
                className="bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1.5 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-[var(--text-3)]">风格标签 (可空)</label>
              <input
                value={tag} onChange={e => setTag(e.target.value)}
                placeholder="例: 粗黑·标题首选"
                className="bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1.5 text-sm"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-[var(--text-3)]">授权说明 (建议填, 保护自己)</label>
            <input
              value={licenseNote} onChange={e => setLicenseNote(e.target.value)}
              placeholder="例: 庞门正道官方公告免费商用 / SIL OFL 协议 / 已购买字魂年费"
              className="bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1.5 text-sm"
            />
          </div>

          {formErr && <p className="text-xs text-red-400">{formErr}</p>}

          <div className="flex gap-2">
            <button
              onClick={handleSubmit}
              disabled={uploading || !file}
              className="px-4 py-2 rounded-lg bg-[var(--text)] text-[var(--bg)] text-sm cursor-pointer disabled:opacity-50"
            >
              {uploading ? <span className="flex items-center gap-1.5"><Loader2 size={12} className="animate-spin"/> 上传中</span> : '提交'}
            </button>
            <button
              onClick={() => { setShowForm(false); setFile(null); setLabel(''); setFormErr('') }}
              disabled={uploading}
              className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm cursor-pointer disabled:opacity-50"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {err && <div className="text-xs text-red-400 bg-red-950/20 border border-red-900/30 rounded-lg px-3 py-2">{err}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-[var(--text-3)]">
          <Loader2 size={16} className="animate-spin mr-2"/> 加载中...
        </div>
      ) : list.length === 0 ? (
        <div className="bg-[var(--bg-card)] rounded-xl p-8 border border-[var(--border)] text-center text-sm text-[var(--text-3)]">
          还没上传过字体. 内置的 10 个字体一直可用, 这里加自定义的会跟内置合并到选区.
        </div>
      ) : (
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[var(--text-3)] border-b border-[var(--border)]">
                <th className="px-4 py-2 text-left">字体名</th>
                <th className="px-4 py-2 text-left">风格</th>
                <th className="px-4 py-2 text-left">文件名</th>
                <th className="px-4 py-2 text-left">授权说明</th>
                <th className="px-4 py-2 text-left">状态</th>
                <th className="px-4 py-2 text-left">添加时间</th>
                <th className="px-4 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {list.map(f => (
                <tr key={f.id} className="border-b border-[var(--border)] hover:bg-[var(--bg-hover)]">
                  <td className="px-4 py-2 text-[var(--text)]">{f.label}</td>
                  <td className="px-4 py-2 text-[var(--text-3)]">{f.tag || '-'}</td>
                  <td className="px-4 py-2 text-[var(--text-3)] font-mono text-[10px]">{f.file}</td>
                  <td className="px-4 py-2 text-[var(--text-3)] truncate max-w-[200px]">{f.license_note || '-'}</td>
                  <td className="px-4 py-2">
                    {f.file_exists ? (
                      <span className="text-green-500 text-[10px]">✓ 文件正常</span>
                    ) : (
                      <span className="text-red-400 text-[10px]">✗ 磁盘文件不在</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-[var(--text-3)]">{fmtTime(f.created_at)}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => handleDelete(f.id, f.label)}
                      className="p-1 rounded text-red-400 hover:bg-red-950/30 cursor-pointer"
                      title="删除 (会同时删磁盘文件)"
                    >
                      <Trash2 size={14}/>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
