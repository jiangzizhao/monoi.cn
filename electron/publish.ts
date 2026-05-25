// monoi Electron 发布模块 — Playwright + 本地 Edge 驱动小红书/抖音发布.
//
// 跟 windows-server/social_publisher.py 同套逻辑, 只是从 admin 后端搬到用户桌面端,
// 这样用户用自己 Edge profile (= 自己已登的小红书/抖音账号), 不再"代发到 admin 账号".
//
// 关键决策:
// - 用户独立 profile 目录 (app.getPath('userData')/edge-profile), 跟用户日常 Edge 隔离,
//   不会污染他们正常浏览, 也避免日常 Edge 开着时 profile 锁冲突.
// - 第一次发布: 弹出 Edge 后会跳登录页, 用户手动登录一次, cookie 持久.
// - 后续发布: cookie 还在, 直接进上传页, 自动填表单, 停在"发布"按钮前等用户确认.

import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import * as https from 'https'
import * as http from 'http'

// playwright-core: 用系统 Edge, 不打包浏览器二进制 (~150MB 节省)
import { chromium } from 'playwright-core'
import type { BrowserContext } from 'playwright-core'

const PLATFORM_URLS: Record<string, string> = {
  xhs: 'https://creator.xiaohongshu.com/publish/publish?source=official',
  douyin: 'https://creator.douyin.com/creator-micro/content/upload',
}

/** Edge 用户数据目录 — 跟用户日常 Edge 隔离 */
function getEdgeProfileDir(): string {
  return path.join(app.getPath('userData'), 'edge-profile')
}

/** 检测系统 Edge 可执行文件路径 (Windows / macOS) */
export function detectEdgePath(): string | null {
  const platform = process.platform
  const candidates: string[] = []
  if (platform === 'win32') {
    candidates.push(
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    )
  } else if (platform === 'darwin') {
    candidates.push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge')
  } else {
    candidates.push('/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable')
  }
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p
    } catch { /* ignore */ }
  }
  return null
}

/** 启动 Edge persistent context (复用 user_data_dir) */
async function launchEdgePersistent(headless = false): Promise<BrowserContext> {
  const profileDir = getEdgeProfileDir()
  fs.mkdirSync(profileDir, { recursive: true })

  const edgePath = detectEdgePath()
  // 优先用系统 Edge (channel=msedge 自动找). 找不到回退到 chromium.
  const launchOpts: Parameters<typeof chromium.launchPersistentContext>[1] = {
    headless,
    viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],   // 反 webdriver 检测
  }
  if (edgePath) {
    launchOpts.executablePath = edgePath
  } else {
    launchOpts.channel = 'msedge'   // playwright-core 自己找
  }

  return await chromium.launchPersistentContext(profileDir, launchOpts)
}

// ============== 拟人化工具 ==============

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min) + min)
const randSleep = (minMs = 600, maxMs = 1800) => sleep(randInt(minMs, maxMs))

async function humanType(locator: any, text: string) {
  await locator.click()
  await sleep(randInt(100, 300))
  for (const ch of text) {
    await locator.type(ch, { delay: randInt(30, 90) })
  }
}

async function mouseJitter(page: any, n = 2) {
  const vp = page.viewportSize() || { width: 1440, height: 900 }
  for (let i = 0; i < n; i++) {
    const x = randInt(100, vp.width - 100)
    const y = randInt(100, vp.height - 100)
    await page.mouse.move(x, y, { steps: randInt(10, 25) })
    await sleep(randInt(200, 600))
  }
}

// ============== 视频下载 (从 URL 下到 OS 临时目录) ==============

async function downloadToTemp(videoUrl: string): Promise<string> {
  const ext = path.extname(new URL(videoUrl).pathname).split('?')[0] || '.mp4'
  const tmpPath = path.join(os.tmpdir(), `monoi-publish-${Date.now()}${ext}`)
  const lib = videoUrl.startsWith('https:') ? https : http
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(tmpPath)
    lib.get(videoUrl, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // 跟 redirect
        downloadToTemp(res.headers.location).then(resolve).catch(reject)
        return
      }
      if (res.statusCode !== 200) {
        reject(new Error(`下载失败 HTTP ${res.statusCode}`))
        return
      }
      res.pipe(file)
      file.on('finish', () => { file.close(); resolve(tmpPath) })
      file.on('error', reject)
    }).on('error', reject)
  })
}

// ============== 发布到 XHS (小红书) ==============

export interface PublishReq {
  platform: 'xhs' | 'douyin'
  video_url: string          // OSS 签好的 URL, 主进程下载后用 Playwright 上传
  title?: string
  description?: string
  tags?: string[]            // ['美食', '探店'] → 自动 # 化
  wait_close_timeout?: number   // 等用户操作的最长秒数 (默认 30 分钟)
}

export interface PublishResult {
  success: boolean
  detail: string
}

export async function publishToXhs(req: PublishReq): Promise<PublishResult> {
  const detailMsgs: string[] = []
  const step = (msg: string) => { console.log(`[publish_xhs] ${msg}`); detailMsgs.push(msg) }
  const waitTimeout = (req.wait_close_timeout || 1800) * 1000

  if (!detectEdgePath()) {
    return { success: false, detail: '没装 Edge. 请先装 Microsoft Edge (Windows 一般自带)' }
  }

  // 1. 下载视频到本地
  let videoPath: string
  try {
    step('从 OSS 下载视频...')
    videoPath = await downloadToTemp(req.video_url)
    const sizeMb = (fs.statSync(videoPath).size / 1024 / 1024).toFixed(1)
    step(`视频已下载 (${sizeMb} MB): ${videoPath}`)
  } catch (e: any) {
    return { success: false, detail: `视频下载失败: ${e?.message || e}` }
  }

  // 2. 启动 Edge persistent context
  let context: BrowserContext | null = null
  try {
    step('启动 Edge (用你自己的账号 profile)...')
    context = await launchEdgePersistent(false)
    const page = await context.newPage()

    await page.goto(PLATFORM_URLS.xhs, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(5000)

    if (page.url().toLowerCase().includes('login')) {
      step('✗ 跳到登录页, 你没登小红书. 在弹出的 Edge 里手动登一次, 之后会记住')
      try {
        await page.waitForEvent('close', { timeout: waitTimeout })
      } catch { /* timeout 也算结束 */ }
      return { success: false, detail: detailMsgs.join(' | ') }
    }

    // 3. 喂视频
    step(`上传 ${path.basename(videoPath)}...`)
    const fileInput = page.locator('input.upload-input').first()
    await fileInput.setInputFiles(videoPath)

    // 4. 等表单 (标题框出现, 最多 5 分钟)
    step('等小红书处理视频 (最多 5 分钟)...')
    const titleInput = page.locator('input[placeholder*="标题"]').first()
    let formReady = false
    try {
      await titleInput.waitFor({ state: 'visible', timeout: 300_000 })
      formReady = true
      step('✓ 表单已渲染')
    } catch {
      step('✗ 5 分钟没等到标题框, 视频可能上传失败')
    }

    // 5. 填表 (拟人化)
    if (formReady && req.title) {
      await randSleep(800, 2000)
      await mouseJitter(page)
      await humanType(titleInput, req.title)
      step(`标题已填: ${req.title}`)
    }

    if (formReady && (req.description || (req.tags && req.tags.length > 0))) {
      await randSleep(800, 2000)
      const descEditor = page.locator('div.tiptap.ProseMirror').first()
      if (await descEditor.count() > 0) {
        await descEditor.click()
        await randSleep(300, 700)
        let full = (req.description || '').trim()
        if (req.tags && req.tags.length > 0) {
          if (full) full += '\n'
          full += req.tags.map(t => `#${t.trim()}`).filter(Boolean).join(' ')
        }
        for (const ch of full) {
          if (ch === '\n') {
            await page.keyboard.press('Enter')
            await sleep(randInt(50, 150))
          } else {
            await page.keyboard.type(ch, { delay: randInt(30, 90) })
          }
        }
        step(`描述+标签已填 (${full.length} 字)`)
      } else {
        step('✗ 没找到描述编辑器')
      }
    }

    // 6. 拟人收尾 — 停在发布按钮前, 等用户审稿+点发布+关窗
    if (formReady) {
      await mouseJitter(page, 2)
      await randSleep(1000, 2000)
      step('✓ 已停在发布按钮前. 你在 Edge 窗口审稿 → 点"发布" → 关 Edge 窗口')
    }

    // 7. 等用户操作 (关窗口结束)
    step(`等你操作, 最多 ${Math.floor(waitTimeout / 1000 / 60)} 分钟...`)
    try {
      await page.waitForEvent('close', { timeout: waitTimeout })
      step('Edge 已关, 流程结束')
    } catch {
      step(`超时, 强制关 Edge`)
    }

    return { success: true, detail: detailMsgs.join(' | ') }

  } catch (e: any) {
    step(`!! 异常: ${e?.name || 'Error'}: ${e?.message || e}`)
    return { success: false, detail: detailMsgs.join(' | ') }
  } finally {
    try { await context?.close() } catch { /* ignore */ }
    // 清临时视频
    try { fs.unlinkSync(videoPath) } catch { /* ignore */ }
  }
}

/** 公共入口 — 按 platform 分发 */
export async function publish(req: PublishReq): Promise<PublishResult> {
  if (req.platform === 'xhs') return publishToXhs(req)
  if (req.platform === 'douyin') {
    return { success: false, detail: '抖音桌面发布还没接入 (Phase 4-3 加)' }
  }
  return { success: false, detail: `未知平台: ${req.platform}` }
}
