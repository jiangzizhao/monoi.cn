"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const publish_1 = require("./publish");
// 单实例锁: 第二次启动会激活已有窗口, 而不是开第二个
const gotLock = electron_1.app.requestSingleInstanceLock();
if (!gotLock) {
    electron_1.app.quit();
}
// 默认走 Vercel 直连 (monoi.cn 域名国内 DNS 不一定通).
// 等域名稳定后可改回 monoi.cn, 或用 MONOI_URL 环境变量覆盖.
const MONOI_URL = process.env.MONOI_URL || 'https://monoi-cn.vercel.app';
const isDev = !electron_1.app.isPackaged;
let mainWin = null;
function createWindow() {
    mainWin = new electron_1.BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1024,
        minHeight: 640,
        backgroundColor: '#0a0a0a', // monoi 暗色主题, 防白闪
        autoHideMenuBar: true, // 隐藏菜单栏 (File / Edit / View 默认条)
        title: 'monoi 视频创作',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'), // 编译后是 .js
            contextIsolation: true, // 安全: 主世界 / 隔离世界分开
            nodeIntegration: false, // 不让网页直接用 Node
            sandbox: false, // preload 需要 Node API (Playwright 等)
            webSecurity: true,
        },
    });
    // 加载 monoi 网页. dev 时可以 MONOI_URL=http://localhost:5173 测本地
    mainWin.loadURL(MONOI_URL);
    // 新窗口 / target=_blank 等弹外部浏览器, 不在 Electron 内开 (防卡死)
    mainWin.webContents.setWindowOpenHandler(({ url }) => {
        electron_1.shell.openExternal(url);
        return { action: 'deny' };
    });
    // 开 DevTools 仅在显式要 debug 时 (env OPEN_DEVTOOLS=1). 默认不开, 即使 dev 也清爽.
    // 想看随时 F12 / Ctrl+Shift+I 打开.
    if (process.env.OPEN_DEVTOOLS === '1') {
        mainWin.webContents.openDevTools({ mode: 'detach' });
    }
    mainWin.on('closed', () => { mainWin = null; });
}
// 第二次启动 → 激活已有窗口
electron_1.app.on('second-instance', () => {
    if (mainWin) {
        if (mainWin.isMinimized())
            mainWin.restore();
        mainWin.focus();
    }
});
// ============== IPC handlers (renderer → main) ==============
electron_1.ipcMain.handle('detect-edge', () => {
    return { path: (0, publish_1.detectEdgePath)() };
});
electron_1.ipcMain.handle('publish', async (_event, req) => {
    return await (0, publish_1.publish)(req);
});
electron_1.app.whenReady().then(createWindow);
// macOS 关掉所有窗口不退出 (Dock 还能再点); Windows / Linux 退出
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        electron_1.app.quit();
});
electron_1.app.on('activate', () => {
    if (mainWin === null)
        createWindow();
});
//# sourceMappingURL=main.js.map