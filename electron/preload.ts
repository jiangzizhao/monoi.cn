// monoi Electron Preload — 在 renderer (网页) mount 前跑, 暴露受控 API 到 window.
//
// 设计:
// - window.monoiDesktop = { version, platform, publish(...), detectEdge(), ... }
// - 网页前端 (PublishForm 等) 检测 typeof window.monoiDesktop !== 'undefined' → 走桌面增强路径
// - 不存在 → 网页 fallback (现有 social_publisher.py 代发流程)
//
// 当前阶段: 只暴露 version + platform, 后期加 publish / record / update 等

import { contextBridge, ipcRenderer } from 'electron'

const api = {
  /** 当前桌面端版本 (从 package.json 注入) */
  version: process.env.npm_package_version || '0.0.0',
  /** 'win32' | 'darwin' | 'linux' */
  platform: process.platform,
  /** Phase 4 阶段一: 仅暴露版本信息, 让网页能识别"在桌面端运行" */
  isDesktop: true,

  // TODO Phase 4-2 阶段加:
  // publish: (req: PublishReq) => ipcRenderer.invoke('publish', req),
  // detectEdge: () => ipcRenderer.invoke('detect-edge'),
  // recordStart / recordStop: ffmpeg 抓屏接口
  // checkUpdate / installUpdate: electron-updater 接口
}

contextBridge.exposeInMainWorld('monoiDesktop', api)

// 占位: 防止 unused import 警告 (Phase 4-2 加 invoke 之后会用上)
void ipcRenderer
