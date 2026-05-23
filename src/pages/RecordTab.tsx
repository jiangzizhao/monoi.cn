// 录屏 tab — 布局跟创作 tab 一致: 头部 monoi 头像 + 选项 grid + 底部工具栏 + 大按钮.
// 用户授权摄像头 + 屏幕后进 preview, 显示 canvas + PIP 设置 + 录制控制.
//
// 浏览器原生 getDisplayMedia + getUserMedia + Canvas 混合.
// 输出 webm. iOS Safari 不支持 (显示提示).

import { useEffect, useRef, useState } from 'react'
import { Camera, Monitor, Mic, Square, Download, AlertCircle, RotateCcw, Settings, Video } from 'lucide-react'

type Phase = 'setup' | 'previewing' | 'recording' | 'done'
type PipShape = 'circle' | 'rounded' | 'square'
type PipPos = 'tl' | 'tc' | 'tr' | 'cl' | 'cc' | 'cr' | 'bl' | 'bc' | 'br'

const RECORD_PRESETS = [
  { id: 'screen_camera', label: '屏幕 + 人物 PIP', desc: '主流方案. 屏幕作背景, 摄像头圆形 PIP 叠加' },
  { id: 'screen_only',   label: '仅屏幕',         desc: '只录屏幕, 无人物 (适合纯演示)' },
  { id: 'camera_only',   label: '仅摄像头',       desc: '只录自己, 没屏幕 (适合 vlog)' },
  { id: 'window_camera', label: '单窗口 + PIP',    desc: '只录一个窗口 (如 PPT), 摄像头 PIP' },
]

export default function RecordTab() {
  const [phase, setPhase] = useState<Phase>('setup')
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null)
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null)
  const [pipShape, setPipShape] = useState<PipShape>('circle')
  const [pipPos, setPipPos] = useState<PipPos>('br')
  const [pipSize, setPipSize] = useState(25)
  const [showPipSettings, setShowPipSettings] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [recordedUrl, setRecordedUrl] = useState<string>('')
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [error, setError] = useState('')

  const screenVideoRef = useRef<HTMLVideoElement | null>(null)
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

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

  // canvas composit 循环
  useEffect(() => {
    if (phase !== 'previewing' && phase !== 'recording') return
    if (!canvasRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const draw = () => {
      const screenV = screenVideoRef.current
      const cameraV = cameraVideoRef.current
      // 屏幕 + 摄像头 都没 → 仅摄像头模式
      if (screenV && screenV.videoWidth > 0) {
        if (canvas.width !== screenV.videoWidth) canvas.width = screenV.videoWidth
        if (canvas.height !== screenV.videoHeight) canvas.height = screenV.videoHeight
        ctx.drawImage(screenV, 0, 0, canvas.width, canvas.height)
        if (cameraV && cameraV.videoWidth > 0) drawPip(ctx, canvas, cameraV, pipShape, pipPos, pipSize)
      } else if (cameraV && cameraV.videoWidth > 0) {
        // 仅摄像头模式
        if (canvas.width !== cameraV.videoWidth) canvas.width = cameraV.videoWidth
        if (canvas.height !== cameraV.videoHeight) canvas.height = cameraV.videoHeight
        ctx.drawImage(cameraV, 0, 0, canvas.width, canvas.height)
      }
      rafRef.current = requestAnimationFrame(draw)
    }
    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [phase, pipShape, pipPos, pipSize])

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
      setScreenStream(s)
      if (cameraStream || (!cameraStream && phase === 'setup')) setPhase('previewing')
    } catch (e: any) {
      if (e.name === 'NotAllowedError') setError('你拒绝了屏幕共享权限')
      else setError(`获取屏幕失败: ${e.message || e}`)
    }
  }
  const requestCamera = async () => {
    setError('')
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: { echoCancellation: true, noiseSuppression: true },
      })
      setCameraStream(s)
      if (screenStream || phase === 'setup') setPhase('previewing')
    } catch (e: any) {
      if (e.name === 'NotAllowedError') setError('你拒绝了摄像头/麦克风权限')
      else setError(`获取摄像头失败: ${e.message || e}`)
    }
  }
  const onPresetPick = async (preset: string) => {
    setError('')
    if (preset === 'screen_camera' || preset === 'window_camera') {
      await requestCamera()
      await requestScreen()
    } else if (preset === 'screen_only') {
      await requestScreen()
    } else if (preset === 'camera_only') {
      await requestCamera()
    }
  }
  const startRecording = () => {
    setError('')
    if (!canvasRef.current) return
    const stream = canvasRef.current.captureStream(30)
    if (cameraStream) cameraStream.getAudioTracks().forEach(t => stream.addTrack(t))
    if (screenStream) screenStream.getAudioTracks().forEach(t => stream.addTrack(t))
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus'
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
    const a = document.createElement('a')
    a.href = recordedUrl; a.download = `monoi-record-${Date.now()}.webm`
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
            <div className="text-sm text-red-400 bg-red-950/20 border border-red-900/30 rounded-lg px-3 py-2 flex items-start gap-2">
              <AlertCircle size={14} className="mt-0.5 flex-shrink-0"/><span>{error}</span>
            </div>
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

          {/* === previewing / recording: canvas + 进度 === */}
          {(phase === 'previewing' || phase === 'recording') && (
            <div className="flex flex-col gap-3">
              <div className="rounded-2xl border border-[var(--border)] bg-black overflow-hidden">
                <canvas ref={canvasRef} className="w-full h-auto block max-h-[55vh] object-contain"/>
              </div>
              {phase === 'recording' && (
                <div className="flex items-center justify-center gap-2 text-sm text-red-500 font-medium">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"/>
                  录制中 {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
                </div>
              )}

              {showPipSettings && (
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 flex flex-col gap-3 msg-enter">
                  <div className="text-xs font-medium text-[var(--text-2)]">PIP 设置</div>
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
            <button onClick={requestCamera} disabled={!!cameraStream || phase === 'recording'}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${cameraStream ? 'text-green-500' : 'text-[var(--text-3)] hover:text-[var(--text-2)] hover:bg-[var(--bg-hover)]'}`}
              title="摄像头 + 麦克风">
              <Camera size={14}/> 摄像头
            </button>
            <button onClick={requestScreen} disabled={!!screenStream || phase === 'recording'}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${screenStream ? 'text-green-500' : 'text-[var(--text-3)] hover:text-[var(--text-2)] hover:bg-[var(--bg-hover)]'}`}
              title="选择屏幕 / 窗口">
              <Monitor size={14}/> 屏幕
            </button>
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs ${cameraStream ? 'text-green-500' : 'text-[var(--text-3)]'}`} title="麦克风跟摄像头一起授权">
              <Mic size={14}/> 麦克风
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

/** 在 canvas 上画 PIP 摄像头 — 形状 clip + 边框 */
function drawPip(
  ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, cameraV: HTMLVideoElement,
  shape: PipShape, pos: PipPos, sizePct: number,
) {
  const pipH = (canvas.height * sizePct) / 100
  const pipW = (pipH * cameraV.videoWidth) / cameraV.videoHeight
  const padding = canvas.width * 0.02
  let x = padding, y = padding
  if (pos[1] === 'c') x = (canvas.width - pipW) / 2
  else if (pos[1] === 'r') x = canvas.width - pipW - padding
  if (pos[0] === 'c') y = (canvas.height - pipH) / 2
  else if (pos[0] === 'b') y = canvas.height - pipH - padding
  ctx.save()
  if (shape === 'circle') {
    ctx.beginPath()
    ctx.ellipse(x + pipW / 2, y + pipH / 2, pipW / 2, pipH / 2, 0, 0, Math.PI * 2)
    ctx.clip()
  } else if (shape === 'rounded') {
    const r = Math.min(pipW, pipH) * 0.15
    roundRect(ctx, x, y, pipW, pipH, r)
    ctx.clip()
  }
  ctx.drawImage(cameraV, x, y, pipW, pipH)
  ctx.restore()
  // 边框
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'
  ctx.lineWidth = Math.max(3, canvas.width / 400)
  if (shape === 'circle') {
    ctx.beginPath()
    ctx.ellipse(x + pipW / 2, y + pipH / 2, pipW / 2, pipH / 2, 0, 0, Math.PI * 2)
    ctx.stroke()
  } else if (shape === 'rounded') {
    const r = Math.min(pipW, pipH) * 0.15
    roundRect(ctx, x, y, pipW, pipH, r)
    ctx.stroke()
  } else {
    ctx.strokeRect(x, y, pipW, pipH)
  }
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
