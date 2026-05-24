// 录屏 tab — 布局跟创作 tab 一致: 头部 monoi 头像 + 选项 grid + 底部工具栏 + 大按钮.
// 用户授权摄像头 + 屏幕后进 preview, 显示 canvas + PIP 设置 + 录制控制.
//
// 浏览器原生 getDisplayMedia + getUserMedia + Canvas 混合.
// 输出 webm. iOS Safari 不支持 (显示提示).

import { useEffect, useRef, useState } from 'react'
import { Camera, Monitor, Mic, Square, Download, AlertCircle, RotateCcw, Settings, Video } from 'lucide-react'
import type Konva from 'konva'
import { WhiteboardEditor } from '../components/whiteboard/WhiteboardEditor'

type Phase = 'setup' | 'previewing' | 'recording' | 'done'
type PipShape = 'circle' | 'rounded' | 'square'
type PipPos = 'tl' | 'tc' | 'tr' | 'cl' | 'cc' | 'cr' | 'bl' | 'bc' | 'br'
type OutputRatio = '16:9' | '9:16' | '1:1' | '3:4'
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
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => clearInterval(id)
  }, [phase])

  // ===== 操作 =====

  const requestScreen = async () => {
    setError('')
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true })
      // 检测套娃: 用户选了 Chrome / monoi 自己 → 警告
      const label = s.getVideoTracks()[0]?.label?.toLowerCase() || ''
      if (label.includes('chrome') || label.includes('monoi') || label.includes('vercel')) {
        setError('警告: 你选的是 Chrome / monoi 自己, 录出来会无限套娃 (画中画中画...). 建议点 "重选" 改选 PPT / Keynote / 其他应用窗口')
      }
      setScreenStream(s)
      if (cameraStream || (!cameraStream && phase === 'setup')) setPhase('previewing')
    } catch (e: any) {
      if (e.name === 'NotAllowedError') setError('你拒绝了屏幕共享权限')
      else setError(`获取屏幕失败: ${e.message || e}`)
    }
  }
  /** 枚举 Chrome 看到的所有摄像头 — 调试 + 让用户切换源 (寻影 / iPhone / USB 都列). */
  const refreshCameras = async (): Promise<MediaDeviceInfo[]> => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const cams = devices.filter(d => d.kind === 'videoinput')
      setAvailableCameras(cams)
      return cams
    } catch { return [] }
  }

  /** 获取摄像头. deviceId 可选 (从下拉切换源用). 没传就自动优先真实摄像头.
   * 关键: 视频跟麦克风分开请求 — 虚拟摄像头 (OBS / 寻影 等) 多半不带音轨,
   * 必须从系统默认 mic 单独取, 然后合并到同一 stream. */
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

      // 2. 麦克风: 单独从系统默认设备拿 (失败不致命, 没声音也能录无声视频)
      let micStream: MediaStream | null = null
      try {
        micStream = await tryGet({ video: false, audio: { echoCancellation: true, noiseSuppression: true } })
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

  /** 分平台 + 分场景的错误提示 — 帮用户最快定位 */
  const handleCameraError = (e: any, cams: MediaDeviceInfo[]) => {
    const name = e?.name || ''
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
    const isMac = /Mac/i.test(ua)
    const isWin = /Windows/i.test(ua)
    const isChrome = /Chrome/i.test(ua) && !/Edg/i.test(ua)
    const isEdge = /Edg/i.test(ua)
    const isSafari = /Safari/i.test(ua) && !/Chrome/i.test(ua)
    const browserName = isEdge ? 'Microsoft Edge' : isChrome ? 'Chrome' : isSafari ? 'Safari' : '浏览器'

    if (name === 'NotAllowedError') {
      if (isMac) setError(`摄像头被拒. macOS 系统设置 → 隐私与安全 → 摄像头 → 勾选 ${browserName}, 然后完全退出 ${browserName} (Cmd+Q) 重启再试`)
      else if (isWin) setError(`摄像头被拒. Windows 设置 → 隐私和安全性 → 摄像头 → 允许桌面应用访问 → 找到 ${browserName} 勾上`)
      else setError(`${browserName} 拒绝了摄像头权限. 地址栏左侧锁图标里改成允许`)
      return
    }

    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      // 关键判断: 系统里到底有没有摄像头硬件 (Chrome 能不能看到)
      if (cams.length === 0) {
        // Chrome 完全看不到任何摄像头硬件
        if (isMac) setError(`${browserName} 检测不到任何摄像头. 可能原因: 1) Mac mini 没内置摄像头, 需要插 USB 或开寻影/Continuity Camera; 2) 寻影 Mac 端没运行 (打开寻影大师 + iPhone 端寻影 app, 确认 Mac 端能看 iPhone 画面再试); 3) Continuity Camera 需要 iPhone XR+, 跟 Mac 同 Apple ID, 接力开关打开`)
        else if (isWin) setError(`${browserName} 检测不到任何摄像头. 检查 USB 摄像头是否插好, 设备管理器里看摄像头是不是禁用了, 或重启浏览器`)
        else setError(`${browserName} 检测不到任何摄像头. 检查硬件连接和系统权限`)
      } else {
        // 有摄像头但请求失败 — 一般是 deviceId 失效或约束不匹配
        setError(`${browserName} 检测到 ${cams.length} 个摄像头但都用不了, 试试下拉切换其他源`)
      }
      return
    }

    if (name === 'NotReadableError') {
      setError('摄像头被别的程序占用了 (Zoom / 腾讯会议 / OBS / FaceTime / 寻影 等). 关掉所有占用摄像头的 app 再试')
      return
    }

    setError(`获取摄像头失败 (${name}): ${e?.message || e}`)
  }

  // 挂载时枚举一次 — 给用户看 Chrome 默认能看到啥 (没授权前 label 是空, 但能知道数量)
  useEffect(() => {
    refreshCameras()
    // 用户插拔设备时也刷新
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshCameras)
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', refreshCameras)
  }, [])
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
  const startRecording = () => {
    setError('')
    if (!canvasRef.current) return
    const stream = canvasRef.current.captureStream(30)
    if (cameraStream) cameraStream.getAudioTracks().forEach(t => stream.addTrack(t))
    if (screenStream) screenStream.getAudioTracks().forEach(t => stream.addTrack(t))
    // 编码优先级: mp4 (浏览器原生支持时) → webm vp9 → webm vp8 → 默认 webm
    // Chrome 125+ / Safari 都支持 video/mp4;codecs=avc1, 直接出 mp4 不用后端转
    const mime = MediaRecorder.isTypeSupported('video/mp4;codecs=avc1,mp4a.40.2') ? 'video/mp4;codecs=avc1,mp4a.40.2'
      : MediaRecorder.isTypeSupported('video/mp4;codecs=avc1') ? 'video/mp4;codecs=avc1'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus') ? 'video/webm;codecs=vp8,opus'
      : 'video/webm'
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
  }
  const stopRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop()
  }
  const resetAll = () => {
    screenStream?.getTracks().forEach(t => t.stop())
    cameraStream?.getTracks().forEach(t => t.stop())
    setScreenStream(null); setCameraStream(null)
    if (recordedUrl) URL.revokeObjectURL(recordedUrl)
    setRecordedBlob(null); setRecordedUrl('')
    setPhase('setup')
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
          <p className="text-sm text-[var(--text-3)]">iOS Safari / 老版浏览器不行. 请用 PC / Android Chrome / Edge.</p>
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
                  <p className="text-[10px] text-[var(--text-3)]">提示: 标"推荐"是真实摄像头, 一般直接能用. 虚拟摄像头要对应 app (OBS/寻影/WebcastMate) 在跑才有画面</p>
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
                      浏览器一个摄像头都检测不到. 检查 USB 是否插好 / 系统隐私是否允许浏览器
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* === setup 阶段: 跟 WelcomeMessage 一模一样的布局: 头像 + 介绍 + 选项 grid === */}
          {phase === 'setup' && (
            <div className="flex items-start gap-3 msg-enter">
              <img src="/logo.png" alt="monoi" className="w-8 h-8 rounded-xl object-contain flex-shrink-0 mt-0.5"/>
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

              {/* recording 时, 一个超大显眼的浮动停止按钮 + 计时 (用户找不到底部 toolbar 也能直接停) */}
              {phase === 'recording' && (
                <div className="flex items-center justify-center gap-3 sticky bottom-4 z-50">
                  <div className="flex items-center gap-2 bg-red-500 text-white px-4 py-2 rounded-full font-medium text-sm shadow-lg">
                    <span className="w-2 h-2 rounded-full bg-white animate-pulse"/>
                    录制中 {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
                  </div>
                  <button onClick={stopRecording}
                    className="flex items-center gap-2 bg-[var(--text)] text-[var(--bg)] px-5 py-2 rounded-full font-medium text-sm hover:opacity-80 cursor-pointer shadow-lg">
                    <Square size={14} fill="currentColor"/> 停止录制
                  </button>
                </div>
              )}
              {phase === 'previewing' && (bgMode === 'screen') && (
                <div className="rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-900/50 p-3 text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                  <div className="font-medium mb-1.5 flex items-center gap-1.5">💡 避免画面"套娃" 的 3 步操作</div>
                  <ol className="list-decimal list-inside space-y-1 pl-1">
                    <li>录之前先打开你要讲的东西 (PPT / Keynote / Word / Notion / VS Code 等), <b>不能是浏览器</b></li>
                    <li>回 monoi 点底部 🖥️ 屏幕 → 浏览器弹"选择共享" 窗口</li>
                    <li>选 <b>"应用窗口"</b> tab → 找你刚开的那个 app, <b>千万不要选 Chrome / Edge / monoi</b></li>
                  </ol>
                  <p className="mt-2 text-[10px] opacity-80">为啥不能选浏览器: Chrome 里是 monoi, monoi canvas 又显示 Chrome → 无限套娃, 录出来啥也看不清.</p>
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
                  .webm 格式. 想转 mp4 用剪映 / FFmpeg 导一下. 后续会加自动转 mp4 + 直接进口播剪辑.
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
              <span className="flex-1 text-sm text-[var(--text-3)]">点上面选一种录法, 或下面图标单独授权</span>
            )}
            {phase === 'previewing' && (
              <>
                <span className="flex-1 text-sm text-[var(--text-2)]">画面已就绪, 点 → 开始录制</span>
                <button onClick={startRecording}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-medium cursor-pointer">
                  <span className="w-2 h-2 rounded-full bg-white"/> 开始录制
                </button>
              </>
            )}
            {phase === 'recording' && (
              <>
                <span className="flex-1 text-sm text-red-500 font-medium flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"/>
                  录制中 {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
                </span>
                <button onClick={stopRecording}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[var(--text)] text-[var(--bg)] text-sm font-medium hover:opacity-80 cursor-pointer">
                  <Square size={12} fill="currentColor"/> 停止
                </button>
              </>
            )}
            {phase === 'done' && (
              <>
                <span className="flex-1 text-sm text-green-500 font-medium">✓ 录制完成</span>
                <button onClick={downloadVideo}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[var(--text)] text-[var(--bg)] text-sm hover:opacity-80 cursor-pointer">
                  <Download size={12}/> 下载
                </button>
                <button onClick={resetAll}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--border)] text-[var(--text-2)] text-sm hover:bg-[var(--bg-hover)] cursor-pointer">
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
