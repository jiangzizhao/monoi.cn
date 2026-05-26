// 桌面端有新版本时, 右下角浮一张小卡片 (仿 Claude Code 的 "Relaunch to update" 样式).
//
// 触发条件:
// - 必须在桌面端运行 (window.monoiDesktop.isDesktop === true)
// - 必须 electron 主进程 update-downloaded 事件触发并发了 'updater:update-ready' IPC
//
// 网页端 (没 monoiDesktop) 完全不显示, useEffect 直接 noop.
//
// 点了卡片 → 调 window.monoiDesktop.relaunchToUpdate() → quitAndInstall + 启动新版.
// 用户也可以点 × 暂时关掉卡片 (本次会话不再弹), 下次启动还会再触发.

import { useEffect, useState } from 'react'
import { ArrowRight, X } from 'lucide-react'

// preload 暴露的形状, 跟 electron/preload.ts 对齐
interface MonoiDesktop {
  isDesktop?: boolean
  version?: string
  onUpdateReady?: (cb: (p: { version: string; releaseDate: string | null }) => void) => () => void
  relaunchToUpdate?: () => Promise<{ ok: boolean; error?: string }>
}
declare global {
  interface Window { monoiDesktop?: MonoiDesktop }
}

export function UpdateAvailableCard() {
  const [version, setVersion] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [relaunching, setRelaunching] = useState(false)

  useEffect(() => {
    // 网页端 / 没 onUpdateReady → 不订阅. 旧版桌面端 (没 preload bridge) 也安全降级
    if (!window.monoiDesktop?.isDesktop || !window.monoiDesktop.onUpdateReady) return
    const off = window.monoiDesktop.onUpdateReady(({ version }) => {
      setVersion(version)
      setDismissed(false)   // 来新版本了再次显示, 即使之前 dismiss 过
    })
    return off
  }, [])

  if (!version || dismissed) return null

  const handleRelaunch = async () => {
    if (relaunching) return
    setRelaunching(true)
    try {
      await window.monoiDesktop?.relaunchToUpdate?.()
      // 正常情况下进程会直接退出, 下面不会执行. 走到这说明 quitAndInstall 失败了
    } catch {
      // 失败就还原状态, 让用户能再点
      setRelaunching(false)
    }
  }

  return (
    <div
      className="fixed bottom-5 right-5 z-[9998] group"
      role="alert"
      aria-live="polite"
    >
      <button
        onClick={handleRelaunch}
        disabled={relaunching}
        className="
          flex items-center gap-3 pl-3 pr-4 py-2.5
          bg-[var(--bg-card)] border border-[var(--border)] rounded-xl
          shadow-lg shadow-black/20
          hover:bg-[var(--bg-hover)] hover:border-[var(--text-3)]
          active:scale-[0.98]
          transition-all cursor-pointer
          disabled:cursor-wait disabled:opacity-70
          min-w-[220px]
        "
      >
        {/* 左边图标 — 用 monoi 的 logo 风格 (圆角方框), 也可以换 Lucide 的 RefreshCw / Download */}
        <div className="w-8 h-8 rounded-lg bg-[var(--text)] text-[var(--bg)] flex items-center justify-center text-xs font-bold flex-shrink-0">
          M
        </div>
        <div className="flex-1 text-left">
          <div className="text-sm font-medium text-[var(--text)] leading-tight">
            {relaunching ? '正在重启...' : '重启以更新'}
          </div>
          <div className="text-xs text-[var(--text-3)] leading-tight mt-0.5">
            v{version}
          </div>
        </div>
        <ArrowRight size={16} className="text-[var(--text-3)] group-hover:text-[var(--text)] transition-colors flex-shrink-0"/>
      </button>

      {/* × 关闭: 暂时夹掉 (本次会话不再弹). hover 卡片才显示, 不抢戏 */}
      <button
        onClick={(e) => { e.stopPropagation(); setDismissed(true) }}
        className="
          absolute -top-2 -right-2
          w-5 h-5 rounded-full
          bg-[var(--bg-card)] border border-[var(--border)]
          text-[var(--text-3)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)]
          flex items-center justify-center
          opacity-0 group-hover:opacity-100
          transition-opacity cursor-pointer
        "
        aria-label="暂不更新"
        title="暂不更新"
      >
        <X size={11}/>
      </button>
    </div>
  )
}
