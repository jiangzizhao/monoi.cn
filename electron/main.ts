// monoi Electron 主进程 — 加载 monoi-cn.vercel.app, 跟网页同源 + 共享 localStorage / cookie.
//
// 为啥不打包前端进 .exe?
// - 让网页跟桌面端 0 同步成本 — 推新版上 Vercel, 桌面端用户下次启动就是最新 UI.
// - 客户端只是个"壳" + 本地能力扩展 (Playwright 发布 / ffmpeg 录屏 / 自动更新).
// - 唯一不同: 桌面端 window.monoiDesktop API 暴露给 preload, 网页前端检测后走桌面增强路径.
//
// 后期 (Phase 4 完整版) 加:
// - Playwright Node 集成 (本地 Edge 发布, 用户自己账号)
// - ffmpeg 录屏 (替换浏览器 MediaRecorder)
// - electron-updater + GitHub Releases 自动更新

import { app, BrowserWindow, shell } from 'electron'
import * as path from 'path'

// 单实例锁: 第二次启动会激活已有窗口, 而不是开第二个
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

const MONOI_URL = process.env.MONOI_URL || 'https://monoi.cn'
const isDev = !app.isPackaged

let mainWin: BrowserWindow | null = null

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#0a0a0a',                     // monoi 暗色主题, 防白闪
    autoHideMenuBar: true,                          // 隐藏菜单栏 (File / Edit / View 默认条)
    title: 'monoi 视频创作',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),  // 编译后是 .js
      contextIsolation: true,                       // 安全: 主世界 / 隔离世界分开
      nodeIntegration: false,                       // 不让网页直接用 Node
      sandbox: false,                               // preload 需要 Node API (Playwright 等)
      webSecurity: true,
    },
  })

  // 加载 monoi 网页. dev 时可以 MONOI_URL=http://localhost:5173 测本地
  mainWin.loadURL(MONOI_URL)

  // 新窗口 / target=_blank 等弹外部浏览器, 不在 Electron 内开 (防卡死)
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // dev 模式开 DevTools
  if (isDev) mainWin.webContents.openDevTools({ mode: 'detach' })

  mainWin.on('closed', () => { mainWin = null })
}

// 第二次启动 → 激活已有窗口
app.on('second-instance', () => {
  if (mainWin) {
    if (mainWin.isMinimized()) mainWin.restore()
    mainWin.focus()
  }
})

app.whenReady().then(createWindow)

// macOS 关掉所有窗口不退出 (Dock 还能再点); Windows / Linux 退出
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (mainWin === null) createWindow()
})
