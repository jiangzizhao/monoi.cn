import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Upload, X } from 'lucide-react'
import { NarrationVideoEditor } from '../NarrationVideoEditor'

interface Props {
  onSubmit: (message: string) => void
  onClose: () => void
}

type Phase = 'idle' | 'uploading' | 'transcribing' | 'editing'

const ACCEPTED_FORMATS = 'video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,video/webm,video/*'

export function NarrationVideoForm({ onSubmit, onClose }: Props) {
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [videoDuration, setVideoDuration] = useState<number | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState(0)
  const [transcribeSec, setTranscribeSec] = useState(0)
  const [error, setError] = useState('')
  const [cleanResult, setCleanResult] = useState<any>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const directBase = import.meta.env.VITE_DIRECT_API_URL || 'https://monoi.nat100.top'

  // 选文件后, 用临时 video element 探测时长 (给转录进度估计用)
  useEffect(() => {
    if (!videoFile) {
      setVideoDuration(null)
      return
    }
    const url = URL.createObjectURL(videoFile)
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.onloadedmetadata = () => {
      setVideoDuration(v.duration)
      URL.revokeObjectURL(url)
    }
    v.onerror = () => { URL.revokeObjectURL(url) }
    v.src = url
  }, [videoFile])

  // transcribing 阶段计时器
  useEffect(() => {
    if (phase !== 'transcribing') {
      setTranscribeSec(0)
      return
    }
    const start = Date.now()
    const timer = window.setInterval(() => {
      setTranscribeSec(Math.round((Date.now() - start) / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [phase])

  // Whisper 估算: 5060 Ti small 模型 RTF 约 0.4
  const estimatedTranscribeSec = videoDuration ? Math.round(videoDuration * 0.4) : null

  const handleUpload = async () => {
    if (!videoFile) {
      setError('请选择视频文件')
      return
    }
    setPhase('uploading')
    setError('')
    setProgress(0)

    try {
      // 1. 找后端要 OSS PUT 签名 URL
      const signRes = await fetch(directBase + '/api/oss/sign-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: videoFile.name,
          content_type: videoFile.type || 'video/mp4',
        }),
      })
      if (!signRes.ok) {
        // OSS 没配 → 退回旧的走 NATAPP 上传
        if (signRes.status === 503) {
          uploadViaNatapp()
          return
        }
        const err = await signRes.text()
        throw new Error(`签名失败: ${err.slice(0, 200)}`)
      }
      const { put_url, oss_key, content_type } = await signRes.json()

      // 2. 浏览器直传 OSS (XHR 才能监听上传进度)
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setProgress(Math.round((e.loaded / e.total) * 100))
          }
        }
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            setProgress(100)
            resolve()
          } else {
            reject(new Error(`OSS 上传失败 (${xhr.status}): ${xhr.responseText.slice(0, 200)}`))
          }
        }
        xhr.onerror = () => reject(new Error('OSS 网络错误'))
        xhr.ontimeout = () => reject(new Error('OSS 上传超时'))
        xhr.timeout = 1200_000
        xhr.open('PUT', put_url)
        xhr.setRequestHeader('Content-Type', content_type)
        xhr.send(videoFile)
      })

      // 3. 上传完, 通知后端开始处理 (此时 NATAPP 只传一个 oss_key)
      setPhase('transcribing')
      const cleanRes = await fetch(directBase + '/api/voice/clean-narration-video-oss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oss_key, filename: videoFile.name }),
      })
      const data = await cleanRes.json()
      if (!cleanRes.ok || !data.success) {
        throw new Error(data.detail || data.error || `处理失败 (HTTP ${cleanRes.status})`)
      }
      // OSS 模式: video_url 已经是签名 GET URL, 直接用
      // 旧模式兼容: 拼 directBase + video_url_path
      if (!data.video_url_full && data.video_url_path?.startsWith('/')) {
        data.video_url_full = directBase + data.video_url_path
      }
      setCleanResult(data)
      setPhase('editing')
    } catch (e: any) {
      setError(e.message || '上传失败')
      setPhase('idle')
    }
  }

  // 兜底: OSS 没配的环境走老的 NATAPP 上传
  const uploadViaNatapp = () => {
    if (!videoFile) return
    const fd = new FormData()
    fd.append('file', videoFile)
    const xhr = new XMLHttpRequest()
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.upload.onload = () => { setProgress(100); setPhase('transcribing') }
    xhr.onload = () => {
      let data: any
      try { data = JSON.parse(xhr.responseText) } catch { data = { error: xhr.responseText.slice(0, 200) } }
      if (xhr.status >= 200 && xhr.status < 300 && data.success) {
        if (data.video_url_path?.startsWith('/')) data.video_url_full = directBase + data.video_url_path
        setCleanResult(data)
        setPhase('editing')
      } else {
        setError(data.detail || data.error || `处理失败 (HTTP ${xhr.status})`)
        setPhase('idle')
      }
    }
    xhr.onerror = () => { setError('网络错误,上传失败'); setPhase('idle') }
    xhr.ontimeout = () => { setError('请求超时'); setPhase('idle') }
    xhr.timeout = 1200_000
    xhr.open('POST', directBase + '/api/voice/clean-narration-video')
    xhr.send(fd)
  }

  const handleDone = (videoUrl: string, duration: number, transcription: string) => {
    onSubmit('__narration_video_done__' + JSON.stringify({
      video_url: videoUrl,
      duration_ms: Math.round(duration * 1000),
      transcription,
    }))
  }

  const handleResetUpload = () => {
    setVideoFile(null)
    setCleanResult(null)
    setPhase('idle')
    setError('')
  }

  const isBusy = phase === 'uploading' || phase === 'transcribing'
  const isEditing = phase === 'editing' && cleanResult

  const modal = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative bg-[var(--bg-card)] border border-[var(--border)] rounded-[22px] shadow-ios-lg w-full max-w-2xl max-h-[88vh] flex flex-col sheet-enter"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div className="text-base font-semibold text-[var(--text)]">口播 · 视频剪辑</div>
          <button
            onClick={onClose}
            disabled={isBusy}
            className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
              isBusy
                ? 'text-[var(--text-3)] cursor-not-allowed'
                : 'text-[var(--text-2)] hover:bg-[var(--bg-hover)] cursor-pointer'
            }`}
          >
            <X size={16}/>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {phase === 'idle' && (
            <div className="flex flex-col gap-4">
              <p className="text-xs text-[var(--text-3)] leading-relaxed">
                上传你录的<b className="text-[var(--text-2)]">口播视频</b>,系统自动:
              </p>
              <ul className="text-xs text-[var(--text-3)] leading-relaxed pl-4 -mt-2 space-y-1 list-disc">
                <li>转录字幕(词级时间戳)</li>
                <li>检测气口/长停顿/口误重复, 标记建议删除</li>
                <li>你逐词调整, 单击切删除 / 拖选删除</li>
                <li>点完成导出, 自动剪好新视频, 进入下一步选素材</li>
              </ul>

              <VideoUploadSlot
                file={videoFile}
                inputRef={inputRef}
                onChange={setVideoFile}
              />

              {error && (
                <div className="text-xs text-red-400 bg-red-950/20 border border-red-900/30 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}

              <p className="text-[11px] text-[var(--text-3)] leading-relaxed">
                💡 支持 mp4 / mov / avi / mkv / webm. 时长不限,但越长转录越久(Whisper 大约 1 分钟视频要 20-30 秒).
              </p>
            </div>
          )}

          {phase === 'uploading' && (
            <div className="flex flex-col items-center justify-center gap-4 py-10">
              <Loader2 size={36} className="animate-spin text-[var(--text-2)]"/>
              <div className="text-sm text-[var(--text)]">正在上传... {progress}%</div>
              <div className="w-full max-w-xs">
                <div className="h-1.5 rounded-full bg-[var(--bg-hover)] overflow-hidden">
                  <div className="h-full bg-[var(--text)] transition-all" style={{ width: `${Math.max(progress, 2)}%` }}/>
                </div>
              </div>
            </div>
          )}

          {phase === 'transcribing' && (
            <div className="flex flex-col items-center justify-center gap-4 py-10">
              <Loader2 size={36} className="animate-spin text-[var(--text-2)]"/>
              <div className="text-sm text-[var(--text)]">
                正在转录... {transcribeSec}s
                {estimatedTranscribeSec && (
                  <span className="text-[var(--text-3)]"> / 约 {estimatedTranscribeSec}s</span>
                )}
              </div>
              <div className="w-full max-w-xs">
                <div className="h-1.5 rounded-full bg-[var(--bg-hover)] overflow-hidden">
                  {estimatedTranscribeSec ? (
                    <div
                      className="h-full bg-[var(--text)] transition-all"
                      style={{ width: `${Math.min(100, Math.round((transcribeSec / estimatedTranscribeSec) * 100))}%` }}
                    />
                  ) : (
                    <div className="h-full bg-[var(--text)] animate-pulse" style={{ width: '100%' }}/>
                  )}
                </div>
              </div>
              {videoDuration && (
                <p className="text-[11px] text-[var(--text-3)]">
                  视频 {(videoDuration / 60).toFixed(1)} 分钟 · Whisper 转录大约 {estimatedTranscribeSec}s
                </p>
              )}
            </div>
          )}

          {isEditing && (
            <NarrationVideoEditor
              data={cleanResult}
              apiBase={directBase}
              onCancel={handleResetUpload}
              onDone={handleDone}
            />
          )}
        </div>

        {/* Footer (idle 阶段才显示, editing 自带按钮) */}
        {phase === 'idle' && (
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--border)]">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-[var(--text-2)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              onClick={handleUpload}
              disabled={!videoFile}
              className={`px-4 py-2 text-sm rounded-lg transition-all cursor-pointer ${
                videoFile
                  ? 'bg-[var(--text)] text-[var(--bg)] hover:opacity-80'
                  : 'bg-[var(--bg-hover)] text-[var(--text-3)] cursor-not-allowed'
              }`}
            >
              开始转录
            </button>
          </div>
        )}
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}

function VideoUploadSlot({
  file,
  inputRef,
  onChange,
}: {
  file: File | null
  inputRef: React.RefObject<HTMLInputElement | null>
  onChange: (f: File | null) => void
}) {
  return (
    <div>
      <div className="text-xs font-medium text-[var(--text-2)] mb-1.5">口播视频</div>
      <div
        onClick={() => inputRef.current?.click()}
        className={`flex items-center gap-3 px-3 py-3 rounded-lg border cursor-pointer transition-colors ${
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
              <div className="text-sm text-[var(--text-2)]">点击选择视频文件</div>
              <div className="text-[11px] text-[var(--text-3)]">mp4 / mov / avi / mkv / webm</div>
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
        accept={ACCEPTED_FORMATS}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0] || null
          onChange(f)
          if (inputRef.current) inputRef.current.value = ''
        }}
      />
    </div>
  )
}
