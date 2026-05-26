// monoi Electron Preload — 在 renderer (网页) mount 前跑, 暴露受控 API 到 window.
//
// 设计:
// - window.monoiDesktop = { isDesktop, version, platform, publish(...), detectEdge() }
// - 网页前端 (PublishForm 等) 检测 typeof window.monoiDesktop !== 'undefined' → 走桌面增强路径
// - 不存在 → 网页 fallback (现有 social_publisher.py 代发流程)

import { contextBridge, ipcRenderer } from 'electron'

interface PublishReq {
  platform: 'xhs' | 'douyin'
  video_url: string
  title?: string
  description?: string
  tags?: string[]
  wait_close_timeout?: number
}

interface PublishResult {
  success: boolean
  detail: string
}

interface UpdateReadyPayload {
  version: string
  releaseDate: string | null
}

const api = {
  /** 标志位: 网页前端检测此值判断是否在桌面端运行 */
  isDesktop: true,
  /** 当前桌面端版本 */
  version: process.env.npm_package_version || '0.0.0',
  /** 'win32' | 'darwin' | 'linux' */
  platform: process.platform,

  /** 检测系统 Edge 路径 (null = 没装) */
  detectEdge: async (): Promise<{ path: string | null }> =>
    ipcRenderer.invoke('detect-edge'),

  /** 调本地 Edge 发布到平台. 同步阻塞: 主进程跑 Playwright, renderer 转圈等 */
  publish: async (req: PublishReq): Promise<PublishResult> =>
    ipcRenderer.invoke('publish', req),

  // ============ 自动更新 ============
  // 主进程 update-downloaded 触发后, 通过 send 'updater:update-ready' 通知 renderer.
  // 网页端 (UpdateAvailableCard 组件) 调 onUpdateReady 订阅, 拿到 version 后浮卡片.
  // 点卡片 → relaunchToUpdate() → 主进程 autoUpdater.quitAndInstall().

  /** 订阅"新版本已下载完成"事件. 返回取消订阅的函数. */
  onUpdateReady: (cb: (payload: UpdateReadyPayload) => void): (() => void) => {
    const listener = (_e: unknown, payload: UpdateReadyPayload) => cb(payload)
    ipcRenderer.on('updater:update-ready', listener)
    return () => ipcRenderer.removeListener('updater:update-ready', listener)
  },

  /** 用户点了"立即重启更新", 关 app + 替换 .exe + 启动新版 */
  relaunchToUpdate: async (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('updater:relaunch-to-update'),
}

contextBridge.exposeInMainWorld('monoiDesktop', api)
