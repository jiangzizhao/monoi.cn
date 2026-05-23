// Phase 3 录屏 MVP — 浏览器原生 getDisplayMedia + getUserMedia + Canvas 混合.
// 屏幕 = 主画面, 摄像头 = PIP (圆/方角, 9 宫格位置, 大小可调).
// MediaRecorder 输出 webm. iOS Safari 不支持 getDisplayMedia (会提示用 Chrome).
//
// Phase 4 Electron 版会加 鼠标跟踪 zoom + 运动模糊 (PixiJS), 这里先不做.

import { useEffect, useRef, useState } from 'react'
import { Video, Camera, Square, Download, ArrowRight, AlertCircle, RotateCcw } from 'lucide-react'

type Phase = 'setup' | 'previewing' | 'recording' | 'done'
type PipShape = 'circle' | 'rounded' | 'square'
type PipPos = 'tl' | 'tc' | 'tr' | 'cl' | 'cc' | 'cr' | 'bl' | 'bc' | 'br'

const POS_LABEL: Record<PipPos, string> = {
  tl: '左上', tc: '上中', tr: '右上',
  cl: '左中', cc: '正中', cr: '右中',
  bl: '左下', bc: '下中', br: '右下',
}

export default function RecordTab() {
  const [phase, setPhase] = useState<Phase>('setup')
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null)
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null)
  const [pipShape, setPipShape] = useState<PipShape>('circle')
  const [pipPos, setPipPos] = useState<PipPos>('br')
  const [pipSize, setPipSize] = useState(25)   // % of canvas height
  const [elapsed, setElapsed] = useState(0)
  const [recordedUrl, setRecordedUrl] = useState<string>('')
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [error, setError] = useState('')

  // Off-screen videos (从 stream 拿帧到 canvas)
  const screenVideoRef = useRef<HTMLVideoElement | null>(null)
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null)
  // 可见 canvas — composit 屏幕 + PIP
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // requestAnimationFrame id
  const rafRef = useRef<number>(0)
  // MediaRecorder + chunks
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  // 检测 iOS Safari — getDisplayMedia 不支持
  const isUnsupported = typeof navigator !== 'undefined'
    && !(navigator.mediaDevices?.getDisplayMedia)

  // 当 stream 变化时, 重设到 off-screen video element
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

  // 监听屏幕被用户主动停止共享 (浏览器底部 "停止共享" 按钮)
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

  // 进 previewing/recording → 启动 canvas composit 循环
  useEffect(() => {
    if (phase !== 'previewing' && phase !== 'recording') return
    if (!canvasRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const draw = () => {
      const screenV = screenVideoRef.current
      const cameraV = cameraVideoRef.current
      if (!screenV || screenV.videoWidth === 0) {
        rafRef.current = requestAnimationFrame(draw)
        return
      }
      // 画布大小 = 屏幕分辨率
      if (canvas.width !== screenV.videoWidth) canvas.width = screenV.videoWidth
      if (canvas.height !== screenV.videoHeight) canvas.height = screenV.videoHeight
      // 1. 画屏幕
      ctx.drawImage(screenV, 0, 0, canvas.width, canvas.height)
      // 2. 画 PIP 摄像头 (如果有)
      if (cameraV && cameraV.videoWidth > 0) {
        const pipH = (canvas.height * pipSize) / 100
        const pipW = (pipH * cameraV.videoWidth) / cameraV.videoHeight
        const padding = canvas.width * 0.02
        // 位置: 9 宫格
        let x = padding, y = padding
        if (pipPos[1] === 'c') x = (canvas.width - pipW) / 2
        else if (pipPos[1] === 'r') x = canvas.width - pipW - padding
        if (pipPos[0] === 'c') y = (canvas.height - pipH) / 2
        else if (pipPos[0] === 'b') y = canvas.height - pipH - padding
        // 形状 clip
        ctx.save()
        if (pipShape === 'circle') {
          ctx.beginPath()
          ctx.ellipse(x + pipW / 2, y + pipH / 2, pipW / 2, pipH / 2, 0, 0, Math.PI * 2)
          ctx.clip()
        } else if (pipShape === 'rounded') {
          const r = Math.min(pipW, pipH) * 0.15
          roundRect(ctx, x, y, pipW, pipH, r)
          ctx.clip()
        } // square 不 clip
        ctx.drawImage(cameraV, x, y, pipW, pipH)
        ctx.restore()
        // PIP 边框
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'
        ctx.lineWidth = Math.max(3, canvas.width / 400)
        if (pipShape === 'circle') {
          ctx.beginPath()
          ctx.ellipse(x + pipW / 2, y + pipH / 2, pipW / 2, pipH / 2, 0, 0, Math.PI * 2)
          ctx.stroke()
        } else if (pipShape === 'rounded') {
          const r = Math.min(pipW, pipH) * 0.15
          roundRect(ctx, x, y, pipW, pipH, r)
          ctx.stroke()
        } else {
          ctx.strokeRect(x, y, pipW, pipH)
        }
      }
      rafRef.current = requestAnimationFrame(draw)
    }
    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [phase, pipShape, pipPos, pipSize])

  // 录制中 elapsed 计时
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
      const s = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: true,  // 部分浏览器支持捕获标签页/系统音, 用户选时勾"分享音频"
      })
      setScreenStream(s)
      // 如果摄像头也有了, 自动进 previewing
      if (cameraStream) setPhase('previewing')
    } catch (e: any) {
      if (e.name === 'NotAllowedError') setError('你拒绝了屏幕共享权限. 录屏需要你授权')
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
      if (screenStream) setPhase('previewing')
    } catch (e: any) {
      if (e.name === 'NotAllowedError') setError('你拒绝了摄像头/麦克风权限.')
      else setError(`获取摄像头失败: ${e.message || e}`)
    }
  }

  const startRecording = () => {
    setError('')
    if (!canvasRef.current) return
    // captureStream from canvas (video only) + 加 audio tracks
    const stream = canvasRef.current.captureStream(30)
    // 加摄像头麦克风音轨
    if (cameraStream) {
      cameraStream.getAudioTracks().forEach(t => stream.addTrack(t))
    }
    // 加屏幕音轨 (用户分享时勾了"分享音频" 才有)
    if (screenStream) {
      screenStream.getAudioTracks().forEach(t => stream.addTrack(t))
    }
    // 优选 vp9, 兜底 vp8 / 默认
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
      ? 'video/webm;codecs=vp8,opus'
      : 'video/webm'
    chunksRef.current = []
    const rec = new MediaRecorder(stream, { mimeType: mime })
    rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mime })
      const url = URL.createObjectURL(blob)
      setRecordedBlob(blob)
      setRecordedUrl(url)
      setPhase('done')
    }
    rec.start(1000)  // 每 1s 切一片
    recorderRef.current = rec
    setPhase('recording')
  }

  const stopRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop()
    }
  }

  const resetAll = () => {
    // 关掉所有 stream
    screenStream?.getTracks().forEach(t => t.stop())
    cameraStream?.getTracks().forEach(t => t.stop())
    setScreenStream(null)
    setCameraStream(null)
    if (recordedUrl) URL.revokeObjectURL(recordedUrl)
    setRecordedBlob(null)
    setRecordedUrl('')
    setPhase('setup')
  }

  const downloadVideo = () => {
    if (!recordedBlob) return
    const a = document.createElement('a')
    a.href = recordedUrl
    a.download = `monoi-record-${Date.now()}.webm`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }

  // 卸载清理
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
          <p className="text-sm text-[var(--text-3)]">
            iOS Safari / 老版本浏览器不支持 screen capture API. 请用 PC / 安卓的 Chrome / Edge.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--bg-chat)]">
      {/* off-screen videos (hidden, 只给 canvas 取帧用) */}
      <video ref={screenVideoRef} className="hidden" muted playsInline/>
      <video ref={cameraVideoRef} className="hidden" muted playsInline/>

      <div className="max-w-3xl mx-auto px-4 py-6 flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Video size={20} className="text-[var(--text)]"/>
          <h1 className="text-lg font-semibold">录屏 · 屏幕 + 人物 PIP</h1>
        </div>

        {error && (
          <div className="text-sm text-red-400 bg-red-950/20 border border-red-900/30 rounded-lg px-3 py-2 flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5 flex-shrink-0"/>
            <span>{error}</span>
          </div>
        )}

        {/* === setup 阶段: 选源 + PIP 设置 === */}
        {phase === 'setup' && (
          <>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 flex flex-col gap-3">
              <div className="text-xs font-medium text-[var(--text-2)]">第一步: 授权摄像头 + 屏幕</div>
              <div className="flex flex-col sm:flex-row gap-2">
                <button onClick={requestCamera}
                  className={`flex-1 flex items-center gap-2 px-4 py-3 rounded-xl border text-sm transition-colors cursor-pointer ${
                    cameraStream ? 'border-green-500 bg-green-500/10 text-green-500' : 'border-[var(--border)] hover:bg-[var(--bg-hover)]'
                  }`}>
                  <Camera size={16}/>
                  <span className="flex-1 text-left">{cameraStream ? '✓ 摄像头已授权' : '授权摄像头 + 麦克风'}</span>
                </button>
                <button onClick={requestScreen}
                  className={`flex-1 flex items-center gap-2 px-4 py-3 rounded-xl border text-sm transition-colors cursor-pointer ${
                    screenStream ? 'border-green-500 bg-green-500/10 text-green-500' : 'border-[var(--border)] hover:bg-[var(--bg-hover)]'
                  }`}>
                  <Video size={16}/>
                  <span className="flex-1 text-left">{screenStream ? '✓ 屏幕已授权' : '选择屏幕 / 窗口'}</span>
                </button>
              </div>
              <p className="text-[11px] text-[var(--text-3)]">
                提示: 屏幕共享时勾"分享音频"可同时录系统/标签页声音 (Chrome 支持).
              </p>
            </div>
          </>
        )}

        {/* === previewing/recording 阶段: 实时画布 + PIP 调节 === */}
        {(phase === 'previewing' || phase === 'recording') && (
          <>
            <div className="rounded-2xl border border-[var(--border)] bg-black overflow-hidden">
              <canvas ref={canvasRef} className="w-full h-auto block max-h-[60vh] object-contain"/>
            </div>

            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 flex flex-col gap-3">
              <div className="text-xs font-medium text-[var(--text-2)]">PIP 设置</div>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="text-[var(--text-3)]">形状:</span>
                {(['circle', 'rounded', 'square'] as PipShape[]).map(s => (
                  <button key={s} onClick={() => setPipShape(s)}
                    className={`px-3 py-1 rounded-lg border text-xs cursor-pointer transition-colors ${
                      pipShape === s ? 'border-[var(--text)] bg-[var(--text)] text-[var(--bg)]' : 'border-[var(--border)] text-[var(--text-2)]'
                    }`}>
                    {s === 'circle' ? '圆' : s === 'rounded' ? '圆角方' : '直角方'}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-[var(--text-3)]">大小:</span>
                <input type="range" min={10} max={45} value={pipSize} onChange={e => setPipSize(Number(e.target.value))}
                  className="flex-1 max-w-xs"/>
                <span className="font-mono text-[var(--text-2)] w-12 text-right">{pipSize}%</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-[var(--text-3)]">位置:</span>
                <div className="grid grid-cols-3 gap-1.5 w-24">
                  {(['tl','tc','tr','cl','cc','cr','bl','bc','br'] as PipPos[]).map(p => (
                    <button key={p} onClick={() => setPipPos(p)}
                      title={POS_LABEL[p]}
                      className={`aspect-square rounded border text-xs cursor-pointer transition-colors ${
                        pipPos === p ? 'border-[var(--text)] bg-[var(--text)]' : 'border-[var(--border)] hover:bg-[var(--bg-hover)]'
                      }`}/>
                  ))}
                </div>
              </div>
            </div>

            {/* 录制控制 */}
            <div className="flex items-center justify-center gap-3 py-2">
              {phase === 'previewing' && (
                <button onClick={startRecording}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-medium cursor-pointer transition-colors">
                  <span className="w-2.5 h-2.5 rounded-full bg-white"/>
                  开始录制
                </button>
              )}
              {phase === 'recording' && (
                <>
                  <div className="flex items-center gap-2 text-sm text-red-500 font-medium">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"/>
                    录制中 {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
                  </div>
                  <button onClick={stopRecording}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--text)] text-[var(--bg)] text-sm font-medium hover:opacity-80 cursor-pointer transition-opacity">
                    <Square size={14} fill="currentColor"/>
                    停止
                  </button>
                </>
              )}
              <button onClick={resetAll}
                className="px-4 py-2.5 rounded-xl border border-[var(--border)] text-[var(--text-2)] text-sm hover:bg-[var(--bg-hover)] cursor-pointer transition-colors">
                <RotateCcw size={14} className="inline mr-1"/> 重选
              </button>
            </div>
            <p className="text-[11px] text-[var(--text-3)] text-center">
              建议录制不超过 5 分钟 (浏览器内存压力). Phase 4 桌面客户端版无此限制.
            </p>
          </>
        )}

        {/* === done 阶段: 预览 + 下载 + 进 monoi 流程 === */}
        {phase === 'done' && recordedUrl && (
          <>
            <div className="rounded-2xl border border-[var(--border)] bg-black overflow-hidden">
              <video src={recordedUrl} controls className="w-full max-h-[60vh] block"/>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 flex flex-col gap-3">
              <div className="text-xs text-[var(--text-2)]">
                录制完成 · 时长 {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')} ·
                文件大小 {recordedBlob ? `${(recordedBlob.size / 1024 / 1024).toFixed(1)} MB` : ''}
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={downloadVideo}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[var(--text)] text-[var(--bg)] text-sm hover:opacity-80 cursor-pointer">
                  <Download size={14}/> 下载 webm
                </button>
                <button
                  onClick={() => alert('Phase 3 阶段二: 录完直接进口播剪辑流程 (TODO)')}
                  disabled
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-[var(--border)] text-[var(--text-3)] text-sm cursor-not-allowed opacity-60">
                  <ArrowRight size={14}/> 进口播剪辑 (待接入)
                </button>
                <button onClick={resetAll}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-[var(--border)] text-[var(--text-2)] text-sm hover:bg-[var(--bg-hover)] cursor-pointer">
                  <RotateCcw size={14}/> 重录
                </button>
              </div>
              <p className="text-[11px] text-[var(--text-3)]">
                .webm 是浏览器原生录像格式. 想转 mp4 用剪映 / FFmpeg 导一下 (后续会加自动转 mp4).
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** ctx 圆角矩形 path — old 浏览器没 roundRect, 自己画 */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
