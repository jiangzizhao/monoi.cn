import { useEffect, useState } from 'react'
import { Plus, Trash2, MessageSquare, LogOut, Shield, Video, Mic, Download } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useChatStore } from '../../store/chatStore'
import { getUsername, logout, isLoggedIn } from '../../lib/auth'
import { fetchMyProfile, type UserProfile } from '../../services/billing'
import { fetchDesktopLatest, type DesktopLatest } from '../../services/desktop'
import { TopTabBar } from './TopTabBar'

function timeAgo(ts: number) {
  const diff = Date.now() - ts
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
  return `${Math.floor(diff / 86400000)}天前`
}

export function Sidebar({ onClose }: { onClose?: () => void }) {
  const { conversations, activeId, setActiveId, newConversation, deleteConversation } = useChatStore()
  const nav = useNavigate()
  const location = useLocation()
  const username = getUsername()
  const [me, setMe] = useState<UserProfile | null>(null)
  const isAdmin = !!me?.is_admin
  const [desktop, setDesktop] = useState<DesktopLatest | null>(null)

  // 拉桌面端最新版 URL (后端 desktop_release.json), 没发布隐藏按钮
  useEffect(() => {
    if (typeof (window as any).monoiDesktop !== 'undefined') return
    fetchDesktopLatest().then(setDesktop).catch(() => {})
  }, [])

  // 当前 tab — 决定中间列表显示啥内容. /app 默认按 chat
  const activeTab: 'chat' | 'record' | 'voice' =
    location.pathname.startsWith('/app/record') ? 'record'
    : location.pathname.startsWith('/app/voice') ? 'voice'
    : 'chat'

  useEffect(() => {
    const reload = () => {
      if (isLoggedIn()) fetchMyProfile().then(setMe).catch(() => {})
    }
    reload()
    // Account 改完头像/用户名后会 dispatch 这个事件, 听到就重新拉一遍
    window.addEventListener('monoi:profile-updated', reload)
    return () => window.removeEventListener('monoi:profile-updated', reload)
  }, [])

  const handleLogout = () => {
    logout()
    nav('/login')
  }

  const handleNew = () => {
    newConversation()
    onClose?.()
  }

  const handleSelect = (id: string) => {
    setActiveId(id)
    onClose?.()
  }

  return (
    <div className="flex flex-col h-full bg-[var(--bg)] border-r border-[var(--border)]">
      {/* 顶部 tab (创作 / 录屏 / 闪说) — 跟 Claude UI 一致, 放在侧栏最顶上 */}
      <TopTabBar onPick={onClose}/>

      {/* Header (monoi logo + 当前 tab 的"新建"按钮) */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="monoi" className="w-7 h-7 rounded-lg object-contain"/>
          <span className="text-sm font-semibold text-[var(--text)]">monoi</span>
        </div>
        {/* "+" 按钮: 只在创作 tab 显示新对话; 录屏/闪说还没历史功能, 先隐藏 */}
        {activeTab === 'chat' && (
          <button onClick={handleNew}
            className="p-1.5 rounded-lg text-[var(--text-3)] hover:text-[var(--text-2)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
            title="新对话">
            <Plus size={16}/>
          </button>
        )}
      </div>

      {/* 列表区 — 跟着当前 tab 切换内容 */}
      <div className="flex-1 overflow-y-auto py-2 px-2">
        {activeTab === 'chat' && (
          conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 gap-2 text-[var(--text-3)]">
              <MessageSquare size={20} strokeWidth={1.5}/>
              <span className="text-xs">还没有对话</span>
            </div>
          ) : (
            conversations.map(conv => {
              const isActive = conv.id === activeId
              return (
                <div key={conv.id}
                  className={`group flex items-center gap-2 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-150 mb-0.5 ${isActive ? 'bg-[var(--bg-hover)] text-[var(--text)]' : 'text-[var(--text-2)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'}`}
                  onClick={() => handleSelect(conv.id)}>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{conv.title}</div>
                    <div className="text-[10px] text-[var(--text-3)] mt-0.5">{timeAgo(conv.updatedAt)}</div>
                  </div>
                  <button onClick={e => { e.stopPropagation(); deleteConversation(conv.id) }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--text-3)] hover:text-red-400 transition-all cursor-pointer">
                    <Trash2 size={13}/>
                  </button>
                </div>
              )
            })
          )
        )}

        {activeTab === 'record' && (
          <div className="flex flex-col items-center justify-center h-40 gap-2 text-[var(--text-3)] px-4 text-center">
            <Video size={20} strokeWidth={1.5}/>
            <span className="text-xs">还没有录屏记录</span>
            <span className="text-[10px] opacity-70">Phase 3 上线后, 录的视频会出现在这里</span>
          </div>
        )}

        {activeTab === 'voice' && (
          <div className="flex flex-col items-center justify-center h-40 gap-2 text-[var(--text-3)] px-4 text-center">
            <Mic size={20} strokeWidth={1.5}/>
            <span className="text-xs">还没有闪说记录</span>
            <span className="text-[10px] opacity-70">Phase 2 上线后, 录的语音和文字会出现在这里</span>
          </div>
        )}
      </div>

      {/* Footer: 用户 / 账户中心 / 登出 */}
      <div className="border-t border-[var(--border)] px-2 py-2 flex flex-col gap-0.5">
        <Link to="/app/account" onClick={onClose}
          className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-[var(--text-2)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] cursor-pointer transition-colors">
          <div className="w-6 h-6 rounded-full bg-[var(--text)] text-[var(--bg)] flex items-center justify-center text-[10px] font-bold overflow-hidden flex-shrink-0">
            {me?.avatar_url ? (
              <img src={me.avatar_url} alt="" className="w-full h-full object-cover"/>
            ) : (
              <span>{(me?.username || username)?.[0]?.toUpperCase() || 'M'}</span>
            )}
          </div>
          <span className="flex-1 truncate">{me?.username || username || '账户'}</span>
          <span className="text-[10px] text-[var(--text-3)]">账户中心</span>
        </Link>
        {isAdmin && (
          <Link to="/admin" onClick={onClose}
            className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-[var(--text-2)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] cursor-pointer transition-colors">
            <Shield size={14}/>
            <span className="flex-1 truncate">管理后台</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500 text-white">admin</span>
          </Link>
        )}
        {/* 下载桌面版 — 已在桌面端 / 没发布都不显示 */}
        {typeof (window as any).monoiDesktop === 'undefined' && desktop?.available && desktop.exe_url && (
          <a href={desktop.exe_url}
            download
            className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-[var(--text-2)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] cursor-pointer transition-colors"
            title={`v${desktop.version}${desktop.size_mb ? ` · ${desktop.size_mb} MB` : ''}`}>
            <Download size={14}/>
            <span className="flex-1 truncate">下载桌面版</span>
            <span className="text-[10px] text-[var(--text-3)]">用自己账号发</span>
          </a>
        )}
        <button onClick={handleLogout}
          className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-[var(--text-3)] hover:bg-[var(--bg-hover)] hover:text-red-400 cursor-pointer transition-colors">
          <LogOut size={14}/> 退出登录
        </button>
      </div>
    </div>
  )
}
