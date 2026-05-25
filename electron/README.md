# monoi 桌面端 (Electron)

把 `monoi.cn` 网页套个 Electron 壳, 给 Windows 用户一个**可装的 .exe**.

## 为什么要桌面端

网页有 2 个绕不过的痛点:

1. **自动发布到平台 (小红书/抖音 等) 现在是代发到 admin 账号**
   - 实质: 后端 `social_publisher.py` 用 Playwright 跑在 admin 那台 Windows, 共享一个 Edge profile
   - 所有用户发的视频都用 admin 的账号 → 这是临时方案, 不是产品
   - **桌面版解决方案**: Electron 主进程跑 Playwright + 调**用户本地 Edge**, 用用户自己账号发

2. **录屏受浏览器限制** (本阶段先不做, 后期加)
   - MediaRecorder 编码慢, 30 分钟容易 OOM
   - 拿不到鼠标全屏坐标 → 没法做"鼠标跟踪 zoom" (Loom 那种)

## 当前阶段 (Phase 4-1: 脚手架)

✅ Electron 壳, `loadURL('https://monoi.cn')` (跟网页同源, 共享 localStorage/cookie)
✅ Preload bridge 占位 (`window.monoiDesktop = { version, platform, isDesktop: true }`)
✅ electron-builder 打 Windows .exe (NSIS installer, 不签名)
❌ Playwright 集成 (下个阶段)
❌ 本地 Edge 检测 (下个阶段)
❌ PublishForm 桌面分支 (下个阶段)
❌ ffmpeg 录屏 / 鼠标 zoom (后期)
❌ electron-updater 自动更新 (后期)

## 本地跑

```bash
# 1. 装依赖 (第一次需要)
npm install

# 2. 编译 Electron main/preload + 启动 (加载线上 monoi.cn)
npm run dev:electron

# 3. 或加载本地 dev 网页 (先 npm run dev 起 vite 5173)
npm run dev:electron:local
```

## 打 Windows .exe

```bash
# 必须在 Windows 机器跑 (electron-builder cross-build 不稳, NSIS 需要 Windows)
npm run pack:win

# 输出: release/monoi-Setup-0.1.0.exe
```

## Windows SmartScreen 警告

第一次用户双击装的时候, Windows 会弹蓝色警告:

> Windows protected your PC — Microsoft Defender SmartScreen prevented an unrecognized app from starting.

**用户操作**: 点 "More info" (更多信息) → "Run anyway" (仍要运行).

原因: 没买代码签名证书 (DigiCert ¥1500/年). 等用户量 100+ 再说.

教程图 (待加): `electron/docs/smartscreen-tutorial.png`

## 架构

```
┌─────────────────────────────────┐
│  Renderer (BrowserWindow)        │
│  → 加载 monoi.cn (跟网页完全一样)  │
│  ↓ 通过 window.monoiDesktop       │
└──────────┬──────────────────────┘
           │ (preload bridge)
           ↓
┌─────────────────────────────────┐
│  Main Process (Node)             │
│  - Playwright (本地 Edge 发布)   │
│  - ffmpeg (录屏, 后期)            │
│  - electron-updater (自动更新)    │
└─────────────────────────────────┘
```

**关键**: renderer 不打包前端代码进 .exe — 用 `loadURL` 拉 monoi.cn. 推新版上 Vercel, 桌面端用户**下次启动就是最新 UI**, 0 同步成本.

## 下一步 (Phase 4-2)

1. `npm i playwright` (Node 版, 不是 Python)
2. 主进程加 `ipcMain.handle('publish', ...)` — 接 PublishForm 调用
3. Preload 暴露 `window.monoiDesktop.publish(req)` → `ipcRenderer.invoke('publish', req)`
4. 检测本地 Edge: Windows `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`, 或 registry `HKLM\SOFTWARE\Microsoft\Edge\BLBeacon`
5. `src/components/chat/forms/PublishForm.tsx` 改: `if (window.monoiDesktop)` 走桌面流程, 否则调 `/api/publish/start` (现有代发)
6. 用户首次启动桌面发布 → 弹引导: "请在弹出的 Edge 里登录小红书/抖音账号, 之后就不用再登"

## 风险记录

- **Playwright 包大 (~150MB)**: 用户首次启动要下载 browser binary (走代理? 还是打包进 .exe?). 决策待定.
- **不打包前端的依赖**: monoi.cn 挂了桌面端就废 — 需要在 main.ts 加 fallback 提示 "网络问题, 稍后再试".
- **Edge profile 冲突**: 用户日常 Edge 跟 Playwright 起的 Edge 用同一 profile → 可能互相干扰. 解决: Playwright 启动时复用 user-data-dir 但跑 headless: false, 让用户能看到.
