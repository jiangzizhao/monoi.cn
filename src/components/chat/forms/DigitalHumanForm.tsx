import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Upload, X } from 'lucide-react'

interface Props {
  onSubmit: (message: string) => void
  onClose: () => void
}

type Phase = 'idle' | 'submitting' | 'processing' | 'completed' | 'failed'

interface TaskResp {
  success: boolean
  status: 'processing' | 'completed' | 'failed' | 'unknown'
  progress?: number
  msg?: string
  video_url?: string
  duration_ms?: number
  width?: number
  height?: number
}

const POLL_INTERVAL_MS = 3000
const MAX_POLL_TICKS = 200    // 200 * 3s = 10 min 上限

export function DigitalHumanForm({ onSubmit, onClose }: Props) {
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState(0)
  const [statusMsg, setStatusMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [resultUrl, setResultUrl] = useState('')
  const [resultMeta, setResultMeta] = useState<{ duration_ms?: number; width?: number; height?: number }>({})
  const pollTimerRef = useRef<number | null>(null)
  const pollTicksRef = useRef(0)
  const codeRef = useRef('')

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }
  }, [])

  const stopPolling = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }

  const startPolling = (code: string) => {
    pollTicksRef.current = 0
    codeRef.current = code
    setPhase('processing')
    setStatusMsg('正在生成口型视频...')
    pollTimerRef.current = window.setInterval(async () => {
      pollTicksRef.current += 1
      if (pollTicksRef.current > MAX_POLL_TICKS) {
        stopPolling()
        setPhase('failed')
        setErrorMsg('合成超时,请重试')
        return
      }
      try {
        const r = await fetch('/api/proxy?path=' + encodeURIComponent('/api/digital-human/task/' + code))
        const data: TaskResp = await r.json()
        if (data.status === 'completed' && data.video_url) {
          stopPolling()
          setProgress(100)
          setStatusMsg('完成')
          setResultUrl(data.video_url)
          setResultMeta({
            duration_ms: data.duration_ms,
            width: data.width,
            height: data.height,
          })
          setPhase('completed')
          return
        }
        if (data.status === 'failed') {
          stopPolling()
          setPhase('failed')
          setErrorMsg(data.msg || '合成失败')
          return
        }
        if (data.status === 'processing') {
          setProgress(data.progress ?? 0)
          if (data.msg) setStatusMsg(data.msg)
        }
      } catch (e: any) {
        // 网络错误不停轮询,稍后重试
      }
    }, POLL_INTERVAL_MS)
  }

  const handleSubmit = async () => {
    if (!audioFile || !videoFile) {
      setErrorMsg('请同时选择音频和形象视频')
      return
    }
    setErrorMsg('')
    setPhase('submitting')
    setProgress(0)
    setStatusMsg('正在上传...')

    const fd = new FormData()
    fd.append('audio', audioFile)
    fd.append('video', videoFile)

    try {
      // 大文件直传 NATAPP, 绕开 Vercel 4.5MB 限制
      const directBase = import.meta.env.VITE_DIRECT_API_URL || 'https://monoi.nat100.top'
      const res = await fetch(directBase + '/api/digital-human/submit', {
        method: 'POST',
        body: fd,
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        setPhase('failed')
        setErrorMsg(data.detail || data.error || '提交失败')
        return
      }
      startPolling(data.code)
    } catch (e: any) {
      setPhase('failed')
      setErrorMsg(e?.message || '网络错误')
    }
  }

  const handleUseVideo = () => {
    const payload = {
      video_url: resultUrl,
      duration_ms: resultMeta.duration_ms,
      width: resultMeta.width,
      height: resultMeta.height,
      audio_label: audioFile?.name?.replace(/\.[^.]+$/, '') || '数字人',
      source: 'digital_human' as const,
    }
    onSubmit('__digital_human_video__' + JSON.stringify(payload))
  }

  const handleRetry = () => {
    setPhase('idle')
    setProgress(0)
    setStatusMsg('')
    setErrorMsg('')
    setResultUrl('')
    setResultMeta({})
    codeRef.current = ''
  }

  const isBusy = phase === 'submitting' || phase === 'processing'
  const previewBase = import.meta.env.VITE_DIRECT_API_URL || 'https://monoi.nat100.top'
  const previewUrl = resultUrl ? previewBase + resultUrl : ''

  const modal = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative bg-[var(--bg-card)] border border-[var(--border)] rounded-[22px] shadow-ios-lg w-full max-w-lg max-h-[85vh] flex flex-col sheet-enter"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div className="text-base font-semibold text-[var(--text)]">
            口播 · 数字人
          </div>
          <button
            onClick={onClose}
            disabled={isBusy}
            className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
              isBusy
                ? 'text-[var(--text-3)] cursor-not-allowed'
                : 'text-[var(--text-2)] hover:bg-[var(--bg-hover)] cursor-pointer'
            }`}
            title="关闭"
          >
            <X size={16}/>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {phase === 'idle' || phase === 'failed' ? (
            <div className="flex flex-col gap-4">
              <p className="text-xs text-[var(--text-3)] leading-relaxed">
                上传一段你的<b className="text-[var(--text-2)]">形象视频</b>(5-30 秒,正脸,嘴巴有动)和<b className="text-[var(--text-2)]">音频</b>,自动对口型生成数字人视频。
              </p>

              <FileSlot
                label="形象视频"
                hint="MP4 推荐 5-30 秒,正脸,1080p 以内"
                accept="video/mp4,video/*"
                file={videoFile}
                onChange={setVideoFile}
              />

              <FileSlot
                label="音频"
                hint="WAV 或 MP3, 时长决定输出视频时长"
                accept="audio/wav,audio/mpeg,audio/*"
                file={audioFile}
                onChange={setAudioFile}
              />

              {errorMsg && (
                <div className="text-xs text-red-400 bg-red-950/20 border border-red-900/30 rounded-lg px-3 py-2">
                  {errorMsg}
                </div>
              )}

              <p className="text-[11px] text-[var(--text-3)] leading-relaxed">
                💡 输出视频时长 = 音频时长。视频只是形象参考,会自动循环。
              </p>
            </div>
          ) : phase === 'submitting' || phase === 'processing' ? (
            <div className="flex flex-col items-center justify-center gap-4 py-8">
              <Loader2 size={36} className="animate-spin text-[var(--text-2)]"/>
              <div className="text-sm text-[var(--text)]">{statusMsg}</div>
              <div className="w-full max-w-xs">
                <div className="h-1.5 rounded-full bg-[var(--bg-hover)] overflow-hidden">
                  <div
                    className="h-full bg-[var(--text)] transition-all"
                    style={{ width: `${Math.max(progress, phase === 'submitting' ? 5 : 0)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between mt-1.5 text-xs text-[var(--text-3)]">
                  <span>{phase === 'submitting' ? '上传中' : '推理中'}</span>
                  <span>{progress}%</span>
                </div>
              </div>
              <p className="text-[11px] text-[var(--text-3)]">
                通常 30 秒 - 2 分钟,看音频长度。请勿关闭此窗口。
              </p>
            </div>
          ) : (
            // completed
            <div className="flex flex-col gap-4">
              <div className="rounded-xl overflow-hidden bg-black">
                <video
                  src={previewUrl}
                  controls
                  playsInline
                  className="w-full max-h-[360px] object-contain"
                />
              </div>
              <div className="flex items-center justify-between text-xs text-[var(--text-3)]">
                <span>
                  {resultMeta.width && resultMeta.height ? `${resultMeta.width}×${resultMeta.height}` : ''}
                </span>
                <span>
                  {resultMeta.duration_ms ? `${(resultMeta.duration_ms / 1000).toFixed(1)}s` : ''}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--border)]">
          {phase === 'idle' && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-[var(--text-2)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={handleSubmit}
                disabled={!audioFile || !videoFile}
                className={`px-4 py-2 text-sm rounded-lg transition-all cursor-pointer ${
                  audioFile && videoFile
                    ? 'bg-[var(--text)] text-[var(--bg)] hover:opacity-80'
                    : 'bg-[var(--bg-hover)] text-[var(--text-3)] cursor-not-allowed'
                }`}
              >
                开始生成
              </button>
            </>
          )}

          {phase === 'failed' && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-[var(--text-2)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={handleRetry}
                className="px-4 py-2 text-sm bg-[var(--text)] text-[var(--bg)] hover:opacity-80 rounded-lg transition-colors cursor-pointer"
              >
                重试
              </button>
            </>
          )}

          {phase === 'completed' && (
            <>
              <button
                onClick={handleRetry}
                className="px-4 py-2 text-sm text-[var(--text-2)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors cursor-pointer"
              >
                重新生成
              </button>
              <button
                onClick={handleUseVideo}
                className="px-4 py-2 text-sm bg-[var(--text)] text-[var(--bg)] hover:opacity-80 rounded-lg transition-colors cursor-pointer"
              >
                使用这段视频
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}

function FileSlot({
  label,
  hint,
  accept,
  file,
  onChange,
}: {
  label: string
  hint: string
  accept: string
  file: File | null
  onChange: (f: File | null) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div>
      <div className="text-xs font-medium text-[var(--text-2)] mb-1.5">{label}</div>
      <div
        onClick={() => inputRef.current?.click()}
        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
          file
            ? 'border-[var(--text-3)] bg-[var(--bg-hover)]'
            : 'border-[var(--border)] hover:bg-[var(--bg-hover)]'
        }`}
      >
        <Upload size={14} className="text-[var(--text-3)] flex-shrink-0"/>
        <div className="flex-1 min-w-0">
          {file ? (
            <>
              <div className="text-sm text-[var(--text)] truncate">{file.name}</div>
              <div className="text-[11px] text-[var(--text-3)]">{(file.size / 1024 / 1024).toFixed(2)} MB</div>
            </>
          ) : (
            <>
              <div className="text-sm text-[var(--text-2)]">点击选择文件</div>
              <div className="text-[11px] text-[var(--text-3)]">{hint}</div>
            </>
          )}
        </div>
        {file && (
          <button
            onClick={(e) => { e.stopPropagation(); onChange(null) }}
            className="text-[11px] text-[var(--text-3)] hover:text-[var(--text)] px-2 py-1 rounded hover:bg-[var(--bg-input)]"
          >
            移除
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0] || null
          onChange(f)
          // 允许重选同一文件
          if (inputRef.current) inputRef.current.value = ''
        }}
      />
    </div>
  )
}
