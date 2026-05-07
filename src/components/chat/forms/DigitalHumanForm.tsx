import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Upload, X, Play, Pause, AudioLines, Check } from 'lucide-react'
import { useChatStore } from '../../../store/chatStore'
import type { AudioResult, ChatMessage } from '../../../types'

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

interface AudioOption extends AudioResult {
  id: string  // audio_url 作 id (确保唯一)
}

const POLL_INTERVAL_MS = 3000
const MAX_POLL_TICKS = 200    // 200 * 3s = 10 min 上限

function collectAudioOptions(messages: ChatMessage[]): AudioOption[] {
  const out: AudioOption[] = []
  // 倒序遍历, 最新的在前面
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'assistant') continue
    for (const b of m.blocks) {
      if (b.type === 'audio_player' && b.data?.audio_url) {
        out.push({ id: b.data.audio_url, ...b.data })
      }
    }
  }
  return out
}

function resolveAudioFetchUrl(audioUrl: string) {
  if (audioUrl.startsWith('http')) return audioUrl
  // 相对路径(如 /api/voice/audio/xxx.wav)走直传 NATAPP
  const directBase = import.meta.env.VITE_DIRECT_API_URL || 'https://monoi.nat100.top'
  return directBase + audioUrl
}

function audioFileNameFor(opt: AudioOption) {
  const ext = (opt.audio_url.match(/\.(\w{2,5})(?:\?|$)/)?.[1] || 'wav').toLowerCase()
  const base = (opt.voice_label || opt.preset_key || 'voice').replace(/[\\/:*?"<>|]/g, '_')
  return `${base}.${ext}`
}

export function DigitalHumanForm({ onSubmit, onClose }: Props) {
  const conv = useChatStore(s => s.conversations.find(c => c.id === s.activeId))
  const audioOptions = useMemo(() => collectAudioOptions(conv?.messages || []), [conv?.messages])

  const [selectedAudioId, setSelectedAudioId] = useState<string>(audioOptions[0]?.id || '')
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [videoPreview, setVideoPreview] = useState<string>('')

  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState(0)
  const [statusMsg, setStatusMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [resultUrl, setResultUrl] = useState('')
  const [resultMeta, setResultMeta] = useState<{ duration_ms?: number; width?: number; height?: number }>({})

  const pollTimerRef = useRef<number | null>(null)
  const pollTicksRef = useRef(0)
  const previewAudioRef = useRef<HTMLAudioElement | null>(null)
  const [previewingId, setPreviewingId] = useState('')

  // 视频上传后生成预览 URL, 卸载时回收
  useEffect(() => {
    if (!videoFile) {
      setVideoPreview('')
      return
    }
    const url = URL.createObjectURL(videoFile)
    setVideoPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [videoFile])

  // 自动选中(有新音频时刷新)
  useEffect(() => {
    if (!selectedAudioId && audioOptions.length > 0) {
      setSelectedAudioId(audioOptions[0].id)
    }
  }, [audioOptions, selectedAudioId])

  // 卸载时清掉轮询和音频预览
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
      previewAudioRef.current?.pause()
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

  const togglePreviewAudio = (opt: AudioOption) => {
    const url = resolveAudioFetchUrl(opt.audio_url)
    if (previewingId === opt.id && previewAudioRef.current) {
      previewAudioRef.current.pause()
      previewAudioRef.current = null
      setPreviewingId('')
      return
    }
    previewAudioRef.current?.pause()
    const audio = new Audio(url)
    audio.onended = () => setPreviewingId('')
    audio.play()
    previewAudioRef.current = audio
    setPreviewingId(opt.id)
  }

  const selectedAudio = audioOptions.find(o => o.id === selectedAudioId)

  const handleSubmit = async () => {
    if (!videoFile) {
      setErrorMsg('请上传形象视频')
      return
    }
    if (!selectedAudio) {
      setErrorMsg('请选择音频')
      return
    }
    setErrorMsg('')
    setPhase('submitting')
    setProgress(0)
    setStatusMsg('正在准备文件...')

    try {
      // 1. fetch 已有音频 -> blob
      const audioRes = await fetch(resolveAudioFetchUrl(selectedAudio.audio_url))
      if (!audioRes.ok) throw new Error(`音频获取失败: HTTP ${audioRes.status}`)
      const audioBlob = await audioRes.blob()
      const audioFileObj = new File([audioBlob], audioFileNameFor(selectedAudio), {
        type: audioBlob.type || 'audio/wav',
      })

      // 2. 组装 FormData
      const fd = new FormData()
      fd.append('audio', audioFileObj)
      fd.append('video', videoFile)

      setStatusMsg('正在上传...')

      // 3. 直传 NATAPP, 绕开 Vercel 4.5MB 限制
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
      audio_label: selectedAudio?.voice_label || '数字人',
      source: 'digital_human' as const,
      text_preview: selectedAudio?.text_preview,
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
  }

  const isBusy = phase === 'submitting' || phase === 'processing'
  const previewBase = import.meta.env.VITE_DIRECT_API_URL || 'https://monoi.nat100.top'
  const finalVideoUrl = resultUrl ? previewBase + resultUrl : ''

  const noAudio = audioOptions.length === 0

  const modal = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative bg-[var(--bg-card)] border border-[var(--border)] rounded-[22px] shadow-ios-lg w-full max-w-lg max-h-[88vh] flex flex-col sheet-enter"
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
            <div className="flex flex-col gap-5">
              {noAudio ? (
                <div className="text-xs text-[var(--text-2)] bg-[var(--bg-hover)] border border-[var(--border)] rounded-lg px-3 py-3 leading-relaxed">
                  💡 还没有已生成的配音。请先在 <b>配音</b> 模块生成一段音频,再回来做数字人。
                </div>
              ) : (
                <p className="text-xs text-[var(--text-3)] leading-relaxed">
                  上传你的<b className="text-[var(--text-2)]">形象视频</b>,选一段已生成的<b className="text-[var(--text-2)]">配音</b>,自动对口型生成数字人视频。
                </p>
              )}

              {/* 形象视频区 */}
              <VideoSlot
                file={videoFile}
                previewUrl={videoPreview}
                onChange={setVideoFile}
              />

              {/* 音频选择区 */}
              {!noAudio && (
                <AudioPickGroup
                  options={audioOptions}
                  selectedId={selectedAudioId}
                  onSelect={setSelectedAudioId}
                  previewingId={previewingId}
                  onTogglePreview={togglePreviewAudio}
                />
              )}

              {errorMsg && (
                <div className="text-xs text-red-400 bg-red-950/20 border border-red-900/30 rounded-lg px-3 py-2">
                  {errorMsg}
                </div>
              )}

              <p className="text-[11px] text-[var(--text-3)] leading-relaxed">
                💡 输出视频时长 = 音频时长。形象视频只做参考,会自动循环。
              </p>
            </div>
          ) : phase === 'submitting' || phase === 'processing' ? (
            <div className="flex flex-col items-center justify-center gap-4 py-10">
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
                  src={finalVideoUrl}
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
                disabled={!videoFile || !selectedAudio}
                className={`px-4 py-2 text-sm rounded-lg transition-all cursor-pointer ${
                  videoFile && selectedAudio
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

// ─────────── 形象视频上传组件 ───────────
function VideoSlot({
  file,
  previewUrl,
  onChange,
}: {
  file: File | null
  previewUrl: string
  onChange: (f: File | null) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  if (file && previewUrl) {
    return (
      <div>
        <div className="text-xs font-medium text-[var(--text-2)] mb-1.5 flex items-center justify-between">
          <span>形象视频</span>
          <button
            onClick={() => onChange(null)}
            className="text-[11px] text-[var(--text-3)] hover:text-[var(--text)]"
          >
            重新选择
          </button>
        </div>
        <div className="rounded-xl overflow-hidden bg-black border border-[var(--border)]">
          <video
            src={previewUrl}
            controls
            playsInline
            muted
            className="w-full max-h-[220px] object-contain"
          />
        </div>
        <div className="text-[11px] text-[var(--text-3)] mt-1 truncate">
          {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="text-xs font-medium text-[var(--text-2)] mb-1.5">形象视频</div>
      <div
        onClick={() => inputRef.current?.click()}
        className="flex items-center gap-3 px-3 py-3 rounded-lg border border-[var(--border)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
      >
        <Upload size={14} className="text-[var(--text-3)] flex-shrink-0"/>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-[var(--text-2)]">点击选择文件</div>
          <div className="text-[11px] text-[var(--text-3)]">MP4 推荐 5-30 秒,正脸,1080p 以内</div>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/*"
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

// ─────────── 音频选择列表 ───────────
function AudioPickGroup({
  options,
  selectedId,
  onSelect,
  previewingId,
  onTogglePreview,
}: {
  options: AudioOption[]
  selectedId: string
  onSelect: (id: string) => void
  previewingId: string
  onTogglePreview: (opt: AudioOption) => void
}) {
  return (
    <div>
      <div className="text-xs font-medium text-[var(--text-2)] mb-1.5">
        音频 <span className="text-[var(--text-3)] font-normal">· 共 {options.length} 段已生成</span>
      </div>
      <div className="flex flex-col gap-1.5 max-h-[180px] overflow-y-auto">
        {options.map(opt => {
          const selected = opt.id === selectedId
          const playing = previewingId === opt.id
          return (
            <div
              key={opt.id}
              onClick={() => onSelect(opt.id)}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                selected
                  ? 'border-[var(--text-2)] bg-[var(--bg-hover)]'
                  : 'border-[var(--border)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              <button
                onClick={(e) => { e.stopPropagation(); onTogglePreview(opt) }}
                className="w-7 h-7 rounded-full bg-[var(--bg-input)] hover:bg-[var(--text)] hover:text-[var(--bg)] text-[var(--text-2)] flex items-center justify-center flex-shrink-0 transition-colors"
                title="试听"
              >
                {playing ? <Pause size={11} fill="currentColor"/> : <Play size={11} fill="currentColor" className="ml-0.5"/>}
              </button>
              <AudioLines size={13} className="text-[var(--text-3)] flex-shrink-0"/>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-[var(--text)] truncate">
                  {opt.voice_label || opt.preset_key || '配音'}
                  {opt.duration_seconds ? <span className="text-[var(--text-3)] text-xs ml-1">{opt.duration_seconds.toFixed(1)}s</span> : null}
                </div>
                {opt.text_preview && (
                  <div className="text-[11px] text-[var(--text-3)] truncate">{opt.text_preview}</div>
                )}
              </div>
              {selected && <Check size={14} className="text-[var(--text)] flex-shrink-0"/>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
