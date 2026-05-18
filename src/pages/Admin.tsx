import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Users, ShoppingBag, DollarSign, BarChart3, Search, X, AlertTriangle,
  Music, Trash2, Plus, Loader2, Play, Pause, Type, Image as ImageIcon, MousePointer2,
} from 'lucide-react'
import {
  adminListUsers, adminUserDetail, adminGrantSubscription, adminGrantCredits,
  adminSetReferrerLevel, adminSetAdminFlag, adminListOrders, adminListWithdrawals,
  adminProcessWithdrawal, adminStats,
  adminListBgm, adminAddBgm, adminDeleteBgm,
  adminListFonts, adminUploadFont, adminDeleteFont,
  adminListCoverTemplates, adminAddCoverTemplate, adminDeleteCoverTemplate,
  type AdminUserRow, type AdminOrderRow, type AdminWithdrawalRow, type AdminStats,
  type AdminBgmRow, type AdminFontRow, type AdminCoverTemplate, type CoverTextField, type CoverPersonSlot,
} from '../services/admin'
import { fetchMyProfile } from '../services/billing'
import { isLoggedIn } from '../lib/auth'
import { loadFont, fontFamily, parseSegments } from '../utils/coverFonts'


type TabKey = 'dashboard' | 'users' | 'orders' | 'withdrawals' | 'bgm' | 'fonts' | 'covers'

const TABS: { key: TabKey; label: string; Icon: any }[] = [
  { key: 'dashboard', label: '数据看板', Icon: BarChart3 },
  { key: 'users', label: '用户管理', Icon: Users },
  { key: 'orders', label: '订单管理', Icon: ShoppingBag },
  { key: 'withdrawals', label: '提现申请', Icon: DollarSign },
  { key: 'bgm', label: 'BGM 库', Icon: Music },
  { key: 'fonts', label: '字体库', Icon: Type },
  { key: 'covers', label: '封面模板', Icon: ImageIcon },
]

const COVER_CATEGORIES = [
  { value: 'kepu', label: '科普' },
  { value: 'zhenjing', label: '震惊' },
  { value: 'gushi', label: '故事' },
  { value: 'jiaocheng', label: '教程' },
  { value: 'jianji', label: '极简' },
  { value: 'zhichang', label: '职场' },
  { value: 'xuexi', label: '学习' },
  { value: 'licai', label: '理财' },
  { value: 'other', label: '其他' },
]
const COVER_CAT_LABEL = Object.fromEntries(COVER_CATEGORIES.map(c => [c.value, c.label]))
const COVER_RATIOS: { value: '9:16' | '3:4' | '16:9' | '1:1'; label: string; w: number; h: number }[] = [
  { value: '3:4',  label: '3:4 (小红书)',   w: 1080, h: 1440 },
  { value: '9:16', label: '9:16 (抖音/视频号)', w: 1080, h: 1920 },
  { value: '16:9', label: '16:9 (B站/YouTube)', w: 1920, h: 1080 },
  { value: '1:1',  label: '1:1 (方图)',      w: 1080, h: 1080 },
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
          {activeTab === 'covers' && <CoverTemplateTab/>}
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


// ========== 封面模板管理 ==========

interface FontOption { file: string; label: string; tag?: string; source?: string }

/** 单字段配置 (admin 在拖框编辑器里编辑的对象). 比 server CoverTextField 多个 id, 给 React key 用 */
interface UiTextField extends CoverTextField { _id: string }

function CoverTemplateTab() {
  const [list, setList] = useState<AdminCoverTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [showEditor, setShowEditor] = useState(false)
  // admin list 端点不签 URL, 复用公共端点 /api/voice/cover-templates 拿带签 bg_url
  const [bgUrlMap, setBgUrlMap] = useState<Record<number, string>>({})

  const reload = () => {
    setLoading(true); setErr('')
    adminListCoverTemplates().then(r => setList(r.templates || [])).catch(e => setErr(e.message)).finally(() => setLoading(false))
    // 同时拉公共端点拿签名 URL (复用阶段 2 已有的端点, 不动后端)
    fetch(directBase + '/api/voice/cover-templates')
      .then(r => r.json())
      .then(d => {
        const m: Record<number, string> = {}
        for (const t of (d.templates || [])) {
          if (t.bg_url) m[t.id] = t.bg_url
        }
        setBgUrlMap(m)
      })
      .catch(() => {})
  }
  useEffect(() => { reload() }, [])

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`删除模板 "${name}"? 已生成的封面不受影响, 但新合成不能再选这个模板.`)) return
    try {
      await adminDeleteCoverTemplate(id)
      reload()
    } catch (e: any) {
      alert('删除失败: ' + e.message)
    }
  }

  // 按类目分组
  const grouped = list.reduce<Record<string, AdminCoverTemplate[]>>((acc, t) => {
    const k = t.category || 'other'
    ;(acc[k] = acc[k] || []).push(t)
    return acc
  }, {})

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-base font-semibold">封面模板管理</div>
          <div className="text-xs text-[var(--text-3)] mt-0.5">
            上传底图 PNG, 拖框定义标题/副标题位置, 选字体/字号/颜色. 用户合成视频时可选模板填字一键出封面.
            <span className="text-amber-500"> 标题用 大括号 包要高亮的字, 例 "封面{'{邪修}'}", 邪修 会用高亮色.</span>
          </div>
        </div>
        <button
          onClick={() => setShowEditor(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--text)] text-[var(--bg)] text-sm cursor-pointer"
        >
          <Plus size={14}/> 新建模板
        </button>
      </div>

      {err && <div className="text-xs text-red-400 bg-red-950/20 border border-red-900/30 rounded-lg px-3 py-2">{err}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-[var(--text-3)]">
          <Loader2 size={16} className="animate-spin mr-2"/> 加载中...
        </div>
      ) : list.length === 0 ? (
        <div className="bg-[var(--bg-card)] rounded-xl p-8 border border-[var(--border)] text-center text-sm text-[var(--text-3)]">
          还没添加模板. 点 "新建模板" 上传第一个.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {Object.entries(grouped).map(([cat, ts]) => (
            <div key={cat} className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] overflow-hidden">
              <div className="px-4 py-2 border-b border-[var(--border)] text-xs text-[var(--text-2)] font-medium">
                {COVER_CAT_LABEL[cat] || cat} · {ts.length} 个
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 p-3">
                {ts.map(t => {
                  const bgUrl = bgUrlMap[t.id]
                  // 按 ratio 推算容器宽高比 + 字段 % 的基准 (字段坐标是按底图实际像素存的,
                  // 但底图本身就是这个比例, 所以 x/y 占比 = x/(W) 这种相对值跟具体像素无关).
                  // 这里假设 admin 上传底图比例跟 ratio 一致, 用 ratio 比例算就行.
                  const aspectClass = t.ratio === '3:4' ? 'aspect-[3/4]'
                    : t.ratio === '9:16' ? 'aspect-[9/16]'
                    : t.ratio === '16:9' ? 'aspect-[16/9]'
                    : 'aspect-square'
                  // 字段 % 计算: 用比例反推, e.g. 3:4 模板里 x=60, w=1080 → 60/1080 不对,
                  // 实际 admin 编辑器存的是真实像素值. 用 ratio 比例算 % 时, 需要拿到真实底图 W.
                  // 这里偷懒: 用 img 加载后的 naturalWidth 兜底; 没加载完就先 hidden 字段 overlay.
                  return (
                    <div key={t.id} className="relative group rounded-lg border border-[var(--border)] overflow-hidden">
                      <div className={`${aspectClass} bg-[var(--bg)] flex items-center justify-center text-xs text-[var(--text-3)] relative`}>
                        {bgUrl ? (
                          <img src={bgUrl} alt={t.name}
                            data-template-id={t.id}
                            className="w-full h-full object-cover"/>
                        ) : (
                          <span>{t.ratio} · {t.text_fields.length} 个字段</span>
                        )}
                        {/* 字段框 overlay — % 按底图 natural size 算 (跟 TemplatePreview 一致) */}
                        {bgUrl && <TemplateOverlayBoxes template={t} bgUrl={bgUrl}/>}
                      </div>
                      <div className="px-2 py-1.5 bg-[var(--bg-card)] text-xs text-[var(--text)] truncate flex items-center gap-1">
                        <span className="flex-1 truncate">{t.name}</span>
                        <span className="text-[10px] text-[var(--text-3)]">{t.ratio}·{t.text_fields.length}字</span>
                      </div>
                      <button
                        onClick={() => handleDelete(t.id, t.name)}
                        className="absolute top-1 right-1 p-1 rounded bg-red-500/80 text-white opacity-0 group-hover:opacity-100 cursor-pointer"
                      >
                        <Trash2 size={12}/>
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {showEditor && (
        <CoverTemplateEditor
          onClose={() => setShowEditor(false)}
          onSaved={() => { setShowEditor(false); reload() }}
        />
      )}
    </>
  )
}

/** 上传 + 拖框编辑器 — 弹窗形式 */
function CoverTemplateEditor({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState('zhichang')
  const [ratio, setRatio] = useState<'9:16' | '3:4' | '16:9' | '1:1'>('3:4')

  const [, setBgFile] = useState<File | null>(null)    // 保留 setter (handleBgFile 设, 但当前没读), 拿掉 getter 避 TS6133
  const [bgOssKey, setBgOssKey] = useState('')
  const [bgPreviewUrl, setBgPreviewUrl] = useState('')              // 本地 ObjectURL, 用于拖框预览
  const [bgUploading, setBgUploading] = useState(false)
  const [bgUploadProgress, setBgUploadProgress] = useState(0)
  const [bgNaturalSize, setBgNaturalSize] = useState({ w: 0, h: 0 })

  const [fields, setFields] = useState<UiTextField[]>([])
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null)
  // 人物坑 (最多 1 个), null = 这个模板没人物
  const [personSlot, setPersonSlot] = useState<CoverPersonSlot | null>(null)
  // 'text' 拖框 → 加文字字段; 'person' 拖框 → 设/换人物坑; 'person_edit' → 选中人物坑编辑属性
  const [drawMode, setDrawMode] = useState<'text' | 'person'>('text')
  const [personSelected, setPersonSelected] = useState(false)   // 右侧编辑面板显示人物坑属性
  const [fonts, setFonts] = useState<FontOption[]>([])
  const [saving, setSaving] = useState(false)
  const [editorErr, setEditorErr] = useState('')

  // 拖框状态
  const canvasRef = useRef<HTMLDivElement>(null)
  const [drawing, setDrawing] = useState<{ startX: number; startY: number; curX: number; curY: number } | null>(null)
  // Canva 风格交互: move / resize / rotate. mousedown 记下, 全局 mousemove 算位移
  const interactionRef = useRef<{
    type: 'move' | 'resize' | 'rotate'
    fieldId: string
    startMouseX: number; startMouseY: number
    corner?: 'nw' | 'ne' | 'sw' | 'se'
    centerX?: number; centerY?: number
    startRotation?: number
  } | null>(null)

  // 拉字体列表 (跟用户端 cover-fonts 一样)
  useEffect(() => {
    fetch(directBase + '/api/voice/cover-fonts')
      .then(r => r.json())
      .then(d => setFonts(d.fonts || []))
      .catch(() => setFonts([]))
  }, [])

  // 字段加/改字体时预加载, 让画布里的预览能用真字体
  useEffect(() => {
    for (const f of fields) {
      if (f.font_file) loadFont(f.font_file)
    }
  }, [fields])

  // Canva 风手柄全局交互 (move/resize/rotate) — 用 ref 跟踪当前操作
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const it = interactionRef.current
      if (!it || !canvasRef.current || bgNaturalSize.w === 0) return
      const imgEl = canvasRef.current.querySelector('img')
      const rect = imgEl?.getBoundingClientRect()
      if (!rect) return
      // 屏幕 px 位移 → 底图 px 位移 (canvas 显示尺寸 vs 底图 natural 尺寸)
      const scale = bgNaturalSize.w / rect.width

      if (it.type === 'move') {
        const dx = Math.round((e.clientX - it.startMouseX) * scale)
        const dy = Math.round((e.clientY - it.startMouseY) * scale)
        if (dx === 0 && dy === 0) return
        setFields(prev => prev.map(f => f._id === it.fieldId ? { ...f, x: f.x + dx, y: f.y + dy } : f))
        interactionRef.current = { ...it, startMouseX: e.clientX, startMouseY: e.clientY }
      } else if (it.type === 'resize' && it.corner) {
        const dx = Math.round((e.clientX - it.startMouseX) * scale)
        const dy = Math.round((e.clientY - it.startMouseY) * scale)
        if (dx === 0 && dy === 0) return
        setFields(prev => prev.map(f => {
          if (f._id !== it.fieldId) return f
          let { x, y, w, h } = f
          if (it.corner === 'nw') { x += dx; y += dy; w -= dx; h -= dy }
          else if (it.corner === 'ne') { y += dy; w += dx; h -= dy }
          else if (it.corner === 'sw') { x += dx; w -= dx; h += dy }
          else { w += dx; h += dy }
          w = Math.max(20, w); h = Math.max(20, h)
          return { ...f, x, y, w, h }
        }))
        interactionRef.current = { ...it, startMouseX: e.clientX, startMouseY: e.clientY }
      } else if (it.type === 'rotate' && it.centerX !== undefined && it.centerY !== undefined) {
        // 增量算: 每次 mousemove 算从上次到现在转过的角度差, 加到当前 rotation
        // 这样跨象限不会跳 (a0/a1 用 atan2 直接做差会跳 360, 用增量小步走没问题)
        const a0 = Math.atan2(it.startMouseY - it.centerY, it.startMouseX - it.centerX)
        const a1 = Math.atan2(e.clientY - it.centerY, e.clientX - it.centerX)
        let delta = (a1 - a0) * 180 / Math.PI
        if (delta > 180) delta -= 360
        if (delta < -180) delta += 360
        if (Math.abs(delta) < 0.5) return
        setFields(prev => prev.map(f => f._id === it.fieldId ? { ...f, rotation: Math.round((f.rotation || 0) + delta) } : f))
        interactionRef.current = { ...it, startMouseX: e.clientX, startMouseY: e.clientY }
      }
    }
    const onUp = () => { interactionRef.current = null; document.body.style.cursor = '' }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [bgNaturalSize.w])

  // 处理底图选择 + OSS 直传
  const handleBgFile = async (f: File) => {
    setBgFile(f); setEditorErr('')
    const localUrl = URL.createObjectURL(f)
    setBgPreviewUrl(localUrl)
    // 探测原始尺寸
    const img = new Image()
    img.onload = () => setBgNaturalSize({ w: img.naturalWidth, h: img.naturalHeight })
    img.src = localUrl

    // 直传 OSS
    setBgUploading(true); setBgUploadProgress(0)
    try {
      const token = localStorage.getItem('monoi_token') || ''
      const signRes = await fetch(directBase + '/api/oss/sign-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ filename: f.name, content_type: f.type || 'image/png' }),
      })
      if (!signRes.ok) throw new Error('OSS 签名失败')
      const { put_url, oss_key, content_type } = await signRes.json()

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('PUT', put_url)
        xhr.setRequestHeader('Content-Type', content_type)
        xhr.upload.onprogress = e => {
          if (e.lengthComputable) setBgUploadProgress(Math.round(e.loaded / e.total * 100))
        }
        xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`OSS PUT ${xhr.status}`))
        xhr.onerror = () => reject(new Error('OSS PUT 网络错误'))
        xhr.send(f)
      })
      setBgOssKey(oss_key)
    } catch (e: any) {
      setEditorErr('底图上传失败: ' + e.message)
    } finally {
      setBgUploading(false)
    }
  }

  // 在 canvas 上鼠标按下 → 开始画框
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canvasRef.current) return
    if ((e.target as HTMLElement).closest('[data-field-box]')) return  // 点已有 box 不画
    const rect = canvasRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    setDrawing({ startX: x, startY: y, curX: x, curY: y })
  }
  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!drawing || !canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    setDrawing({ ...drawing, curX: e.clientX - rect.left, curY: e.clientY - rect.top })
  }
  const handleCanvasMouseUp = () => {
    if (!drawing || !canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const minX = Math.min(drawing.startX, drawing.curX)
    const minY = Math.min(drawing.startY, drawing.curY)
    const maxX = Math.max(drawing.startX, drawing.curX)
    const maxY = Math.max(drawing.startY, drawing.curY)
    setDrawing(null)
    if (maxX - minX < 30 || maxY - minY < 30) return    // 太小当点击, 不加
    const scaleX = bgNaturalSize.w / rect.width
    const scaleY = bgNaturalSize.h / rect.height
    const x = Math.round(minX * scaleX)
    const y = Math.round(minY * scaleY)
    const w = Math.round((maxX - minX) * scaleX)
    const h = Math.round((maxY - minY) * scaleY)

    if (drawMode === 'person') {
      // 人物坑只能 1 个, 拖新框替换旧的
      setPersonSlot({
        x, y, w, h,
        stroke_enabled: true, stroke_color: '#FFFFFF', stroke_width: 12,
        fit_mode: 'cover',
      })
      setActiveFieldId(null); setPersonSelected(true)
      setDrawMode('text')     // 加完人物坑自动切回文字模式
      return
    }

    // 默认: 加文字字段
    const newField: UiTextField = {
      _id: `f_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      label: fields.length === 0 ? '主标题' : fields.length === 1 ? '副标题' : `字段${fields.length + 1}`,
      x, y, w, h,
      font_file: fonts[0]?.file || 'SourceHanSansCN-Heavy.otf',
      font_size: Math.round(h * 0.7),
      color: '#FFFFFF',
      highlight_color: '#FFD700',
      stroke_color: '#000000', stroke_width: 6,
      shadow_color: null, shadow_offset_x: 0, shadow_offset_y: 0, shadow_blur: 0,
      align: 'left', rotation: 0, max_chars: 0, placeholder: '',
    }
    setFields(prev => [...prev, newField])
    setActiveFieldId(newField._id); setPersonSelected(false)
  }

  const updateField = (id: string, patch: Partial<UiTextField>) => {
    setFields(prev => prev.map(f => f._id === id ? { ...f, ...patch } : f))
  }
  const removeField = (id: string) => {
    setFields(prev => prev.filter(f => f._id !== id))
    if (activeFieldId === id) setActiveFieldId(null)
  }

  const handleSave = async () => {
    if (!name.trim()) { setEditorErr('请填模板名'); return }
    if (!bgOssKey) { setEditorErr('请先上传底图'); return }
    // 字段为空也允许 (纯底图模板, 用户自己加文字)
    setSaving(true); setEditorErr('')
    try {
      const cleanFields: CoverTextField[] = fields.map(({ _id, ...f }) => f)
      await adminAddCoverTemplate({
        name: name.trim(), category, ratio,
        bg_oss_key: bgOssKey,
        text_fields: cleanFields,
        person_slot: personSlot,    // 没人物坑就传 null
      })
      onSaved()
    } catch (e: any) {
      setEditorErr(e.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const activeField = fields.find(f => f._id === activeFieldId) || null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="relative bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-ios-lg w-full max-w-6xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
          <div className="text-base font-semibold">新建封面模板</div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--bg-hover)] cursor-pointer"><X size={16}/></button>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
          {/* 左侧: 基础信息 + 字段表 */}
          <div className="lg:w-72 flex-shrink-0 border-r border-[var(--border)] p-4 overflow-y-auto flex flex-col gap-3">
            <div>
              <label className="text-xs text-[var(--text-3)]">模板名</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="例: 震惊体红黄底"
                className="w-full bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1.5 text-sm mt-1"/>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-[var(--text-3)]">类目</label>
                <select value={category} onChange={e => setCategory(e.target.value)}
                  className="w-full bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1.5 text-sm mt-1">
                  {COVER_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-[var(--text-3)]">比例</label>
                <select value={ratio} onChange={e => setRatio(e.target.value as any)}
                  className="w-full bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1.5 text-sm mt-1">
                  {COVER_RATIOS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
            </div>

            <div className="border-t border-[var(--border)] pt-3">
              <label className="text-xs text-[var(--text-3)]">底图 PNG (建议跟比例匹配, 标题位置留白)</label>
              <input type="file" accept="image/*"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleBgFile(f) }}
                className="text-xs text-[var(--text-2)] mt-1"/>
              {bgUploading && (
                <div className="mt-2 h-1 bg-[var(--bg)] rounded overflow-hidden">
                  <div className="h-full bg-[var(--text)] transition-all" style={{ width: `${bgUploadProgress}%` }}/>
                </div>
              )}
              {bgPreviewUrl && !bgUploading && (
                <div className="text-[10px] text-[var(--text-3)] mt-1">
                  {bgNaturalSize.w}×{bgNaturalSize.h} px {bgOssKey ? '· ✓ OSS 已上传' : ''}
                </div>
              )}
            </div>

            <div className="border-t border-[var(--border)] pt-3 flex-1 min-h-0 flex flex-col">
              {/* 模式切换: 文字 / 人物 */}
              <div className="flex gap-1 mb-3 p-0.5 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
                <button onClick={() => setDrawMode('text')}
                  className={`flex-1 px-2 py-1 rounded text-xs cursor-pointer ${
                    drawMode === 'text' ? 'bg-[var(--text)] text-[var(--bg)]' : 'text-[var(--text-3)]'
                  }`}>
                  拖框加 文字
                </button>
                <button onClick={() => setDrawMode('person')}
                  className={`flex-1 px-2 py-1 rounded text-xs cursor-pointer ${
                    drawMode === 'person' ? 'bg-pink-500 text-white' : 'text-[var(--text-3)]'
                  }`}>
                  拖框加 人物坑
                </button>
              </div>

              {/* 人物坑 (最多 1) */}
              {personSlot && (
                <button
                  onClick={() => { setPersonSelected(true); setActiveFieldId(null) }}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs cursor-pointer mb-1 ${
                    personSelected ? 'bg-pink-500 text-white' : 'text-pink-400 bg-pink-500/10 hover:bg-pink-500/20'
                  }`}>
                  <span className="font-mono text-[10px] opacity-60">人物</span>
                  <span className="flex-1 text-left">人物坑 {personSlot.stroke_enabled ? '· 描边' : ''}</span>
                  <span className="text-[10px] opacity-60">{personSlot.w}×{personSlot.h}</span>
                </button>
              )}

              <div className="text-xs text-[var(--text-3)] mb-2 mt-1">
                文字字段 ({fields.length})
                {drawMode === 'person' && <span className="ml-2 text-pink-400">↑ 模式: 拖框设人物坑</span>}
              </div>
              <div className="flex flex-col gap-1 overflow-y-auto">
                {fields.map((f, i) => (
                  <button key={f._id} onClick={() => { setActiveFieldId(f._id); setPersonSelected(false) }}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs cursor-pointer ${
                      activeFieldId === f._id ? 'bg-[var(--text)] text-[var(--bg)]' : 'text-[var(--text-2)] hover:bg-[var(--bg-hover)]'
                    }`}>
                    <span className="font-mono text-[10px] opacity-60">#{i + 1}</span>
                    <span className="flex-1 text-left truncate">{f.label}</span>
                    <span className="text-[10px] opacity-60">{f.w}×{f.h}</span>
                  </button>
                ))}
                {fields.length === 0 && !personSlot && (
                  <div className="text-xs text-[var(--text-3)] py-4 text-center">
                    暂无字段, 在右侧底图上 <span className="text-amber-500">按住鼠标拖一个矩形</span> 添加
                  </div>
                )}
              </div>
            </div>

            {editorErr && <div className="text-xs text-red-400">{editorErr}</div>}
            <button onClick={handleSave} disabled={saving || bgUploading}
              className="w-full py-2 rounded-lg bg-[var(--text)] text-[var(--bg)] text-sm cursor-pointer disabled:opacity-50">
              {saving ? <span className="flex items-center justify-center gap-1.5"><Loader2 size={12} className="animate-spin"/> 保存中</span> : '保存模板'}
            </button>
          </div>

          {/* 中间: 底图 + 拖框 */}
          <div className="flex-1 min-w-0 bg-[var(--bg)] overflow-auto p-4 flex items-start justify-center">
            {!bgPreviewUrl ? (
              <div className="flex flex-col items-center justify-center text-[var(--text-3)] text-sm py-20">
                <MousePointer2 size={32} className="mb-3 opacity-50"/>
                <div>左侧上传底图后, 在这里拖鼠标画文字框</div>
              </div>
            ) : (
              <div ref={canvasRef}
                onMouseDown={handleCanvasMouseDown}
                onMouseMove={handleCanvasMouseMove}
                onMouseUp={handleCanvasMouseUp}
                onMouseLeave={() => setDrawing(null)}
                className={`relative inline-block max-w-full select-none ${drawMode === 'person' ? 'cursor-crosshair' : 'cursor-crosshair'}`}
                style={{ maxHeight: '70vh' }}
              >
                <img src={bgPreviewUrl} draggable={false} className="block max-w-full pointer-events-none"
                  style={{ maxHeight: '70vh' }}/>

                {/* 已有的字段框 + 文字预览 (用 admin 设的字体/颜色/字号实时渲染示例文字) */}
                {bgNaturalSize.w > 0 && fields.map((f, i) => {
                  const imgEl = canvasRef.current?.querySelector('img')
                  const rect = imgEl?.getBoundingClientRect()
                  if (!rect) return null
                  const sx = rect.width / bgNaturalSize.w
                  const sy = rect.height / bgNaturalSize.h
                  // 文字预览用 placeholder, 没有就用 label
                  const previewText = f.placeholder || f.label
                  const segs = parseSegments(previewText)
                  // 字号按底图缩放, scaled to canvas
                  const scaledFontSize = f.font_size * sx     // sx ≈ sy 假设
                  const justify = f.align === 'center' ? 'center' : f.align === 'right' ? 'flex-end' : 'flex-start'
                  const rotation = f.rotation || 0
                  const hasRotation = Math.abs(rotation) > 0.01
                  const isActive = activeFieldId === f._id
                  return (
                    <div key={f._id} data-field-box
                      onMouseDown={(e) => {
                        e.preventDefault(); e.stopPropagation()
                        setActiveFieldId(f._id); setPersonSelected(false)
                        interactionRef.current = { type: 'move', fieldId: f._id, startMouseX: e.clientX, startMouseY: e.clientY }
                        document.body.style.cursor = 'move'
                      }}
                      className={`absolute border-2 cursor-move flex items-center select-none ${
                        isActive ? 'border-blue-500' : 'border-blue-400 bg-blue-400/5 hover:border-amber-400'
                      }`}
                      style={{
                        left: f.x * sx, top: f.y * sy, width: f.w * sx, height: f.h * sy,
                        justifyContent: justify,
                      }}
                    >
                      <div className="absolute -top-5 left-0 text-[10px] bg-[var(--text)] text-[var(--bg)] px-1 rounded whitespace-nowrap z-10">
                        #{i + 1} {f.label}
                      </div>
                      {/* 字体预览 */}
                      <div style={{
                        fontFamily: `"${fontFamily(f.font_file)}", sans-serif`,
                        fontSize: `${scaledFontSize}px`,
                        color: f.color,
                        fontWeight: 900,
                        lineHeight: 1,
                        textAlign: f.align as any,
                        whiteSpace: 'nowrap',
                        transform: hasRotation ? `rotate(${rotation}deg)` : undefined,
                        transformOrigin: 'center',
                        WebkitTextStroke: (f.stroke_color && f.stroke_width > 0)
                          ? `${f.stroke_width * 2 * sx}px ${f.stroke_color}` : undefined,
                        paintOrder: 'stroke fill' as const,
                        pointerEvents: 'none',
                      }}>
                        {segs.map((s, j) => (
                          <span key={j} style={{ color: s.highlight ? (f.highlight_color || f.color) : f.color }}>{s.text}</span>
                        ))}
                      </div>

                      {/* Canva 风手柄 — 选中时显示 */}
                      {isActive && (
                        <>
                          {(['nw', 'ne', 'sw', 'se'] as const).map(corner => {
                            const pos: React.CSSProperties = {
                              position: 'absolute',
                              top: corner.startsWith('n') ? -6 : 'auto',
                              bottom: corner.startsWith('s') ? -6 : 'auto',
                              left: corner.endsWith('w') ? -6 : 'auto',
                              right: corner.endsWith('e') ? -6 : 'auto',
                              cursor: `${corner}-resize`,
                            }
                            return (
                              <div key={corner}
                                onMouseDown={(e) => {
                                  e.preventDefault(); e.stopPropagation()
                                  interactionRef.current = { type: 'resize', fieldId: f._id, corner,
                                    startMouseX: e.clientX, startMouseY: e.clientY }
                                  document.body.style.cursor = `${corner}-resize`
                                }}
                                className="w-3 h-3 bg-blue-500 border-2 border-white rounded-sm shadow"
                                style={pos}/>
                            )
                          })}
                          {/* 顶部旋转手柄 — 圆形带 ↻ 图标, 大一点显眼 */}
                          <div
                            onMouseDown={(e) => {
                              e.preventDefault(); e.stopPropagation()
                              const imgEl2 = canvasRef.current?.querySelector('img')
                              const r2 = imgEl2?.getBoundingClientRect()
                              if (!r2) return
                              const cx = r2.left + (f.x + f.w / 2) * sx
                              const cy = r2.top + (f.y + f.h / 2) * sy
                              interactionRef.current = {
                                type: 'rotate', fieldId: f._id,
                                startMouseX: e.clientX, startMouseY: e.clientY,
                                centerX: cx, centerY: cy,
                                startRotation: rotation,
                              }
                              document.body.style.cursor = 'crosshair'
                            }}
                            className="absolute w-6 h-6 bg-blue-500 border-2 border-white rounded-full shadow-lg cursor-grab active:cursor-grabbing flex items-center justify-center text-white text-[10px] font-bold"
                            style={{ top: -32, left: '50%', transform: 'translateX(-50%)', zIndex: 20 }}
                            title="拖动旋转"
                          >↻</div>
                          {/* 旋转手柄到框顶的连线 (视觉指示) */}
                          <div className="absolute pointer-events-none border-l border-blue-500"
                            style={{ top: -20, left: '50%', width: 0, height: 12, transform: 'translateX(-0.5px)' }}/>
                        </>
                      )}
                    </div>
                  )
                })}

                {/* 人物坑框 (粉色, 跟文字框颜色区分) */}
                {bgNaturalSize.w > 0 && personSlot && (() => {
                  const imgEl = canvasRef.current?.querySelector('img')
                  const rect = imgEl?.getBoundingClientRect()
                  if (!rect) return null
                  const sx = rect.width / bgNaturalSize.w
                  const sy = rect.height / bgNaturalSize.h
                  return (
                    <div data-field-box
                      onClick={(e) => { e.stopPropagation(); setPersonSelected(true); setActiveFieldId(null) }}
                      className={`absolute border-2 cursor-pointer ${
                        personSelected ? 'border-pink-500 bg-pink-500/15' : 'border-pink-400 border-dashed bg-pink-400/5'
                      }`}
                      style={{ left: personSlot.x * sx, top: personSlot.y * sy, width: personSlot.w * sx, height: personSlot.h * sy }}
                    >
                      <div className="absolute -top-5 left-0 text-[10px] bg-pink-500 text-white px-1 rounded whitespace-nowrap">
                        人物坑
                      </div>
                    </div>
                  )
                })()}

                {/* 正在画的临时框 (mode 不同颜色不同) */}
                {drawing && (
                  <div className={`absolute border-2 border-dashed pointer-events-none ${
                      drawMode === 'person' ? 'border-pink-400 bg-pink-400/10' : 'border-amber-400 bg-amber-400/10'
                    }`}
                    style={{
                      left: Math.min(drawing.startX, drawing.curX),
                      top: Math.min(drawing.startY, drawing.curY),
                      width: Math.abs(drawing.curX - drawing.startX),
                      height: Math.abs(drawing.curY - drawing.startY),
                    }}
                  />
                )}
              </div>
            )}
          </div>

          {/* 右侧: 字段属性编辑 */}
          <div className="lg:w-80 flex-shrink-0 border-l border-[var(--border)] p-4 overflow-y-auto">
            {personSelected && personSlot ? (
              <PersonSlotEditor
                slot={personSlot}
                onChange={patch => setPersonSlot(prev => prev ? { ...prev, ...patch } : prev)}
                onRemove={() => { setPersonSlot(null); setPersonSelected(false) }}
              />
            ) : activeField ? (
              <FieldEditor
                field={activeField}
                fonts={fonts}
                onChange={patch => updateField(activeField._id, patch)}
                onRemove={() => removeField(activeField._id)}
              />
            ) : (
              <div className="text-xs text-[var(--text-3)] py-6 text-center">
                左侧字段表点一个 / 中间画一个新框
                <br/>这里能编辑选中字段的字体/颜色/描边等
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** 右侧字段属性面板 */
function FieldEditor({ field, fonts, onChange, onRemove }: {
  field: UiTextField
  fonts: FontOption[]
  onChange: (patch: Partial<UiTextField>) => void
  onRemove: () => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">编辑字段</div>
        <button onClick={onRemove} className="p-1 rounded text-red-400 hover:bg-red-950/30 cursor-pointer">
          <Trash2 size={14}/>
        </button>
      </div>

      <div>
        <label className="text-xs text-[var(--text-3)]">字段名 (admin/用户都能看到)</label>
        <input value={field.label} onChange={e => onChange({ label: e.target.value })}
          className="w-full bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1.5 text-sm mt-1"/>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs text-[var(--text-3)]">
        <div>X: <input type="number" value={field.x} onChange={e => onChange({ x: +e.target.value })} className="w-full bg-[var(--bg)] border border-[var(--border)] rounded px-1 py-0.5 mt-0.5 text-[var(--text)]"/></div>
        <div>Y: <input type="number" value={field.y} onChange={e => onChange({ y: +e.target.value })} className="w-full bg-[var(--bg)] border border-[var(--border)] rounded px-1 py-0.5 mt-0.5 text-[var(--text)]"/></div>
        <div>宽: <input type="number" value={field.w} onChange={e => onChange({ w: +e.target.value })} className="w-full bg-[var(--bg)] border border-[var(--border)] rounded px-1 py-0.5 mt-0.5 text-[var(--text)]"/></div>
        <div>高: <input type="number" value={field.h} onChange={e => onChange({ h: +e.target.value })} className="w-full bg-[var(--bg)] border border-[var(--border)] rounded px-1 py-0.5 mt-0.5 text-[var(--text)]"/></div>
      </div>

      <div>
        <label className="text-xs text-[var(--text-3)]">字体</label>
        <select value={field.font_file} onChange={e => onChange({ font_file: e.target.value })}
          className="w-full bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1.5 text-sm mt-1">
          {fonts.map(f => <option key={f.file} value={f.file}>{f.label} {f.tag ? `(${f.tag})` : ''}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-[var(--text-3)]">字号 (px)</label>
          <input type="number" value={field.font_size} onChange={e => onChange({ font_size: +e.target.value })}
            className="w-full bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1.5 text-sm mt-1"/>
        </div>
        <div>
          <label className="text-xs text-[var(--text-3)]">对齐</label>
          <select value={field.align} onChange={e => onChange({ align: e.target.value as any })}
            className="w-full bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1.5 text-sm mt-1">
            <option value="left">左</option><option value="center">中</option><option value="right">右</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-[var(--text-3)]">主色</label>
          <input type="color" value={field.color} onChange={e => onChange({ color: e.target.value })}
            className="w-full h-8 bg-[var(--bg)] border border-[var(--border)] rounded mt-1 cursor-pointer"/>
        </div>
        <div>
          <label className="text-xs text-[var(--text-3)]">高亮色 ({'{}'}内字)</label>
          <input type="color" value={field.highlight_color || '#FFD700'} onChange={e => onChange({ highlight_color: e.target.value })}
            className="w-full h-8 bg-[var(--bg)] border border-[var(--border)] rounded mt-1 cursor-pointer"/>
        </div>
      </div>

      <div className="border-t border-[var(--border)] pt-3">
        <div className="text-xs text-[var(--text-3)] mb-2">描边 (在复杂背景上让字更清晰)</div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-[var(--text-3)]">描边色</label>
            <input type="color" value={field.stroke_color || '#000000'} onChange={e => onChange({ stroke_color: e.target.value })}
              className="w-full h-7 bg-[var(--bg)] border border-[var(--border)] rounded mt-0.5 cursor-pointer"/>
          </div>
          <div>
            <label className="text-[10px] text-[var(--text-3)]">描边宽 (0=不描边)</label>
            <input type="number" value={field.stroke_width} onChange={e => onChange({ stroke_width: +e.target.value })}
              className="w-full h-7 bg-[var(--bg)] border border-[var(--border)] rounded px-1.5 text-sm mt-0.5"/>
          </div>
        </div>
      </div>

      <div>
        <label className="text-xs text-[var(--text-3)]">旋转角度 ({(field.rotation || 0).toFixed(0)}°)</label>
        <div className="flex items-center gap-2 mt-1">
          <input type="range" min={-45} max={45} step={1} value={field.rotation || 0}
            onChange={e => onChange({ rotation: +e.target.value })}
            className="flex-1 accent-current cursor-pointer"/>
          <button onClick={() => onChange({ rotation: 0 })}
            className="text-[10px] text-[var(--text-3)] hover:text-[var(--text)] cursor-pointer">归零</button>
        </div>
        <div className="text-[10px] text-[var(--text-3)] mt-0.5">震惊/街头封面常用 -10° ~ +10° 倾斜</div>
      </div>

      <div>
        <label className="text-xs text-[var(--text-3)]">用户输入示例 (提示文字)</label>
        <input value={field.placeholder} onChange={e => onChange({ placeholder: e.target.value })}
          placeholder={`例: 封面{邪修}`}
          className="w-full bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1.5 text-sm mt-1"/>
      </div>

      <div>
        <label className="text-xs text-[var(--text-3)]">最大字数 (0=不限)</label>
        <input type="number" value={field.max_chars} onChange={e => onChange({ max_chars: +e.target.value })}
          className="w-full bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1.5 text-sm mt-1"/>
      </div>
    </div>
  )
}


/** 人物坑属性编辑面板 — 跟 FieldEditor 类似的右侧栏 */
function PersonSlotEditor({ slot, onChange, onRemove }: {
  slot: CoverPersonSlot
  onChange: (patch: Partial<CoverPersonSlot>) => void
  onRemove: () => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-pink-400">人物坑</div>
        <button onClick={onRemove} className="p-1 rounded text-red-400 hover:bg-red-950/30 cursor-pointer">
          <Trash2 size={14}/>
        </button>
      </div>

      <div className="text-xs text-[var(--text-3)] bg-[var(--bg-hover)] rounded p-2 leading-relaxed">
        💡 用户上传一张人物照片, 后端 rembg 自动抠图, 按 fit_mode 塞进这个坑.
        可选给抠完的人物加描边, 让人物从背景分离更清楚.
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs text-[var(--text-3)]">
        <div>X: <input type="number" value={slot.x} onChange={e => onChange({ x: +e.target.value })} className="w-full bg-[var(--bg)] border border-[var(--border)] rounded px-1 py-0.5 mt-0.5 text-[var(--text)]"/></div>
        <div>Y: <input type="number" value={slot.y} onChange={e => onChange({ y: +e.target.value })} className="w-full bg-[var(--bg)] border border-[var(--border)] rounded px-1 py-0.5 mt-0.5 text-[var(--text)]"/></div>
        <div>宽: <input type="number" value={slot.w} onChange={e => onChange({ w: +e.target.value })} className="w-full bg-[var(--bg)] border border-[var(--border)] rounded px-1 py-0.5 mt-0.5 text-[var(--text)]"/></div>
        <div>高: <input type="number" value={slot.h} onChange={e => onChange({ h: +e.target.value })} className="w-full bg-[var(--bg)] border border-[var(--border)] rounded px-1 py-0.5 mt-0.5 text-[var(--text)]"/></div>
      </div>

      <div>
        <label className="text-xs text-[var(--text-3)]">填充方式</label>
        <select value={slot.fit_mode} onChange={e => onChange({ fit_mode: e.target.value as any })}
          className="w-full bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1.5 text-sm mt-1">
          <option value="cover">cover (按比例填满, 多余裁掉)</option>
          <option value="contain">contain (按比例完整显示, 留白)</option>
        </select>
      </div>

      <div className="border-t border-[var(--border)] pt-3">
        <label className="flex items-center gap-2 text-xs text-[var(--text-2)] cursor-pointer">
          <input type="checkbox" checked={slot.stroke_enabled}
            onChange={e => onChange({ stroke_enabled: e.target.checked })}/>
          给人物加描边 (Canva 风格, 让人物从背景分离)
        </label>
        {slot.stroke_enabled && (
          <div className="grid grid-cols-2 gap-2 mt-2">
            <div>
              <label className="text-[10px] text-[var(--text-3)]">描边色</label>
              <input type="color" value={slot.stroke_color}
                onChange={e => onChange({ stroke_color: e.target.value })}
                className="w-full h-7 bg-[var(--bg)] border border-[var(--border)] rounded mt-0.5 cursor-pointer"/>
            </div>
            <div>
              <label className="text-[10px] text-[var(--text-3)]">描边宽 (px)</label>
              <input type="number" value={slot.stroke_width}
                onChange={e => onChange({ stroke_width: +e.target.value })}
                className="w-full h-7 bg-[var(--bg)] border border-[var(--border)] rounded px-1.5 text-sm mt-0.5"/>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}


/** 用底图真实尺寸 (naturalWidth/Height) 算字段 + 人物坑的 % 定位,
 * 这样 16:9 / 3:4 / 9:16 任何比例 admin 上传都对得上 */
function TemplateOverlayBoxes({ template, bgUrl }: { template: AdminCoverTemplate; bgUrl: string }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    const img = new Image()
    img.onload = () => setSize({ w: img.naturalWidth, h: img.naturalHeight })
    img.src = bgUrl
  }, [bgUrl])
  if (!size) return null
  return (
    <>
      {template.text_fields.map((f, i) => (
        <div key={i} className="absolute border border-amber-400/70 bg-amber-400/10 pointer-events-none"
          style={{
            left: `${f.x / size.w * 100}%`,
            top: `${f.y / size.h * 100}%`,
            width: `${f.w / size.w * 100}%`,
            height: `${f.h / size.h * 100}%`,
          }}/>
      ))}
      {template.person_slot && (
        <div className="absolute border border-pink-400/70 bg-pink-400/10 pointer-events-none"
          style={{
            left: `${template.person_slot.x / size.w * 100}%`,
            top: `${template.person_slot.y / size.h * 100}%`,
            width: `${template.person_slot.w / size.w * 100}%`,
            height: `${template.person_slot.h / size.h * 100}%`,
          }}/>
      )}
    </>
  )
}
