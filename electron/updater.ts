// monoi Electron 自动更新 — electron-updater + GitHub Releases
//
// 工作流:
// 1. 启动 5 秒后后台检查 GitHub Releases 是否有新版本
// 2. 有新版 → 后台下载 (用户无感知, 不阻塞)
// 3. 下载完 → 弹通知 "新版本已下载, 重启即可更新"
// 4. 用户下次重启 / 立刻点重启 → 自动替换 .exe → 启动新版
//
// 不强制更新 (skipFlag 让用户选), 不打断用户工作.
// dev 模式 (未打包) 跳过, 避免每次开发都报错.

import { app, BrowserWindow, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'

let mainWindow: BrowserWindow | null = null

export function setUpdaterWindow(win: BrowserWindow | null) {
  mainWindow = win
}

export function initAutoUpdater() {
  // dev 模式 (没打包) 跳过 — autoUpdater 在 dev 会读不到 app-update.yml 报错
  if (!app.isPackaged) {
    console.log('[updater] dev 模式, 跳过自动更新检查')
    return
  }

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
    // 不弹错给用户 — 网络不好 / GitHub 不通是常态, 别打扰
  })

  autoUpdater.on('download-progress', (progress) => {
    const pct = Math.round(progress.percent)
    console.log(`[updater] 下载中 ${pct}% (${(progress.bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s)`)
  })

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[updater] 新版本 ${info.version} 已下载, 等用户重启`)
    // 弹通知 (非阻塞)
    if (mainWindow) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'monoi 有新版本',
        message: `新版本 ${info.version} 已下载完成`,
        detail: '点 "立刻重启" 自动更新, 或继续用当前版本下次启动时更新.',
        buttons: ['立刻重启', '稍后再说'],
        defaultId: 0,
        cancelId: 1,
      }).then((result) => {
        if (result.response === 0) {
          // quitAndInstall: 关 app + 替换 .exe + 启动新版
          autoUpdater.quitAndInstall()
        }
      }).catch(() => { /* dialog 出错忽略 */ })
    }
  })

  // 启动后 5 秒检查 (给应用初始化时间, 也避免阻塞冷启动)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((e) => {
      console.warn('[updater] check 失败 (忽略):', e?.message || e)
    })
  }, 5000)
}
