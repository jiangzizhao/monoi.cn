import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Upload, X } from 'lucide-react'
import { NarrationVideoEditor } from '../NarrationVideoEditor'

interface Props {
  onSubmit: (message: string) => void
  onClose: () => void
}

type Phase = 'idle' | 'uploading' | 'editing'

const ACCEPTED_FORMATS = 'video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,video/webm,video/*'

export function NarrationVideoForm({ onSubmit, onClose }: Props) {
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState(0)
  const [statusMsg, setStatusMsg] = useState('')
  const [error, setError] = useState('')
  const [cleanResult, setCleanResult] = useState<any>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const directBase = import.meta.env.VITE_DIRECT_API_URL || 'https://monoi.nat100.top'

  const handleUpload = async () => {
    if (!videoFile) {
      setError('请选择视频文件')
      return
    }
    setPhase('uploading')
    setError('')
    setProgress(0)
    setStatusMsg('正在上传 + 转录...')
    try {
      const fd = new FormData()
      fd.append('file', videoFile)
      const res = await fetch(directBase + '/api/voice/clean-narration-video', {
        method: 'POST',
        body: fd,
      })
      const text = await res.text()
      let data: any
      try { data = JSON.parse(text) } catch { data = { error: text.slice(0, 200) } }
      if (!res.ok || !data.success) {
        setError(data.detail || data.error || `处理失败 (HTTP ${res.status})`)
        setPhase('idle')
        return
      }
      // 把相对路径补成完整 URL 给 video tag 用
      if (data.video_url_path && data.video_url_path.startsWith('/')) {
        data.video_url_full = directBase + data.video_url_path
      }
      setCleanResult(data)
      setPhase('editing')
    } catch (e: any) {
      setError(e?.message || '网络错误')
      setPhase('idle')
    }
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

  const isBusy = phase === 'uploading'
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
              <div className="text-sm text-[var(--text)]">{statusMsg}</div>
              <div className="w-full max-w-xs">
                <div className="h-1.5 rounded-full bg-[var(--bg-hover)] overflow-hidden">
                  <div className="h-full bg-[var(--text)] transition-all" style={{ width: `${Math.max(progress, 8)}%` }}/>
                </div>
              </div>
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
