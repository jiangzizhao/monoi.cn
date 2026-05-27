// 录屏 tab — 布局跟创作 tab 一致: 头部 monoi 头像 + 选项 grid + 底部工具栏 + 大按钮.
// 用户授权摄像头 + 屏幕后进 preview, 显示 canvas + PIP 设置 + 录制控制.
//
// 浏览器原生 getDisplayMedia + getUserMedia + Canvas 混合.
// 输出 webm. iOS Safari 不支持 (显示提示).

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, Monitor, Mic, Square, Download, AlertCircle, RotateCcw, Settings, Video, Scissors, Music, X as XIcon } from 'lucide-react'
import type Konva from 'konva'
import { WhiteboardEditor } from '../components/whiteboard/WhiteboardEditor'
import { Logo } from '../components/Logo'
import { useChatStore, makeAssistantMsg } from '../store/chatStore'
// 转 mp4 走 OSS 临时上传 (5 分钟后让 lifecycle 清, 成本可忽略)
// 录屏本身不再持久化到 OSS — 免费功能, 长期存储成本爆炸 (见 5/25 开发日志)
// 用户必须当场决策: 进剪辑 / 下载 / 重录, 不能刷新走开.
import { uploadBlobToOss, transcodeRecordingToMp4 } from '../services/recordings'
import { listBgmLibrary, type BgmTrack } from '../services/audio'
import { fetchMyProfile, fetchMySubscription } from '../services/billing'
import { isLoggedIn } from '../lib/auth'

type Phase = 'setup' | 'previewing' | 'recording' | 'done'
type PipShape = 'circle' | 'rounded' | 'square'
type PipPos = 'tl' | 'tc' | 'tr' | 'cl' | 'cc' | 'cr' | 'bl' | 'bc' | 'br'
type OutputRatio = '16:9' | '9:16' | '1:1' | '3:4'

// 录屏单次时长上限: 免费策略 2 分钟. 防资源滥用, Pro 用户同样 2 分钟 (这是单次, 不是当日).
// 超过浏览器可能 OOM / blob 过大上传炸. 2 分钟覆盖"快速 demo / 录指令"等主流轻量场景.
const MAX_RECORD_SECONDS = 2 * 60
// 临近上限提示阈值: 还剩 20s 时橙色倒计时 (2 分钟尺度下 5 分钟阈值无意义)
const WARN_SECONDS_LEFT = 20

// 每日录屏次数: 免费 5, Pro 30. localStorage 计数, 用户清缓存能 bypass (但 UX 上有限制感).
// 真正花钱的"转 mp4" 在后端 SQLite 强校验, 这层只是 UX + 提示用户升级 Pro.
const DAILY_RECORD_LIMIT_FREE = 5
const DAILY_RECORD_LIMIT_PRO = 30
const todayKey = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const getRecordCountKey = (userId: number | string) => `monoi_record_count_${userId}_${todayKey()}`
function readRecordCount(userId: number | string): number {
  try { return Number(localStorage.getItem(getRecordCountKey(userId)) || '0') || 0 } catch { return 0 }
}
function incRecordCount(userId: number | string) {
  try { localStorage.setItem(getRecordCountKey(userId), String(readRecordCount(userId) + 1)) } catch { /* localStorage 不可用 */ }
}
type BgMode = 'screen' | 'whiteboard' | 'camera_only'

// 输出像素尺寸 (高度 1080 基准, 各比例都给具体宽高)
const RATIO_SIZE: Record<OutputRatio, { w: number; h: number; label: string }> = {
  '16:9': { w: 1920, h: 1080, label: '横屏 16:9' },
  '9:16': { w: 1080, h: 1920, label: '竖屏 9:16' },
  '1:1':  { w: 1080, h: 1080, label: '方形 1:1' },
  '3:4':  { w: 1080, h: 1440, label: '3:4' },
}

const RECORD_PRESETS = [
  { id: 'screen_camera',     label: '屏幕 + 人物 PIP',  desc: '录 PPT/Word/代码 等 + 人物 PIP. 选屏幕时一定选 PPT 类窗口, 不要选浏览器' },
  { id: 'whiteboard_camera', label: '白板 + 人物 PIP',  desc: '纯白背景 + 摄像头叠加. 解说没现成 PPT 时用 (推荐)' },
  { id: 'screen_only',       label: '仅屏幕',          desc: '只录屏幕, 无人物. 选窗口时不能选浏览器' },
  { id: 'camera_only',       label: '仅摄像头',        desc: '只录自己, 没屏幕 (vlog)' },
]

export default function RecordTab() {
  const navigate = useNavigate()
  const [phase, setPhase] = useState<Phase>('setup')
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null)
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null)
  const [bgMode, setBgMode] = useState<BgMode>('screen')   // 背景模式: 屏幕 / 白板 / 仅摄像头
  const [outputRatio, setOutputRatio] = useState<OutputRatio>('16:9')
  const [pipShape, setPipShape] = useState<PipShape>('circle')
  const [pipPos, setPipPos] = useState<PipPos>('br')
  const [pipSize, setPipSize] = useState(25)
  const [showPipSettings, setShowPipSettings] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [recordedUrl, setRecordedUrl] = useState<string>('')
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [error, setError] = useState('')
  // 跨设备摄像头管理: enumerateDevices 列出所有 videoinput, 让用户能切换
  // (寻影 / iPhone Continuity / USB 外接 / Mac 内置 都在这个列表里)
  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([])
  const [selectedCameraId, setSelectedCameraId] = useState<string>('')
  // 麦克风也同理 (USB 铁三角 / OBSBOT / 内置). 默认非虚拟实体优先
  const [availableMics, setAvailableMics] = useState<MediaDeviceInfo[]>([])
  const [selectedMicId, setSelectedMicId] = useState<string>('')
  // 转 mp4 时的上传/转码状态 (录屏本身不上 OSS)
  const [uploadPct, setUploadPct] = useState(0)
  const [busy, setBusy] = useState<'idle' | 'uploading' | 'transcoding'>('idle')
  // BGM: 用户在录制时混入背景音乐 (用 monoi 现有 BGM 库)
  const [bgmList, setBgmList] = useState<BgmTrack[]>([])
  const [selectedBgm, setSelectedBgm] = useState<BgmTrack | null>(null)
  const [bgmVolume, setBgmVolume] = useState(0.3)            // 0-1, 默认 30% (mic 60-70% 占主导)
  const [showBgmPanel, setShowBgmPanel] = useState(false)

  // 每日录屏次数限制 — 免费 5, Pro 30. 用户 id + tier 从 /api/me + /api/billing/subscription 拿
  // (uid 用来作 localStorage key 区分用户; tier 决定额度)
  const [userId, setUserId] = useState<number | null>(null)
  const [isPro, setIsPro] = useState(false)
  const [recordCountToday, setRecordCountToday] = useState(0)
  const dailyLimit = isPro ? DAILY_RECORD_LIMIT_PRO : DAILY_RECORD_LIMIT_FREE
  const remainingRecords = Math.max(0, dailyLimit - recordCountToday)
  const quotaExhausted = remainingRecords === 0
  // BGM 播放 + 合流到录制流的 ref
  const bgmAudioElRef = useRef<HTMLAudioElement | null>(null)   // preview 阶段的预览播放
  const bgmContextRef = useRef<AudioContext | null>(null)
  const bgmSourceNodeRef = useRef<AudioNode | null>(null)        // BGM source (用于停止)
  const bgmGainNodeRef = useRef<GainNode | null>(null)            // BGM 音量调节

  const screenVideoRef = useRef<HTMLVideoElement | null>(null)
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  // 白板模式: Konva stage ref, canvas loop 里画到主 canvas
  const whiteboardStageRef = useRef<Konva.Stage | null>(null)

  const isUnsupported = typeof navigator !== 'undefined'
    && !(navigator.mediaDevices?.getDisplayMedia)

  // 初始化: 拿 uid + tier, 然后读 localStorage 当日录屏次数
  useEffect(() => {
    if (!isLoggedIn()) return
    let alive = true
    ;(async () => {
      try {
        const [me, sub] = await Promise.all([fetchMyProfile(), fetchMySubscription().catch(() => null)])
        if (!alive) return
        setUserId(me.id)
        // tier: 'pro_monthly' / 'max_monthly' / 'flagship_yearly' 都算 Pro 用户 (Pro 及以上)
        const tier = (sub as any)?.tier || 'free'
        setIsPro(tier !== 'free')
        setRecordCountToday(readRecordCount(me.id))
      } catch { /* 拿不到 me 时降级到 free 配额, uid=0 (匿名 key) */ }
    })()
    return () => { alive = false }
  }, [])

  // streams → off-screen videos
  useEffect(() => {
    if (screenStream && screenVideoRef.current) {
      screenVideoRef.current.srcObject = screenStream
      screenVideoRef.current.play().catch(() => {})
    }
  }, [screenStream])
  useEffect(() => {
    if (cameraStream && cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = cameraStream
      cameraVideoRef.current.play().catch(() => {})
    }
  }, [cameraStream])

  // 监听屏幕用户主动停止
  useEffect(() => {
    if (!screenStream) return
    const tracks = screenStream.getVideoTracks()
    const onEnd = () => {
      setScreenStream(null)
      if (phase === 'recording') stopRecording()
      setPhase('setup')
    }
    tracks.forEach(t => t.addEventListener('ended', onEnd))
    return () => tracks.forEach(t => t.removeEventListener('ended', onEnd))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenStream])

  // canvas composit 循环 — 输出尺寸固定为 RATIO_SIZE[outputRatio], 背景 contain 进画布
  useEffect(() => {
    if (phase !== 'previewing' && phase !== 'recording') return
    if (!canvasRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // 固定输出尺寸 (跟用户选的比例对齐, 不跟屏幕走)
    const target = RATIO_SIZE[outputRatio]
    if (canvas.width !== target.w) canvas.width = target.w
    if (canvas.height !== target.h) canvas.height = target.h

    const draw = () => {
      const screenV = screenVideoRef.current
      const cameraV = cameraVideoRef.current

      // 1. 画背景 (3 种模式)
      if (bgMode === 'whiteboard') {
        // 白板: Konva stage 渲染的画面 (text/image 元素) 画到主 canvas
        ctx.fillStyle = '#FFFFFF'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        const stage = whiteboardStageRef.current
        if (stage) {
          try {
            // toCanvas 返回 HTMLCanvasElement, 直接 drawImage 上去
            const stageCanvas = stage.toCanvas({ pixelRatio: 1 })
            ctx.drawImage(stageCanvas, 0, 0, canvas.width, canvas.height)
          } catch { /* Konva 还没 ready 就用纯白兜底 */ }
        }
      } else if (bgMode === 'camera_only' && cameraV && cameraV.videoWidth > 0) {
        // 仅摄像头: 摄像头铺满整个 canvas (contain 不裁切, 上下/左右黑边)
        ctx.fillStyle = '#000000'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        drawContain(ctx, cameraV, canvas.width, canvas.height)
      } else if (screenV && screenV.videoWidth > 0) {
        // 屏幕: contain 模式 (源 16:9 输出 9:16 时上下黑边, 不裁切丢内容)
        ctx.fillStyle = '#000000'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        drawContain(ctx, screenV, canvas.width, canvas.height)
      } else {
        // 没源时全黑
        ctx.fillStyle = '#000000'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      }

      // 2. PIP 摄像头 (除非已经是"仅摄像头"模式 — 那种情况摄像头本身就是背景, 不再叠 PIP)
      if (bgMode !== 'camera_only' && cameraV && cameraV.videoWidth > 0) {
        drawPip(ctx, canvas, cameraV, pipShape, pipPos, pipSize)
      }

      rafRef.current = requestAnimationFrame(draw)
    }
    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [phase, pipShape, pipPos, pipSize, bgMode, outputRatio])

  useEffect(() => {
    if (phase !== 'recording') { setElapsed(0); return }
    const start = Date.now()
    const id = window.setInterval(() => {
      const e = Math.floor((Date.now() - start) / 1000)
      setElapsed(e)
      // 到上限自动停 (防 OOM / 上传炸). 用户能在 done 阶段重录续上.
      if (e >= MAX_RECORD_SECONDS) {
        setError(`已到 ${Math.floor(MAX_RECORD_SECONDS / 60)} 分钟上限, 自动停止. 想录更长请分段.`)
        stopRecording()
      }
    }, 1000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // ===== 操作 =====

  const requestScreen = async () => {
    setError('')
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true })
      // 检测套娃: 用户选了浏览器自己 → 警告
      const label = s.getVideoTracks()[0]?.label?.toLowerCase() || ''
      if (label.includes('chrome') || label.includes('monoi') || label.includes('vercel') || label.includes('edge') || label.includes('safari')) {
        setError('警告: 你选的是当前浏览器, 录出来画面会无限套娃. 建议点"重选" 改选别的应用窗口 (PPT / 文档 / 笔记 等)')
      }
      setScreenStream(s)
      if (cameraStream || (!cameraStream && phase === 'setup')) setPhase('previewing')
    } catch (e: any) {
      if (e.name === 'NotAllowedError') setError('你拒绝了屏幕共享权限')
      else setError(`获取屏幕失败: ${e.message || e}`)
    }
  }
  /** 枚举 Chrome 看到的所有摄像头 + 麦克风 — 调试 + 让用户切换源. */
  const refreshCameras = async (): Promise<MediaDeviceInfo[]> => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const cams = devices.filter(d => d.kind === 'videoinput')
      const mics = devices.filter(d => d.kind === 'audioinput')
      setAvailableCameras(cams)
      setAvailableMics(mics)
      return cams
    } catch { return [] }
  }

  /** 切换麦克风源 — 不影响视频, 只换 cameraStream 里的音轨. */
  const switchMic = async (deviceId: string) => {
    if (!deviceId) return
    setSelectedMicId(deviceId)
    setError('')
    try {
      const newMicStream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true },
      })
      // 把新音轨塞回 cameraStream (替换旧的)
      if (cameraStream) {
        cameraStream.getAudioTracks().forEach(t => { t.stop(); cameraStream.removeTrack(t) })
        newMicStream.getAudioTracks().forEach(t => cameraStream.addTrack(t))
        // 触发 React 更新 (MediaStream 是引用, 直接改 React 不重渲染 — 新建一个壳)
        const fresh = new MediaStream([...cameraStream.getVideoTracks(), ...cameraStream.getAudioTracks()])
        setCameraStream(fresh)
      } else {
        setCameraStream(newMicStream)
      }
      console.log('[record] mic switched to:', availableMics.find(m => m.deviceId === deviceId)?.label)
    } catch (e: any) {
      setError('切换麦克风失败: ' + (e?.message || e))
    }
  }

  /** 获取摄像头. deviceId 可选 (从下拉切换源用). 没传就自动优先真实摄像头.
   * 关键: 视频跟麦克风分开请求 — 虚拟摄像头 (OBS / 寻影 等) 多半不带音轨,
   * 必须从指定 / 系统默认 mic 单独取, 然后合并到同一 stream. */
  const requestCamera = async (deviceId?: string) => {
    setError('')
    if (deviceId && cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop())
      setCameraStream(null)
    }
    const tryGet = (constraints: MediaStreamConstraints) =>
      navigator.mediaDevices.getUserMedia(constraints)

    let pickedDeviceId = deviceId
    if (!deviceId) {
      const cams = await refreshCameras()
      if (cams.length > 1 && cams.some(c => c.label)) {
        const real = cams.find(c => c.label && !/virtual|mate|virtualcam/i.test(c.label))
        if (real) pickedDeviceId = real.deviceId
      }
    }

    // 选麦克风: 用户已选的 selectedMicId; 没选过就自动优先非虚拟实体麦
    let pickedMicId = selectedMicId
    if (!pickedMicId && availableMics.length > 1 && availableMics.some(m => m.label)) {
      const realMic = availableMics.find(m =>
        m.label && !/virtual|obs|loopback|stereo mix|default/i.test(m.label)
      )
      if (realMic) pickedMicId = realMic.deviceId
    }

    try {
      // 1. 视频: 从指定摄像头拿 (不含 audio, 避免虚拟摄像头无音轨整个调用失败)
      let videoStream: MediaStream
      if (pickedDeviceId) {
        videoStream = await tryGet({ video: { deviceId: { exact: pickedDeviceId } }, audio: false })
      } else {
        try {
          videoStream = await tryGet({ video: true, audio: false })
        } catch {
          videoStream = await tryGet({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false })
        }
      }

      // 2. 麦克风: 从指定设备拿 (没指定就系统默认). 失败不致命.
      let micStream: MediaStream | null = null
      try {
        const audioConstraint: MediaTrackConstraints = pickedMicId
          ? { deviceId: { exact: pickedMicId }, echoCancellation: true, noiseSuppression: true }
          : { echoCancellation: true, noiseSuppression: true }
        micStream = await tryGet({ video: false, audio: audioConstraint })
        // 记录最终用的麦, 给 UI 下拉反显
        const actualMicId = micStream.getAudioTracks()[0]?.getSettings().deviceId
        if (actualMicId && actualMicId !== selectedMicId) setSelectedMicId(actualMicId)
      } catch (micErr: any) {
        console.warn('[record] mic request failed:', micErr)
        // 不抛错 — 用户摄像头有了, 麦克风不行就先无声, 后面提示
      }

      // 3. 合并视频 + 音频成一个 stream
      const combined = new MediaStream()
      videoStream.getVideoTracks().forEach(t => combined.addTrack(t))
      micStream?.getAudioTracks().forEach(t => combined.addTrack(t))

      setCameraStream(combined)
      setSelectedCameraId(videoStream.getVideoTracks()[0]?.getSettings().deviceId || '')
      await refreshCameras()
      if (screenStream || phase === 'setup') setPhase('previewing')

      // 麦克风没拿到 → 提示用户
      if (!micStream || micStream.getAudioTracks().length === 0) {
        setError('视频 OK 但麦克风没接到, 录出来会无声. 检查系统隐私 → 麦克风权限, 或浏览器地址栏锁图标里麦克风权限')
      }
    } catch (e: any) {
      const cams = await refreshCameras()
      handleCameraError(e, cams)
    }
  }

  /** 错误提示 — 通用文案, 不暴露内部技术 / 设备名 */
  const handleCameraError = (e: any, cams: MediaDeviceInfo[]) => {
    const name = e?.name || ''
    if (name === 'NotAllowedError') {
      setError('摄像头权限被拒. 浏览器地址栏左侧锁图标 → 摄像头 → 改成允许, 然后刷新页面')
      return
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      if (cams.length === 0) {
        setError('没找到可用的摄像头. 检查摄像头是否连接, 或打开手机当摄像头的 app')
      } else {
        setError(`检测到 ${cams.length} 个摄像头但用不了, 下面选一个试试`)
      }
      return
    }
    if (name === 'NotReadableError') {
      setError('摄像头被别的程序占用了. 关掉其他视频 / 录屏 app 再试')
      return
    }
    setError(`获取摄像头失败: ${e?.message || e}`)
  }

  // 挂载时枚举一次 — 给用户看 Chrome 默认能看到啥 (没授权前 label 是空, 但能知道数量)
  useEffect(() => {
    refreshCameras()
    // 用户插拔设备时也刷新
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshCameras)
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', refreshCameras)
  }, [])

  // 拉 BGM 库 (一次, 用户展开 BGM 面板时才需要)
  useEffect(() => {
    if (!showBgmPanel || bgmList.length > 0) return
    listBgmLibrary().then(d => setBgmList(d.bgms || [])).catch(e => console.warn('[record] BGM 拉取失败', e))
  }, [showBgmPanel, bgmList.length])

  // BGM 预览 — 用户选中后用 <audio> 元素自动播 (preview 阶段)
  useEffect(() => {
    if (!selectedBgm || phase !== 'previewing') {
      bgmAudioElRef.current?.pause()
      return
    }
    const audio = bgmAudioElRef.current
    if (!audio) return
    audio.src = selectedBgm.preview_url
    audio.volume = bgmVolume
    audio.loop = true
    audio.play().catch(e => console.warn('[record] BGM 预览失败 (用户没交互过页面?)', e))
  }, [selectedBgm, phase, bgmVolume])
  // 实时音量调整
  useEffect(() => {
    if (bgmAudioElRef.current) bgmAudioElRef.current.volume = bgmVolume
    if (bgmGainNodeRef.current) bgmGainNodeRef.current.gain.value = bgmVolume
  }, [bgmVolume])
  const onPresetPick = async (preset: string) => {
    setError('')
    if (preset === 'screen_camera') {
      setBgMode('screen')
      await requestCamera()
      await requestScreen()
    } else if (preset === 'whiteboard_camera') {
      // 白板: 不要屏幕, 用 canvas 自己画白色背景 + 摄像头叠加
      setBgMode('whiteboard')
      await requestCamera()
      // 没屏幕也要进 previewing
      setTimeout(() => { if (cameraStream || screenStream) setPhase('previewing') }, 100)
    } else if (preset === 'screen_only') {
      setBgMode('screen')
      await requestScreen()
    } else if (preset === 'camera_only') {
      setBgMode('camera_only')
      await requestCamera()
    }
  }
  const startRecording = async () => {
    setError('')
    // 每日次数限制 (前端 localStorage 软校验, 真省钱的是后端 转 mp4 限频)
    if (userId != null && quotaExhausted) {
      setError(`今日免费录屏次数用完 (${dailyLimit}/天)${isPro ? '' : ', 升级 Pro 提升至 30 次/天'}`)
      return
    }
    if (!canvasRef.current) return
    const stream = canvasRef.current.captureStream(30)

    // 音频路由:
    // - 没选 BGM: mic / screen audio 直接加到 stream (老逻辑)
    // - 选了 BGM: Web Audio 合流 (mic + screen + BGM) → MediaStreamAudioDestinationNode 出一个混合音轨, 加到 stream
    if (!selectedBgm) {
      if (cameraStream) cameraStream.getAudioTracks().forEach(t => stream.addTrack(t))
      if (screenStream) screenStream.getAudioTracks().forEach(t => stream.addTrack(t))
    } else {
      try {
        // 停掉 preview 阶段的 <audio>, 改用 Web Audio (不然双倍音量)
        bgmAudioElRef.current?.pause()
        const ctx = new AudioContext()
        bgmContextRef.current = ctx
        const dest = ctx.createMediaStreamDestination()
        // mic 路: cameraStream / screenStream 的 audio 进 ctx → dest
        if (cameraStream && cameraStream.getAudioTracks().length > 0) {
          const micOnly = new MediaStream(cameraStream.getAudioTracks())
          ctx.createMediaStreamSource(micOnly).connect(dest)
        }
        if (screenStream && screenStream.getAudioTracks().length > 0) {
          const sysOnly = new MediaStream(screenStream.getAudioTracks())
          ctx.createMediaStreamSource(sysOnly).connect(dest)
        }
        // BGM 路: fetch → decode → BufferSource → Gain → dest
        const r = await fetch(selectedBgm.preview_url)
        const arr = await r.arrayBuffer()
        const buf = await ctx.decodeAudioData(arr)
        const bgmSrc = ctx.createBufferSource()
        bgmSrc.buffer = buf
        bgmSrc.loop = true            // 录制可能比 BGM 长, 循环
        const gain = ctx.createGain()
        gain.gain.value = bgmVolume
        bgmSrc.connect(gain).connect(dest)
        // 同时也连到扬声器, 让用户能听到自己录的 (跟 preview 时一样)
        gain.connect(ctx.destination)
        bgmSrc.start()
        bgmSourceNodeRef.current = bgmSrc
        bgmGainNodeRef.current = gain
        // 把合流的音轨加到录制 stream
        dest.stream.getAudioTracks().forEach(t => stream.addTrack(t))
      } catch (e: any) {
        console.warn('[record] BGM 合流失败, 退回纯 mic:', e)
        if (cameraStream) cameraStream.getAudioTracks().forEach(t => stream.addTrack(t))
        if (screenStream) screenStream.getAudioTracks().forEach(t => stream.addTrack(t))
      }
    }

    // 编码优先级: 一定要选 *带音频 codec* 的 mime, 不然 MediaRecorder 会静默丢音频!
    // 之前的 bug: 'video/mp4;codecs=avc1' (只声明视频 codec) 让 mp4 输出没声音.
    // 现在只在浏览器明确支持 H.264 + AAC 一起时才用 mp4, 否则退 webm vp9/vp8 + opus.
    const mime = MediaRecorder.isTypeSupported('video/mp4;codecs=avc1,mp4a.40.2') ? 'video/mp4;codecs=avc1,mp4a.40.2'
      : MediaRecorder.isTypeSupported('video/mp4;codecs=h264,aac') ? 'video/mp4;codecs=h264,aac'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus') ? 'video/webm;codecs=vp8,opus'
      : MediaRecorder.isTypeSupported('video/webm;codecs=opus') ? 'video/webm;codecs=opus'
      : 'video/webm'

    const audioTracks = stream.getAudioTracks()
    console.log('[record] mime:', mime, '| audio tracks:', audioTracks.length, audioTracks.map(t => ({ label: t.label, enabled: t.enabled, muted: t.muted, readyState: t.readyState })))
    if (audioTracks.length === 0) {
      setError('没接到任何音频源. 检查麦克风权限 (浏览器地址栏锁图标), 或重新点麦克风图标授权.')
      return
    }

    chunksRef.current = []
    const rec = new MediaRecorder(stream, { mimeType: mime })
    rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mime })
      setRecordedBlob(blob)
      setRecordedUrl(URL.createObjectURL(blob))
      setPhase('done')
    }
    rec.start(1000)
    recorderRef.current = rec
    setPhase('recording')
    // 录制成功开始 → 计数 +1 (放成功路径之后, 防止 catch 前抛了 setup 错误也扣)
    if (userId != null) {
      incRecordCount(userId)
      setRecordCountToday(c => c + 1)
    }
  }
  const stopRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop()
    // 停 BGM Web Audio (合流时建的 context)
    try { (bgmSourceNodeRef.current as AudioBufferSourceNode | null)?.stop() } catch { /* ignore */ }
    try { bgmContextRef.current?.close() } catch { /* ignore */ }
    bgmSourceNodeRef.current = null
    bgmGainNodeRef.current = null
    bgmContextRef.current = null
  }
  const resetAll = () => {
    screenStream?.getTracks().forEach(t => t.stop())
    cameraStream?.getTracks().forEach(t => t.stop())
    setScreenStream(null); setCameraStream(null)
    if (recordedUrl) URL.revokeObjectURL(recordedUrl)
    setRecordedBlob(null); setRecordedUrl('')
    setPhase('setup')
    // 清 BGM 状态
    setSelectedBgm(null)
    bgmAudioElRef.current?.pause()
    try { (bgmSourceNodeRef.current as AudioBufferSourceNode | null)?.stop() } catch { /* ignore */ }
    try { bgmContextRef.current?.close() } catch { /* ignore */ }
    bgmSourceNodeRef.current = null
    bgmGainNodeRef.current = null
    bgmContextRef.current = null
  }
  const downloadVideo = () => {
    if (!recordedBlob) return
    // 文件扩展名根据实际 mime 决定 (mp4 / webm)
    const isMp4 = recordedBlob.type.includes('mp4')
    const ext = isMp4 ? 'mp4' : 'webm'
    const a = document.createElement('a')
    a.href = recordedUrl
    a.download = `monoi-record-${Date.now()}.${ext}`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }

  // 进入口播剪辑 (纯内存):
  // 1. blob 包成 File → window.__pendingRecording__
  // 2. 注入 chat assistant 消息 (带 chip "开始剪辑")
  // 3. navigate('/app/chat')
  // 不上 OSS — 录屏免费, 长期存储成本爆炸. 用户必须当场决策, 刷新就丢.
  // (NarrationVideoForm 走自己原有的上传路径, 不重复.)
  const goToEdit = () => {
    if (!recordedBlob) return
    const isMp4 = recordedBlob.type.includes('mp4')
    const ext = isMp4 ? 'mp4' : 'webm'
    const file = new File([recordedBlob], `monoi-record-${Date.now()}.${ext}`, { type: recordedBlob.type })
    ;(window as any).__pendingRecording__ = file

    const store = useChatStore.getState()
    let convId = store.activeId
    if (!convId) convId = store.newConversation()
    const sizeMb = (recordedBlob.size / 1024 / 1024).toFixed(1)
    const mm = Math.floor(elapsed / 60), ss = String(elapsed % 60).padStart(2, '0')
    const msg = makeAssistantMsg([
      { type: 'text', content: `你的录屏已就绪 (${sizeMb} MB · ${mm}:${ss}). 点下面进剪辑流程, 自动去气口 / 加字幕 / 上 BGM.` },
      {
        type: 'choices',
        options: [
          { id: '__narration_video__', label: '开始剪辑', description: '打开口播剪辑表单 (已带刚才的录屏)' },
        ],
      },
    ])
    store.addMessage(convId, msg)
    navigate('/app/chat')
  }

  // 转 mp4 下载 — 先上传 webm 到 OSS, 调转码, 拉新 mp4 自动下载.
  // 当前 blob 已经是 mp4 → 直接 downloadVideo()
  const transcodeAndDownload = async () => {
    if (!recordedBlob || busy !== 'idle') return
    if (recordedBlob.type.includes('mp4')) { downloadVideo(); return }
    try {
      setBusy('uploading'); setError(''); setUploadPct(0)
      const filename = `monoi-record-${Date.now()}.webm`
      const { oss_key } = await uploadBlobToOss(recordedBlob, filename, 'recordings', setUploadPct)
      setBusy('transcoding')
      const { url } = await transcodeRecordingToMp4(oss_key)
      const resp = await fetch(url)
      const mp4Blob = await resp.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(mp4Blob)
      a.download = `monoi-record-${Date.now()}.mp4`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(a.href)
    } catch (e: any) {
      // 后端 429: 配额已满 (msg 含 "次数用完"), 直接展示原文 (已经友好措辞)
      const msg = e?.message || String(e)
      if (msg.includes('次数用完')) {
        setError(msg)
      } else {
        setError('转 mp4 失败: ' + msg)
      }
    } finally {
      setBusy('idle'); setUploadPct(0)
    }
  }

  useEffect(() => () => {
    screenStream?.getTracks().forEach(t => t.stop())
    cameraStream?.getTracks().forEach(t => t.stop())
    if (recordedUrl) URL.revokeObjectURL(recordedUrl)
    cancelAnimationFrame(rafRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ===== UI =====

  if (isUnsupported) {
    return (
      <div className="flex-1 flex items-center justify-center px-4 bg-[var(--bg-chat)]">
        <div className="max-w-md text-center">
          <AlertCircle size={32} className="mx-auto text-amber-500 mb-3"/>
          <h2 className="text-lg font-semibold mb-2">你的浏览器不支持录屏</h2>
          <p className="text-sm text-[var(--text-3)]">当前浏览器不支持录屏. 请用电脑或安卓手机的常见浏览器试试.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[var(--bg-chat)]">
      <video ref={screenVideoRef} className="hidden" muted playsInline/>
      <video ref={cameraVideoRef} className="hidden" muted playsInline/>

      {/* 上半: 主内容区 (跟创作 tab ChatContainer 一致, overflow-y-auto + max-w-3xl 居中) */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-8 flex flex-col gap-6">

          {error && (
            <>
              {/* 有多个摄像头时, 直接给"选一个" 卡片列表 (用户点想用的那个), 不要红 error + dropdown 难看 */}
              {availableCameras.length > 1 ? (
                <div className="rounded-2xl border border-amber-500/40 bg-amber-50/50 dark:bg-amber-950/20 p-4 flex flex-col gap-3">
                  <div className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400">
                    <AlertCircle size={16} className="mt-0.5 flex-shrink-0"/>
                    <span className="leading-relaxed">默认摄像头用不了. 你电脑上有 {availableCameras.length} 个摄像头, 点一个想用的试试:</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {availableCameras.map(c => {
                      const isReal = c.label && !/virtual|mate/i.test(c.label)
                      const displayLabel = c.label || `设备 ${c.deviceId.slice(0, 8)}`
                      return (
                        <button key={c.deviceId}
                          onClick={() => { setError(''); requestCamera(c.deviceId) }}
                          className={`text-left px-3 py-2.5 rounded-xl border transition-all cursor-pointer ${
                            isReal
                              ? 'border-green-500/50 bg-green-50/50 dark:bg-green-950/20 hover:bg-green-100/50 dark:hover:bg-green-950/30'
                              : 'border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-hover)]'
                          }`}>
                          <div className="text-sm font-medium text-[var(--text)] flex items-center gap-1.5">
                            {isReal && <span className="text-[10px] text-green-600 dark:text-green-500 bg-green-100 dark:bg-green-950/50 px-1.5 py-0.5 rounded">推荐</span>}
                            {displayLabel}
                          </div>
                          <div className="text-[10px] text-[var(--text-3)] mt-0.5">
                            {isReal ? '真实摄像头, 物理插着的设备' : '虚拟摄像头 (要对应的 app 在跑)'}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                  <p className="text-[10px] text-[var(--text-3)]">提示: 标"推荐"是物理摄像头, 一般直接能用. 虚拟摄像头要对应软件在后台跑才有画面</p>
                </div>
              ) : (
                /* 没有备选源或没检测到摄像头 → 红 error 显示原始错误信息 */
                <div className="text-sm text-red-400 bg-red-950/20 border border-red-900/30 rounded-lg px-3 py-2 flex flex-col gap-2">
                  <div className="flex items-start gap-2">
                    <AlertCircle size={14} className="mt-0.5 flex-shrink-0"/>
                    <span className="leading-relaxed">{error}</span>
                  </div>
                  {availableCameras.length === 0 && (
                    <div className="text-[11px] text-red-300/80 border-t border-red-900/30 pt-2 mt-1">
                      没找到任何摄像头. 检查摄像头是否连接 + 系统是否允许访问
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* === setup 阶段: 跟 WelcomeMessage 一模一样的布局: 头像 + 介绍 + 选项 grid === */}
          {phase === 'setup' && (
            <div className="flex items-start gap-3 msg-enter">
              <Logo className="w-8 h-8 rounded-xl object-contain flex-shrink-0 mt-0.5"/>
              <div className="flex-1 min-w-0 flex flex-col gap-4 pt-1">
                <div className="flex flex-col gap-1.5">
                  <p className="text-[var(--text)] leading-relaxed">
                    你好! 录屏功能给你录"屏幕 + 人物" PIP 视频. 屏幕作背景, 摄像头作画中画, 一键搞定知识付费 / 教培讲解.
                  </p>
                  <p className="text-sm text-[var(--text-3)]">选一种录法, 我帮你启动:</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {RECORD_PRESETS.map(p => (
                    <button key={p.id} onClick={() => onPresetPick(p.id)}
                      className="text-left px-3.5 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--text-3)] hover:bg-[var(--bg-hover)] transition-all cursor-pointer">
                      <div className="text-sm font-medium text-[var(--text)] leading-tight">{p.label}</div>
                      <div className="text-xs text-[var(--text-3)] mt-0.5 leading-tight">{p.desc}</div>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-[var(--text-3)]">
                  也可以直接用下方工具栏图标单独授权摄像头 / 屏幕. 建议录制不超过 5 分钟.
                </p>
              </div>
            </div>
          )}

          {/* === previewing / recording: canvas + 进度 ===
              recording 时也显示画面 (用户要看见录的啥). 套娃风险只在选"整个屏幕"
              录屏才会出现 — 那种情况之前已经在 requestScreen 里检测警告. */}
          {(phase === 'previewing' || phase === 'recording') && (
            <div className="flex flex-col gap-3">
              {/* 白板模式: 显示 Konva 编辑器 + 隐藏合成 canvas (Konva 自带预览, 合成走幕后) */}
              {bgMode === 'whiteboard' ? (
                <>
                  <WhiteboardEditor
                    width={RATIO_SIZE[outputRatio].w}
                    height={RATIO_SIZE[outputRatio].h}
                    onStageReady={s => { whiteboardStageRef.current = s }}
                    cameraStream={cameraStream}
                    pipPos={pipPos}
                    pipSizePct={pipSize}
                    pipShape={pipShape}
                  />
                  {phase === 'previewing' && cameraStream && (
                    <div className="text-[11px] text-[var(--text-3)] text-center">摄像头 PIP 会在录制时叠到白板上 (位置 / 大小 / 形状下方 PIP 设置调)</div>
                  )}
                  {/* 隐藏的合成 canvas, captureStream 需要它真在 DOM 里渲染 */}
                  <canvas ref={canvasRef} style={{ position: 'fixed', left: '-9999px', top: 0, width: 1, height: 1 }}/>
                </>
              ) : (
                // 屏幕 / 仅摄像头模式: 显示合成 canvas, 录制时也显示让用户能看见正在录的内容
                <div className="rounded-2xl border border-[var(--border)] bg-black overflow-hidden flex items-center justify-center" style={{ minHeight: '300px' }}>
                  <canvas ref={canvasRef} className="block max-w-full max-h-[60vh]"/>
                </div>
              )}

              {/* recording 时, 一个超大显眼的浮动停止按钮 + 计时 (用户找不到底部 toolbar 也能直接停)
                  临近上限 (剩 < 5 分钟) 时改成橙色 + 显示倒计时, 提醒收尾. */}
              {phase === 'recording' && (() => {
                const remaining = Math.max(0, MAX_RECORD_SECONDS - elapsed)
                const isWarning = remaining <= WARN_SECONDS_LEFT && remaining > 0
                const mm = Math.floor(elapsed / 60), ss = String(elapsed % 60).padStart(2, '0')
                const rmm = Math.floor(remaining / 60), rss = String(remaining % 60).padStart(2, '0')
                return (
                <div className="flex items-center justify-center gap-3 sticky bottom-4 z-50">
                  <div className={`flex items-center gap-2 ${isWarning ? 'bg-orange-500' : 'bg-red-500'} text-white px-4 py-2 rounded-full font-medium text-sm shadow-lg`}>
                    <span className="w-2 h-2 rounded-full bg-white animate-pulse"/>
                    录制中 {mm}:{ss}{isWarning && <span className="ml-2 text-[11px] opacity-90">还剩 {rmm}:{rss}</span>}
                  </div>
                  <button onClick={stopRecording}
                    className="flex items-center gap-2 bg-[var(--text)] text-[var(--bg)] px-5 py-2 rounded-full font-medium text-sm hover:opacity-80 cursor-pointer shadow-lg">
                    <Square size={14} fill="currentColor"/> 停止录制
                  </button>
                </div>
                )
              })()}
              {phase === 'previewing' && (bgMode === 'screen') && (
                <div className="rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-900/50 p-3 text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                  <div className="font-medium mb-1.5 flex items-center gap-1.5">💡 避免画面"套娃" 的 3 步操作</div>
                  <ol className="list-decimal list-inside space-y-1 pl-1">
                    <li>录之前先打开你要讲的东西 (PPT / Keynote / Word / Notion / VS Code 等), <b>不能是浏览器</b></li>
                    <li>回 monoi 点底部 🖥️ 屏幕 → 浏览器弹"选择共享" 窗口</li>
                    <li>选 <b>"应用窗口"</b> 选项 → 找你刚开的那个应用, <b>不要选当前浏览器</b></li>
                  </ol>
                  <p className="mt-2 text-[10px] opacity-80">浏览器里就是 monoi 自己, 选它会无限套娃 (画中画中画...), 录出来啥也看不清.</p>
                </div>
              )}

              {/* 摄像头源切换 — 多个摄像头时显示下拉 (寻影/iPhone/USB/内置), 单个不显示 */}
              {cameraStream && availableCameras.length > 1 && phase === 'previewing' && (
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-3 flex items-center gap-3">
                  <span className="text-xs text-[var(--text-3)] flex-shrink-0">摄像头源:</span>
                  <select value={selectedCameraId} onChange={e => requestCamera(e.target.value)}
                    className="flex-1 bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-xs text-[var(--text)] cursor-pointer">
                    {availableCameras.map(c => (
                      <option key={c.deviceId} value={c.deviceId}>{c.label || `摄像头 ${c.deviceId.slice(0, 6)}`}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* 麦克风源切换 — 用户有 USB 麦 + 内置 + 摄像头麦时显示, 单个不显示.
                  cameraStream 存在 (说明已经走过麦克风权限) + 多个可选时才显示. */}
              {cameraStream && availableMics.length > 1 && phase === 'previewing' && (
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-3 flex items-center gap-3">
                  <span className="text-xs text-[var(--text-3)] flex-shrink-0">麦克风源:</span>
                  <select value={selectedMicId} onChange={e => switchMic(e.target.value)}
                    className="flex-1 bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-xs text-[var(--text)] cursor-pointer">
                    {availableMics.map(m => (
                      <option key={m.deviceId} value={m.deviceId}>{m.label || `麦克风 ${m.deviceId.slice(0, 6)}`}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* BGM 选择面板 — 按 category 分组, 用户选一个 + 调音量 */}
              {showBgmPanel && phase === 'previewing' && (
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 flex flex-col gap-3 msg-enter">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-medium text-[var(--text-2)] flex items-center gap-1.5">
                      <Music size={12}/> 背景音乐 (混入录制)
                    </div>
                    {selectedBgm && (
                      <button onClick={() => setSelectedBgm(null)}
                        className="text-[10px] text-[var(--text-3)] hover:text-red-400 flex items-center gap-0.5 cursor-pointer">
                        <XIcon size={11}/> 取消选择
                      </button>
                    )}
                  </div>
                  {/* 音量条 (仅选中 BGM 时显示) */}
                  {selectedBgm && (
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-[var(--text-3)] flex-shrink-0">BGM 音量:</span>
                      <input type="range" min={0} max={1} step={0.05} value={bgmVolume}
                        onChange={e => setBgmVolume(Number(e.target.value))}
                        className="flex-1"/>
                      <span className="text-[var(--text-2)] w-8 text-right">{Math.round(bgmVolume * 100)}%</span>
                    </div>
                  )}
                  {/* BGM 列表 */}
                  {bgmList.length === 0 ? (
                    <div className="text-xs text-[var(--text-3)] text-center py-3">
                      {bgmList === null ? '加载中...' : '还没有 BGM. (管理员可在后台 BGM 库上传)'}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-64 overflow-y-auto">
                      {bgmList.map(bgm => {
                        const isSelected = selectedBgm?.id === bgm.id
                        return (
                          <button key={bgm.id} onClick={() => setSelectedBgm(bgm)}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs cursor-pointer transition-colors text-left ${
                              isSelected
                                ? 'bg-[var(--text)] text-[var(--bg)]'
                                : 'bg-[var(--bg-hover)] text-[var(--text-2)] hover:bg-[var(--bg-input)]'
                            }`}>
                            <Music size={12} className="flex-shrink-0"/>
                            <span className="flex-1 truncate">{bgm.name}</span>
                            <span className="text-[10px] opacity-60 flex-shrink-0">{bgm.category}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                  <div className="text-[10px] text-[var(--text-3)] leading-relaxed">
                    💡 BGM 会混入录制的音轨. 录制时建议戴耳机 (避免扬声器播 BGM 又被麦克风录进去, 造成回音).
                  </div>
                </div>
              )}

              {/* 预览阶段的 BGM 播放器 (隐藏, 仅控制) */}
              <audio ref={bgmAudioElRef} className="hidden"/>

              {showPipSettings && (
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 flex flex-col gap-3 msg-enter">
                  <div className="text-xs font-medium text-[var(--text-2)]">输出尺寸</div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {(['16:9', '9:16', '1:1', '3:4'] as OutputRatio[]).map(r => (
                      <button key={r} onClick={() => setOutputRatio(r)}
                        className={`px-3 py-1 rounded-lg border text-xs cursor-pointer transition-colors ${outputRatio === r ? 'border-[var(--text)] bg-[var(--text)] text-[var(--bg)]' : 'border-[var(--border)] text-[var(--text-2)]'}`}>
                        {RATIO_SIZE[r].label}
                      </button>
                    ))}
                  </div>
                  <div className="text-[10px] text-[var(--text-3)] -mt-1">9:16 适合抖音/小红书, 16:9 适合 B 站/YouTube, 1:1 适合 IG, 3:4 适合视频号</div>

                  <div className="border-t border-[var(--border-subtle)] pt-2 text-xs font-medium text-[var(--text-2)]">PIP 设置</div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-[var(--text-3)] mr-1">形状:</span>
                    {(['circle', 'rounded', 'square'] as PipShape[]).map(s => (
                      <button key={s} onClick={() => setPipShape(s)}
                        className={`px-3 py-1 rounded-lg border text-xs cursor-pointer transition-colors ${pipShape === s ? 'border-[var(--text)] bg-[var(--text)] text-[var(--bg)]' : 'border-[var(--border)] text-[var(--text-2)]'}`}>
                        {s === 'circle' ? '圆' : s === 'rounded' ? '圆角方' : '直角方'}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-[var(--text-3)]">大小:</span>
                    <input type="range" min={10} max={45} value={pipSize} onChange={e => setPipSize(Number(e.target.value))} className="flex-1 max-w-xs"/>
                    <span className="font-mono text-[var(--text-2)] w-12 text-right">{pipSize}%</span>
                  </div>
                  <div className="flex items-start gap-3 text-xs">
                    <span className="text-[var(--text-3)] mt-1">位置:</span>
                    <div className="grid grid-cols-3 gap-1.5 w-20">
                      {(['tl','tc','tr','cl','cc','cr','bl','bc','br'] as PipPos[]).map(p => (
                        <button key={p} onClick={() => setPipPos(p)}
                          className={`aspect-square rounded border text-xs cursor-pointer transition-colors ${pipPos === p ? 'border-[var(--text)] bg-[var(--text)]' : 'border-[var(--border)] hover:bg-[var(--bg-hover)]'}`}/>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* === done: 预览成片 + 操作 === */}
          {phase === 'done' && recordedUrl && (
            <div className="flex flex-col gap-3">
              <div className="rounded-2xl border border-[var(--border)] bg-black overflow-hidden">
                <video src={recordedUrl} controls className="w-full max-h-[55vh] block"/>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 flex flex-col gap-3">
                <div className="text-xs text-[var(--text-2)]">
                  录制完成 · 时长 {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')} · 大小 {recordedBlob ? `${(recordedBlob.size / 1024 / 1024).toFixed(1)} MB` : ''}
                </div>
                <p className="text-[11px] text-[var(--text-3)]">
                  点 "进入剪辑" 直接进口播剪辑流程. 或下载本地存档. 注意: 进剪辑后别刷新 (录屏暂存在内存里, 没云端备份).
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 下半: 底部工具栏 (跟 ChatInput 一致风格) */}
      <div className="border-t border-[var(--border)] bg-[var(--bg-chat)] px-4 pt-3 pb-4">
        <div className="max-w-3xl mx-auto">
          {/* 主操作区: 状态显示 + 大按钮 (相当于创作 tab 的输入框) */}
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl px-4 py-3 flex items-center gap-3 min-h-[52px]">
            {phase === 'setup' && (
              <span className="flex-1 text-sm text-[var(--text-3)] flex items-center gap-3">
                <span>点上面选一种录法, 或下面图标单独授权</span>
                {userId != null && (
                  <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${quotaExhausted ? 'bg-red-500/10 text-red-400' : 'bg-[var(--bg-hover)] text-[var(--text-2)]'}`}>
                    今日剩余 {remainingRecords}/{dailyLimit}{!isPro && quotaExhausted ? ' · 升级 Pro 不限' : ''}
                  </span>
                )}
              </span>
            )}
            {phase === 'previewing' && (
              <>
                <span className="flex-1 text-sm text-[var(--text-2)] flex items-center gap-3">
                  <span>{quotaExhausted ? '今日次数用完, 无法录制' : '画面已就绪, 点 → 开始录制'}</span>
                  {userId != null && !quotaExhausted && (
                    <span className="ml-auto text-xs text-[var(--text-3)]">今日剩余 {remainingRecords}/{dailyLimit}</span>
                  )}
                </span>
                <button onClick={startRecording} disabled={quotaExhausted}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-500 hover:bg-red-600 disabled:bg-[var(--bg-hover)] disabled:text-[var(--text-3)] disabled:cursor-not-allowed text-white text-sm font-medium cursor-pointer"
                  title={quotaExhausted ? (isPro ? '今日 30 次额度已用完' : '今日免费 5 次已用完, 升级 Pro 提升至 30 次/天') : ''}>
                  <span className="w-2 h-2 rounded-full bg-white"/> 开始录制
                </button>
              </>
            )}
            {phase === 'recording' && (() => {
              const remaining = Math.max(0, MAX_RECORD_SECONDS - elapsed)
              const isWarning = remaining <= WARN_SECONDS_LEFT && remaining > 0
              const mm = Math.floor(elapsed / 60), ss = String(elapsed % 60).padStart(2, '0')
              const rmm = Math.floor(remaining / 60), rss = String(remaining % 60).padStart(2, '0')
              const colorClass = isWarning ? 'text-orange-500' : 'text-red-500'
              const dotBg = isWarning ? 'bg-orange-500' : 'bg-red-500'
              return (
              <>
                <span className={`flex-1 text-sm ${colorClass} font-medium flex items-center gap-2`}>
                  <span className={`w-2 h-2 rounded-full ${dotBg} animate-pulse`}/>
                  录制中 {mm}:{ss}
                  {isWarning && <span className="text-[11px] opacity-90 ml-1">· 还剩 {rmm}:{rss} 自动停</span>}
                </span>
                <button onClick={stopRecording}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[var(--text)] text-[var(--bg)] text-sm font-medium hover:opacity-80 cursor-pointer">
                  <Square size={12} fill="currentColor"/> 停止
                </button>
              </>
              )
            })()}
            {phase === 'done' && (
              <>
                <span className="flex-1 text-sm text-green-500 font-medium">
                  {busy === 'uploading' ? `上传中 ${uploadPct}%`
                    : busy === 'transcoding' ? '转 mp4 中...'
                    : '✓ 录制完成'}
                </span>
                <button onClick={goToEdit} disabled={busy !== 'idle'}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-white text-sm font-medium ${busy === 'idle' ? 'bg-blue-500 hover:bg-blue-600 cursor-pointer' : 'bg-blue-400 cursor-not-allowed'}`}
                  title="直接进口播剪辑表单 (录屏暂存内存里, 别刷新)">
                  <Scissors size={12}/> 进入剪辑
                </button>
                <button onClick={transcodeAndDownload} disabled={busy !== 'idle'}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--border)] text-[var(--text-2)] text-sm hover:bg-[var(--bg-hover)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  title={recordedBlob?.type.includes('mp4') ? '直接下载 (浏览器已出 mp4)' : '上传服务端用 ffmpeg 转 mp4 后下载 (临时文件不持久)'}>
                  <Download size={12}/> {recordedBlob?.type.includes('mp4') ? '下载' : '转 mp4 下载'}
                </button>
                <button onClick={resetAll} disabled={busy !== 'idle'}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--border)] text-[var(--text-2)] text-sm hover:bg-[var(--bg-hover)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                  <RotateCcw size={12}/> 重录
                </button>
              </>
            )}
          </div>

          {/* 工具栏图标 (跟 ChatInput 文案/配音/口播/封面/抠图 那行一致风格) */}
          <div className="flex items-center gap-1 mt-3 px-1">
            <button onClick={() => requestCamera()} disabled={!!cameraStream || phase === 'recording'}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${cameraStream ? 'text-green-500' : 'text-[var(--text-3)] hover:text-[var(--text-2)] hover:bg-[var(--bg-hover)]'}`}
              title="摄像头 + 麦克风">
              <Camera size={14}/> 摄像头
            </button>
            <button onClick={requestScreen} disabled={!!screenStream || phase === 'recording'}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${screenStream ? 'text-green-500' : 'text-[var(--text-3)] hover:text-[var(--text-2)] hover:bg-[var(--bg-hover)]'}`}
              title="选择屏幕 / 窗口">
              <Monitor size={14}/> 屏幕
            </button>
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs ${cameraStream && cameraStream.getAudioTracks().length > 0 ? 'text-green-500' : 'text-[var(--text-3)]'}`} title="麦克风从系统默认设备取, 跟摄像头分开">
              <Mic size={14}/> 麦克风{cameraStream && cameraStream.getAudioTracks().length === 0 ? ' (无)' : ''}
            </div>
            {/* BGM 按钮 — preview 阶段可开关, 录制中不让改避免合流出错 */}
            {phase === 'previewing' && (
              <button onClick={() => setShowBgmPanel(s => !s)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${selectedBgm ? 'text-green-500' : showBgmPanel ? 'text-[var(--text)] bg-[var(--bg-hover)]' : 'text-[var(--text-3)] hover:text-[var(--text-2)] hover:bg-[var(--bg-hover)]'}`}
                title="加背景音乐 (从 monoi BGM 库选)">
                <Music size={14}/> BGM{selectedBgm ? ` · ${selectedBgm.name}` : ''}
              </button>
            )}
            {(phase === 'previewing' || phase === 'recording') && (
              <button onClick={() => setShowPipSettings(s => !s)}
                className={`ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${showPipSettings ? 'text-[var(--text)] bg-[var(--bg-hover)]' : 'text-[var(--text-3)] hover:text-[var(--text-2)] hover:bg-[var(--bg-hover)]'}`}
                title="PIP 形状/位置/大小">
                <Settings size={14}/> PIP 设置
              </button>
            )}
            {phase === 'setup' && (
              <span className="ml-auto text-[10px] text-[var(--text-3)] flex items-center gap-1">
                <Video size={11}/> 提示: Chrome 分享屏幕时可勾"分享音频"
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** contain 模式画 video — 保持源宽高比塞进目标矩形, 不裁切 (上下/左右黑边) */
function drawContain(ctx: CanvasRenderingContext2D, v: HTMLVideoElement, dw: number, dh: number) {
  const sw = v.videoWidth, sh = v.videoHeight
  if (!sw || !sh) return
  const scale = Math.min(dw / sw, dh / sh)
  const w = sw * scale, h = sh * scale
  const x = (dw - w) / 2, y = (dh - h) / 2
  ctx.drawImage(v, x, y, w, h)
}

/** 在 canvas 上画 PIP 摄像头 — 形状 clip + 边框. circle 用方形 (1:1) 才是真圆. */
function drawPip(
  ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, cameraV: HTMLVideoElement,
  shape: PipShape, pos: PipPos, sizePct: number,
) {
  // circle 形状: 强制 1:1 方形 (短边为准), 才是真圆而不是椭圆
  // rounded / square: 保持摄像头自然宽高比
  let pipW: number, pipH: number
  if (shape === 'circle') {
    const side = (Math.min(canvas.width, canvas.height) * sizePct) / 100
    pipW = side; pipH = side
  } else {
    pipH = (canvas.height * sizePct) / 100
    pipW = (pipH * cameraV.videoWidth) / cameraV.videoHeight
  }

  const padding = canvas.width * 0.02
  let x = padding, y = padding
  if (pos[1] === 'c') x = (canvas.width - pipW) / 2
  else if (pos[1] === 'r') x = canvas.width - pipW - padding
  if (pos[0] === 'c') y = (canvas.height - pipH) / 2
  else if (pos[0] === 'b') y = canvas.height - pipH - padding

  ctx.save()
  if (shape === 'circle') {
    ctx.beginPath()
    ctx.arc(x + pipW / 2, y + pipH / 2, pipW / 2, 0, Math.PI * 2)
    ctx.clip()
    // 摄像头是横长方形 (如 640x480 / 16:9), 要 cover 模式裁到方形 PIP 里 (居中裁) 不变形
    drawCover(ctx, cameraV, x, y, pipW, pipH)
  } else if (shape === 'rounded') {
    const r = Math.min(pipW, pipH) * 0.08
    roundRect(ctx, x, y, pipW, pipH, r)
    ctx.clip()
    ctx.drawImage(cameraV, x, y, pipW, pipH)
  } else {
    ctx.drawImage(cameraV, x, y, pipW, pipH)
  }
  ctx.restore()

  // 边框
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'
  ctx.lineWidth = Math.max(3, canvas.width / 400)
  if (shape === 'circle') {
    ctx.beginPath()
    ctx.arc(x + pipW / 2, y + pipH / 2, pipW / 2, 0, Math.PI * 2)
    ctx.stroke()
  } else if (shape === 'rounded') {
    const r = Math.min(pipW, pipH) * 0.08
    roundRect(ctx, x, y, pipW, pipH, r)
    ctx.stroke()
  } else {
    ctx.strokeRect(x, y, pipW, pipH)
  }
}

/** cover 模式画 video — 源 crop 居中填满目标矩形, 不变形, 多出部分裁掉 */
function drawCover(ctx: CanvasRenderingContext2D, v: HTMLVideoElement, dx: number, dy: number, dw: number, dh: number) {
  const sw = v.videoWidth, sh = v.videoHeight
  if (!sw || !sh) return
  const srcAspect = sw / sh, dstAspect = dw / dh
  let sx = 0, sy = 0, sWidth = sw, sHeight = sh
  if (srcAspect > dstAspect) {
    // 源更宽, 裁左右
    sWidth = sh * dstAspect
    sx = (sw - sWidth) / 2
  } else {
    // 源更高, 裁上下
    sHeight = sw / dstAspect
    sy = (sh - sHeight) / 2
  }
  ctx.drawImage(v, sx, sy, sWidth, sHeight, dx, dy, dw, dh)
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
