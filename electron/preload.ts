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

  // TODO Phase 4-3 加:
  // recordStart / recordStop: ffmpeg 抓屏
  // checkUpdate / installUpdate: electron-updater
}

contextBridge.exposeInMainWorld('monoiDesktop', api)
