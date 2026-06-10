// monoi Electron 主进程 — 加载 monoi.cn, 跟网页同源 + 共享 localStorage / cookie.
//
// 为啥不打包前端进 .exe?
// - 让网页跟桌面端 0 同步成本 — 推新版上 Vercel, 桌面端用户下次启动就是最新 UI.
// - 客户端只是个"壳" + 本地能力扩展 (Playwright 发布 / ffmpeg 录屏 / 自动更新).
// - 唯一不同: 桌面端 window.monoiDesktop API 暴露给 preload, 网页前端检测后走桌面增强路径.
//
// 已集成 (Phase 4-2/3):
// - Playwright + 本地 Edge 发布 (用户自己账号, 不再代发 admin) — electron/publish.ts
// - electron-updater 自动更新 (GitHub Releases) — electron/updater.ts
// 后期 (Phase 4 高级版):
// - ffmpeg 抓屏录屏 (替换浏览器 MediaRecorder, 不限时长 + 鼠标 zoom)

import { app, BrowserWindow, shell, ipcMain, desktopCapturer, screen } from 'electron'
import * as path from 'path'
import { publish, detectEdgePath, type PublishReq } from './publish'
import { initAutoUpdater, setUpdaterWindow } from './updater'

// 全局鼠标钩子 (录屏「点哪自动放大」用) — 原生模块, 加载失败不致命, 只是该特性不可用.
let uIOhook: { on: (ev: string, cb: (e: unknown) => void) => void; start: () => void; stop: () => void } | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  uIOhook = require('uiohook-napi').uIOhook
} catch (err) {
  console.warn('[click-zoom] uiohook-napi 未安装/加载失败, 录屏点哪放大不可用:', err)
}

// 单实例锁: 第二次启动会激活已有窗口, 而不是开第二个
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

// 加载 monoi.cn (已全量迁阿里云: CDN+OSS 前端 + api.monoi.cn 后端).
// Vercel 已退役, vercel.app 域名国内被墙, 不要再用. 可用 MONOI_URL 环境变量覆盖.
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
    // 不显式设 icon — Windows 上 electron-builder 把 win.icon 嵌入 .exe,
    // BrowserWindow / 任务栏 / Alt-Tab 自动从 .exe metadata 读取, 不用代码层指定.
    // dev 模式没图标 (是 Electron 默认), 打包后才是 monoi 图标 — 正常.
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),  // 编译后是 .js
      contextIsolation: true,                       // 安全: 主世界 / 隔离世界分开
      nodeIntegration: false,                       // 不让网页直接用 Node
      sandbox: false,                               // preload 需要 Node API (Playwright 等)
      webSecurity: true,
      backgroundThrottling: false,                  // 🔴 录屏关键: 窗口切到后台时不节流渲染/计时器,
                                                    // 否则用户切去操作别的窗口演示时, 录的合成画面会卡住/停住.
    },
  })

  // 放行摄像头 / 麦克风 / 屏幕等权限 — monoi 是自家应用. 不设的话 electron 默认拒 getUserMedia,
  // 表现为"摄像头用不了 / 点哪个都没反应"(浏览器会弹授权框, electron 不弹). 全放行.
  const sess = mainWin.webContents.session
  sess.setPermissionRequestHandler((_wc: unknown, _perm: string, cb: (granted: boolean) => void) => cb(true))
  sess.setPermissionCheckHandler(() => true)

  // 加载 monoi 网页. 先清 HTTP 缓存再加载 — 防网络抖动时 electron 退回很旧的缓存网页
  // (旧缓存里 API 地址是已废弃的 nat100 → 登录 Failed to fetch). clearCache 只清缓存的 JS/HTML,
  // 不动 localStorage, 登录态不丢. dev 时可 MONOI_URL=http://localhost:5173 测本地.
  sess.clearCache().catch(() => { /* 清不掉也继续 */ }).finally(() => {
    // 每次启动给生产站加个变化的 _t 参数, 强制拉最新 index.html → 最新 JS bundle.
    // (光 clearCache 有时不够, 这样彻底解决"网页部署了新版但桌面端还显示旧版"). dev/localhost 不动, 不破坏 HMR.
    const url = MONOI_URL.includes('localhost')
      ? MONOI_URL
      : MONOI_URL + (MONOI_URL.includes('?') ? '&' : '?') + '_t=' + Date.now()
    mainWin?.loadURL(url)
  })

  // 录屏不再自动抓整屏 (会把 monoi 自己也录进去=套娃). 改成网页弹自定义"选窗口"面板:
  // 网页调 desktop:list-sources 拿到窗口/屏幕缩略图列表, 用户选一个, 再用 getUserMedia(chromeMediaSourceId) 只录那个.

  // 新窗口 / target=_blank 等弹外部浏览器, 不在 Electron 内开 (防卡死)
  mainWin.webContents.setWindowOpenHandler((details: { url: string }) => {
    shell.openExternal(details.url)
    return { action: 'deny' as const }
  })

  // 开 DevTools 仅在显式要 debug 时 (env OPEN_DEVTOOLS=1). 默认不开, 即使 dev 也清爽.
  // 想看随时 F12 / Ctrl+Shift+I 打开.
  if (process.env.OPEN_DEVTOOLS === '1') {
    mainWin.webContents.openDevTools({ mode: 'detach' })
  }

  mainWin.on('closed', () => { mainWin = null; setUpdaterWindow(null) })
  // 注册到 updater (它弹窗会用这个 window 作 parent)
  setUpdaterWindow(mainWin)
}

// 第二次启动 → 激活已有窗口
app.on('second-instance', () => {
  if (mainWin) {
    if (mainWin.isMinimized()) mainWin.restore()
    mainWin.focus()
  }
})

// ============== IPC handlers (renderer → main) ==============

// 录屏"选窗口"面板: 列出可录的窗口 + 屏幕 (带缩略图). 过滤掉 monoi 自己的窗口防套娃.
ipcMain.handle('list-screen-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: false,
    })
    // 只排掉 monoi 桌面端自己那个窗口 (录它=套娃); 浏览器/网页/其它 App 都能选.
    // (之前按名字含 monoi 过滤太狠, 把开着 monoi.cn 的浏览器也滤掉了 → 选不到网页)
    const self = (mainWin?.getTitle() || '').trim()
    return sources
      .filter((s) => {
        const n = (s.name || '').trim()
        return n !== self && n !== 'monoi 视频创作'   // 这俩是 monoi 自己的窗口标题
      })
      .map((s) => ({
        id: s.id,
        name: s.name,
        isScreen: s.id.startsWith('screen:'),
        thumbnail: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL(),
      }))
  } catch (err) {
    console.warn('[record] list-screen-sources 失败:', err)
    return []
  }
})

ipcMain.handle('detect-edge', () => {
  return { path: detectEdgePath() }
})

ipcMain.handle('publish', async (_event: unknown, req: PublishReq) => {
  return await publish(req)
})

// 全局监听鼠标按下 → 取光标在所在屏幕的比例坐标 → 发给网页 (录屏点哪放大哪).
// 用 screen.getCursorScreenPoint() (DIP 逻辑坐标) 而非 uiohook 原始坐标, 避开多屏/缩放坐标系问题.
let clickHookStarted = false
function startClickZoomHook() {
  if (!uIOhook || clickHookStarted) return
  try {
    uIOhook.on('mousedown', () => {
      if (!mainWin || mainWin.isDestroyed()) return
      try {
        const pt = screen.getCursorScreenPoint()
        const disp = screen.getDisplayNearestPoint(pt)
        const b = disp.bounds
        const xPct = b.width ? (pt.x - b.x) / b.width : 0.5
        const yPct = b.height ? (pt.y - b.y) / b.height : 0.5
        mainWin.webContents.send('desktop:screen-click', { xPct, yPct })
      } catch { /* 取坐标失败忽略这次点击 */ }
    })
    uIOhook.start()
    clickHookStarted = true
  } catch (err) {
    console.warn('[click-zoom] uiohook 启动失败:', err)
  }
}

app.whenReady().then(() => {
  createWindow()
  // 启动自动更新检查 (5 秒后后台跑, 不阻塞)
  initAutoUpdater()
  // 启动鼠标钩子 (点哪放大用); 没装 uiohook 就静默跳过
  startClickZoomHook()
})

app.on('will-quit', () => {
  try { if (clickHookStarted && uIOhook) uIOhook.stop() } catch { /* noop */ }
})

// macOS 关掉所有窗口不退出 (Dock 还能再点); Windows / Linux 退出
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (mainWin === null) createWindow()
})
