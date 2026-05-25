# monoi 桌面端 (Electron)

把 `monoi-cn.vercel.app` 网页套个 Electron 壳, 给 Windows 用户**可装的 .exe** + 用本地 Edge 发布 (用户自己账号, 不再代发到 admin 账号).

## 为什么要桌面端

**核心痛点**: 网页 "自动发布" 实际是后端代发到 admin 账号 (`social_publisher.py` 用 admin 那台 Windows 的 Edge profile). 桌面端解决这个 — 用**用户本地 Edge** + Playwright, 用用户自己账号发.

**附加好处**:
- 自动更新 (electron-updater + GitHub Releases)
- 后期可加 ffmpeg 抓屏 (不限时长 / 鼠标 zoom)

## 当前状态 (Phase 4-3 完成)

- ✅ Electron 壳 (loadURL: monoi-cn.vercel.app, 跟网页 0 同步成本)
- ✅ Preload bridge (`window.monoiDesktop.publish / detectEdge / isDesktop / version / platform`)
- ✅ Playwright + 本地 Edge 发布 (小红书 + 抖音)
- ✅ Edge profile 锁清理 + 登录引导文案
- ✅ 抖音 selector 兜底 + 失败截图
- ✅ electron-builder 打 Windows .exe (NSIS installer, unsigned)
- ✅ electron-updater 自动更新 (启动 5 秒后查 GitHub Releases)
- ✅ Vercel 上的 PublishForm 自动检测桌面端 → 走 Electron 发布
- ❌ ffmpeg 抓屏录屏 (后期 Phase 4 高级版)
- ❌ 鼠标跟踪 zoom (后期 Phase 4 高级版)

---

## 本地跑 (开发)

```bash
# 1. clone + 装依赖
git clone https://github.com/jiangzizhao/monoi.cn.git
cd monoi.cn
git checkout phase4-electron

# 2. 装 node 依赖 (国内设镜像快)
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm install

# 3. 跑 (默认加载线上 monoi-cn.vercel.app)
npm run dev:electron

# 4. 或加载本地 dev 网页 (先 npm run dev 起 vite 5173)
npm run dev:electron:local
```

## 打 Windows .exe (给用户分发)

**必须在 Windows 机器上跑** (electron-builder cross-build 不稳, NSIS 必须 Windows):

```cmd
:: 1. 改版本号 (每次发新版必须!)
:: package.json "version": "0.1.0" → "0.2.0"

:: 2. 打包
npm run pack:win

:: 3. 拿到安装包 (~80MB)
:: release\monoi-Setup-0.2.0.exe
:: release\latest.yml             ← electron-updater 用这个查新版
```

## 上传到 GitHub Releases

`electron-updater` 启动时去 `https://github.com/jiangzizhao/monoi.cn/releases/latest` 查 `latest.yml`, 拿到就下载新 .exe.

**上传步骤** (每次发新版):

1. `git tag v0.2.0` (跟 package.json version 一致)
2. `git push --tags`
3. 浏览器开 https://github.com/jiangzizhao/monoi.cn/releases/new
4. **Choose a tag**: 选刚 push 的 `v0.2.0`
5. **Release title**: `v0.2.0` (写啥都行)
6. **Description**: 改动 changelog (1-3 行)
7. **Attach binaries**: 拖 `release\monoi-Setup-0.2.0.exe` + `release\latest.yml` 进去 (**必须两个都传**, electron-updater 要 latest.yml 才能识别)
8. 点 **Publish release**

用户那边: 已装的桌面端启动 5 秒后自动查 → 后台下载 → 弹"新版已下载, 重启更新".

---

## Windows SmartScreen 警告 (用户首次启动)

不签名 (DigiCert 证书 ¥1500/年, 用户量上来再说), 用户首次双击 .exe 会弹蓝色警告:

```
Windows protected your PC — Microsoft Defender SmartScreen prevented
an unrecognized app from starting.
```

**告诉用户**:
1. 点 **More info** (中文 "更多信息")
2. 出现 **Run anyway** (中文 "仍要运行") 按钮 → 点
3. 装好后桌面图标 → 双击启动
4. 之后启动不会再警告

教程图 (待加): `electron/docs/smartscreen.png`

---

## 用户首次启动指南

1. **第一次启动**: 跟网页一样, 注册或登录 monoi 账号
2. **第一次发布**: 点"发布到小红书 / 抖音" → Electron 会弹一个 **Edge 窗口** (跟你日常 Edge 隔离的独立 profile)
3. **登录小红书 / 抖音**: 在弹出的 Edge 里扫码 / 输手机号登一次
4. **关掉 Edge 窗口** (右上角 X)
5. monoi 提示: "登录已保存. 再点一次发布到小红书 就能直接传视频了"
6. **再点一次发布** → 这次直接进上传 → 自动填表 → 停在"发布"按钮前
7. **审稿 → 点发布 → 关 Edge** → monoi 显示完成

之后所有发布都直接走第 6-7 步, 不再需要登录.

---

## 架构

```
┌─────────────────────────────────┐
│  Renderer (BrowserWindow)        │
│  → loadURL('monoi-cn.vercel.app') │
│  → 推 Vercel = 桌面端自动新版     │
│  ↓ window.monoiDesktop API        │
└──────────┬──────────────────────┘
           │ (preload bridge: contextBridge)
           ↓
┌─────────────────────────────────┐
│  Main Process (Node)             │
│  - publish.ts: Playwright + 本地 Edge │
│  - updater.ts: electron-updater   │
│  - 后期: ffmpeg 录屏              │
└─────────────────────────────────┘
```

**关键**: renderer 不打包前端进 .exe — 推新版上 Vercel, 桌面端用户下次启动就是新版. 0 同步成本.

---

## 文件结构

```
electron/
├── main.ts            ← 主进程入口
├── preload.ts         ← contextBridge 暴露 window.monoiDesktop
├── publish.ts         ← Playwright + 本地 Edge 发布 (xhs / douyin)
├── updater.ts         ← electron-updater 自动更新
├── post-build.mjs     ← dist-electron 加 {"type":"commonjs"}
├── tsconfig.json
└── README.md          ← 本文档

electron-builder.yml   ← 打包配置 (NSIS / publish: github)
package.json           ← scripts: pack:win / dev:electron / build:electron
dist-electron/         ← TypeScript 编译产物 (gitignore)
release/               ← 打包产物 .exe + latest.yml (gitignore)
```

---

## 风险记录

- **playwright-core 包 ~30MB** — 用系统 Edge, 不打包 browser binary
- **electron-updater 不签名时会报警告** — autoUpdater 内部捕获, 不阻塞用户. log 里有 warn 忽略
- **首次 Edge 启动慢** (Playwright 加载 + Edge 冷启动 ~5-15 秒) — UI 显示 "启动本地 Edge..." 用户能感知到在工作
- **Edge profile 冲突** — 我们用独立 profile dir, 跟用户日常 Edge 不冲突. 启动前主动清 SingletonLock
- **monoi-cn.vercel.app 挂了桌面端就废** — 后期加 fallback 离线提示
