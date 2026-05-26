// monoi Electron 自动更新 — electron-updater + monoi 后端代理 (走 OSS)
//
// 工作流:
// 1. 启动 5 秒后后台检查 monoi.cn 的 /api/desktop/update/latest.yml 看是否有新版
// 2. 有新版 → 后台下载 (用户无感知, 不阻塞)
// 3. 下载完 → 网页端右下角弹一个**小卡片** (不弹 native dialog)
//    卡片样式仿 Claude Code: 图标 + "Relaunch to update" + 版本号 + 箭头
// 4. 用户点卡片 → IPC → quitAndInstall → 替换 .exe → 启动新版
//
// 不强制更新, 不打断用户工作.
// dev 模式 (未打包) 跳过, 避免每次开发都报错.

import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'

let mainWindow: BrowserWindow | null = null

export function setUpdaterWindow(win: BrowserWindow | null) {
  mainWindow = win
}

// IPC: renderer 点了卡片上的箭头 → 主进程 quitAndInstall
// 注册一次就够, 不重复注册. 用一个标志位防重.
let relaunchHandlerRegistered = false
function registerRelaunchHandler() {
  if (relaunchHandlerRegistered) return
  relaunchHandlerRegistered = true
  ipcMain.handle('updater:relaunch-to-update', () => {
    try {
      // quitAndInstall: 关 app + 替换 .exe + 启动新版
      autoUpdater.quitAndInstall()
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })
}

export function initAutoUpdater() {
  // dev 模式 (没打包) 跳过 — autoUpdater 在 dev 会读不到 app-update.yml 报错
  if (!app.isPackaged) {
    console.log('[updater] dev 模式, 跳过自动更新检查')
    return
  }

  registerRelaunchHandler()

  // 静默自动下载 (用户无感知)
  autoUpdater.autoDownload = true
  // 退出时自动安装 (用户重启时生效)
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    console.log('[updater] 检查更新...')
  })

  autoUpdater.on('update-available', (info) => {
    console.log(`[updater] 发现新版本 ${info.version}, 后台下载中`)
  })

  autoUpdater.on('update-not-available', () => {
    console.log('[updater] 已是最新版')
  })

  autoUpdater.on('error', (err) => {
    console.warn('[updater] 更新出错 (忽略):', err?.message || err)
    // 不弹错给用户 — 网络不好 / 源站不通是常态, 别打扰
  })

  autoUpdater.on('download-progress', (progress) => {
    const pct = Math.round(progress.percent)
    console.log(`[updater] 下载中 ${pct}% (${(progress.bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s)`)
  })

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[updater] 新版本 ${info.version} 已下载, 等用户点卡片`)
    // 发给 renderer, 让网页端右下角浮卡片
    // 不再用 dialog.showMessageBox — 不打断, 让用户随时点
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:update-ready', {
        version: info.version,
        releaseDate: info.releaseDate || null,
        // 不发 releaseNotes — 一般是 markdown, 渲染麻烦, 而且大多没填
      })
    }
  })

  // 启动后 5 秒检查 (给应用初始化时间, 也避免阻塞冷启动)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((e) => {
      console.warn('[updater] check 失败 (忽略):', e?.message || e)
    })
  }, 5000)
}
