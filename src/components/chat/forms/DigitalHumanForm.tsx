import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, X, Play, Pause, AudioLines, Check, Plus, Trash2 } from 'lucide-react'
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

interface Avatar {
  avatar_key: string
  name: string
  duration_seconds?: number
  width?: number
  height?: number
  file_size?: number
  file_url: string             // /api/digital-human/avatars/xxx/file
  created_at?: string
}

interface AudioOption extends AudioResult {
  id: string
}

const POLL_INTERVAL_MS = 3000
const MAX_POLL_TICKS = 200

function collectAudioOptions(messages: ChatMessage[]): AudioOption[] {
  const out: AudioOption[] = []
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

function directBase() {
  return import.meta.env.VITE_DIRECT_API_URL || 'https://monoi.nat100.top'
}

function resolveAudioFetchUrl(audioUrl: string) {
  // http:// 强制升级到 https://, 否则 HTTPS 页面 fetch 会被 mixed-content block
  // (阿里云 OSS 返回的临时 URL 是 http://)
  if (audioUrl.startsWith('http://')) {
    return 'https://' + audioUrl.slice('http://'.length)
  }
  if (audioUrl.startsWith('http')) return audioUrl
  return directBase() + audioUrl
}

function audioFileNameFor(opt: AudioOption) {
  const ext = (opt.audio_url.match(/\.(\w{2,5})(?:\?|$)/)?.[1] || 'wav').toLowerCase()
  const base = (opt.voice_label || opt.preset_key || 'voice').replace(/[\\/:*?"<>|]/g, '_')
  return `${base}.${ext}`
}

export function DigitalHumanForm({ onSubmit, onClose }: Props) {
  const conv = useChatStore(s => s.conversations.find(c => c.id === s.activeId))
  const audioOptions = useMemo(() => collectAudioOptions(conv?.messages || []), [conv?.messages])

  // ─── Avatars ───
  const [avatars, setAvatars] = useState<Avatar[]>([])
  const [maxAvatars, setMaxAvatars] = useState(5)
  const [avatarsLoading, setAvatarsLoading] = useState(true)
  const [selectedAvatarKey, setSelectedAvatarKey] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const [pendingDelete, setPendingDelete] = useState<string>('') // 删除中的 key

  // ─── Audio ───
  const [selectedAudioId, setSelectedAudioId] = useState<string>(audioOptions[0]?.id || '')
  const previewAudioRef = useRef<HTMLAudioElement | null>(null)
  const [previewingId, setPreviewingId] = useState('')

  // ─── 提交 / 轮询 ───
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState(0)
  const [statusMsg, setStatusMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [resultUrl, setResultUrl] = useState('')
  const [resultMeta, setResultMeta] = useState<{ duration_ms?: number; width?: number; height?: number }>({})
  const pollTimerRef = useRef<number | null>(null)
  const pollTicksRef = useRef(0)

  // ─── 加载 avatars ───
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await fetch('/api/proxy?path=' + encodeURIComponent('/api/digital-human/avatars'))
        const data = await r.json()
        if (!alive) return
        setAvatars(data.items || [])
        // 后端 max_count: -1 = 不限 (旗舰套餐). 前端用 Infinity 处理, 永远 canUploadMore
        setMaxAvatars(data.max_count === -1 ? Infinity : (data.max_count || 5))
        // 默认选第一个
        if ((data.items || []).length > 0 && !selectedAvatarKey) {
          setSelectedAvatarKey(data.items[0].avatar_key)
        }
      } catch (e) {
        // 加载失败忽略,用户可以重新打开
      } finally {
        if (alive) setAvatarsLoading(false)
      }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!selectedAudioId && audioOptions.length > 0) {
      setSelectedAudioId(audioOptions[0].id)
    }
  }, [audioOptions, selectedAudioId])

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
      previewAudioRef.current?.pause()
    }
  }, [])

  // ─── Avatar 上传 ───
  const handleAvatarFilePicked = async (file: File) => {
    if (!file) return
    if (avatars.length >= maxAvatars) {
      setUploadError(`已达上限: 最多保留 ${maxAvatars} 个形象, 请先删除一个`)
      return
    }
    setUploading(true)
    setUploadError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const baseName = file.name.replace(/\.[^.]+$/, '').slice(0, 20) || '我的形象'
      fd.append('name', baseName)
      // 直传 NATAPP, 视频文件可能 > 4.5MB
      const res = await fetch(directBase() + '/api/digital-human/avatars', {
        method: 'POST',
        body: fd,
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        setUploadError(data.detail || data.error || '上传失败')
        return
      }
      // 加到列表头, 自动选中
      const newAvatar: Avatar = {
        avatar_key: data.avatar_key,
        name: data.name,
        duration_seconds: data.duration_seconds,
        width: data.width,
        height: data.height,
        file_size: data.file_size,
        file_url: data.file_url,
      }
      setAvatars(prev => [newAvatar, ...prev])
      setSelectedAvatarKey(data.avatar_key)
    } catch (e: any) {
      setUploadError(e?.message || '上传失败')
    } finally {
      setUploading(false)
    }
  }

  const handleDeleteAvatar = async (key: string) => {
    if (pendingDelete) return
    setPendingDelete(key)
    try {
      await fetch(
        '/api/proxy?path=' + encodeURIComponent('/api/digital-human/avatars/' + key),
        { method: 'DELETE' },
      )
      setAvatars(prev => prev.filter(a => a.avatar_key !== key))
      if (selectedAvatarKey === key) {
        const next = avatars.find(a => a.avatar_key !== key)
        setSelectedAvatarKey(next?.avatar_key || '')
      }
    } catch {
      // 忽略,UI 会保留
    } finally {
      setPendingDelete('')
    }
  }

  // ─── Audio 试听 ───
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
  const selectedAvatar = avatars.find(a => a.avatar_key === selectedAvatarKey)

  // ─── 提交 ───
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
        setErrorMsg('合成超时, 请重试')
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
      } catch {
        // 忽略,继续轮询
      }
    }, POLL_INTERVAL_MS)
  }

  const handleSubmit = async () => {
    if (!selectedAvatar) {
      setErrorMsg('请选择一个数字人形象')
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
      // fetch 已有音频 -> blob -> File
      const audioRes = await fetch(resolveAudioFetchUrl(selectedAudio.audio_url))
      if (!audioRes.ok) throw new Error(`音频获取失败: HTTP ${audioRes.status}`)
      const audioBlob = await audioRes.blob()
      const audioFileObj = new File([audioBlob], audioFileNameFor(selectedAudio), {
        type: audioBlob.type || 'audio/wav',
      })

      const fd = new FormData()
      fd.append('audio', audioFileObj)
      fd.append('avatar_key', selectedAvatar.avatar_key)

      setStatusMsg('正在上传...')

      const res = await fetch(directBase() + '/api/digital-human/submit', {
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
  const finalVideoUrl = resultUrl ? directBase() + resultUrl : ''
  const noAudio = audioOptions.length === 0
  const canUploadMore = avatars.length < maxAvatars

  const modal = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative bg-[var(--bg-card)] border border-[var(--border)] rounded-[22px] shadow-ios-lg w-full max-w-lg max-h-[88vh] flex flex-col sheet-enter"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div className="text-base font-semibold text-[var(--text)]">口播 · 数字人</div>
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
              {/* 形象区 */}
              <AvatarPickGroup
                avatars={avatars}
                loading={avatarsLoading}
                maxCount={maxAvatars}
                selectedKey={selectedAvatarKey}
                uploading={uploading}
                pendingDelete={pendingDelete}
                onSelect={setSelectedAvatarKey}
                onUploadClick={() => uploadInputRef.current?.click()}
                onDelete={handleDeleteAvatar}
                canUploadMore={canUploadMore}
              />
              {uploadError && (
                <div className="text-xs text-red-400 bg-red-950/20 border border-red-900/30 rounded-lg px-3 py-2 -mt-2">
                  {uploadError}
                </div>
              )}
              <input
                ref={uploadInputRef}
                type="file"
                accept="video/mp4,video/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleAvatarFilePicked(f)
                  if (uploadInputRef.current) uploadInputRef.current.value = ''
                }}
              />

              {/* 音频区 */}
              {noAudio ? (
                <div className="text-xs text-[var(--text-2)] bg-[var(--bg-hover)] border border-[var(--border)] rounded-lg px-3 py-3 leading-relaxed">
                  还没有已生成的配音。请先在 <b>配音</b> 模块生成一段音频, 再回来做数字人。
                </div>
              ) : (
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
                输出视频时长 = 音频时长。形象视频只做参考, 会自动循环。
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
              <p className="text-[11px] text-[var(--text-3)]">通常 30 秒 - 2 分钟, 看音频长度。请勿关闭此窗口。</p>
            </div>
          ) : (
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
                <span>{resultMeta.width && resultMeta.height ? `${resultMeta.width}×${resultMeta.height}` : ''}</span>
                <span>{resultMeta.duration_ms ? `${(resultMeta.duration_ms / 1000).toFixed(1)}s` : ''}</span>
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
                disabled={!selectedAvatar || !selectedAudio}
                className={`px-4 py-2 text-sm rounded-lg transition-all cursor-pointer ${
                  selectedAvatar && selectedAudio
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

// ─────────── 形象选择网格 ───────────
function AvatarPickGroup({
  avatars,
  loading,
  maxCount,
  selectedKey,
  uploading,
  pendingDelete,
  canUploadMore,
  onSelect,
  onUploadClick,
  onDelete,
}: {
  avatars: Avatar[]
  loading: boolean
  maxCount: number
  selectedKey: string
  uploading: boolean
  pendingDelete: string
  canUploadMore: boolean
  onSelect: (key: string) => void
  onUploadClick: () => void
  onDelete: (key: string) => void
}) {
  return (
    <div>
      <div className="text-xs font-medium text-[var(--text-2)] mb-1.5 flex items-center justify-between">
        <span>
          形象 <span className="text-[var(--text-3)] font-normal">· {avatars.length}/{maxCount === Infinity ? '不限' : maxCount}</span>
        </span>
        {avatars.length === 0 && !loading && (
          <span className="text-[11px] text-[var(--text-3)]">点 + 上传第一个形象</span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8 text-xs text-[var(--text-3)]">
          <Loader2 size={14} className="animate-spin mr-2"/> 正在加载形象...
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {avatars.map(a => (
            <AvatarCard
              key={a.avatar_key}
              avatar={a}
              selected={a.avatar_key === selectedKey}
              deleting={pendingDelete === a.avatar_key}
              onSelect={() => onSelect(a.avatar_key)}
              onDelete={() => onDelete(a.avatar_key)}
            />
          ))}
          {canUploadMore && (
            <button
              onClick={onUploadClick}
              disabled={uploading}
              className={`aspect-[3/4] rounded-lg border-2 border-dashed transition-colors flex flex-col items-center justify-center gap-1 cursor-pointer ${
                uploading
                  ? 'border-[var(--border)] bg-[var(--bg-hover)] cursor-wait'
                  : 'border-[var(--border)] hover:border-[var(--text-2)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              {uploading ? (
                <>
                  <Loader2 size={18} className="animate-spin text-[var(--text-2)]"/>
                  <span className="text-[11px] text-[var(--text-3)]">上传中...</span>
                </>
              ) : (
                <>
                  <Plus size={18} className="text-[var(--text-2)]"/>
                  <span className="text-[11px] text-[var(--text-3)]">上传新形象</span>
                </>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function AvatarCard({
  avatar,
  selected,
  deleting,
  onSelect,
  onDelete,
}: {
  avatar: Avatar
  selected: boolean
  deleting: boolean
  onSelect: () => void
  onDelete: () => void
}) {
  const fileUrl = directBase() + avatar.file_url
  const videoRef = useRef<HTMLVideoElement>(null)
  const [hovering, setHovering] = useState(false)

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    if (hovering) v.play().catch(() => {})
    else { v.pause(); v.currentTime = 0 }
  }, [hovering])

  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      className={`relative aspect-[3/4] rounded-lg overflow-hidden border-2 cursor-pointer transition-colors group ${
        selected
          ? 'border-[var(--text)]'
          : 'border-[var(--border)] hover:border-[var(--text-3)]'
      }`}
    >
      <video
        ref={videoRef}
        src={fileUrl}
        preload="none"
        muted
        playsInline
        loop
        className="w-full h-full object-cover bg-black"
      />
      {/* 名字蒙层 */}
      <div className="absolute bottom-0 left-0 right-0 px-2 py-1.5 bg-gradient-to-t from-black/80 to-transparent">
        <div className="text-[11px] text-white truncate">{avatar.name}</div>
        {avatar.duration_seconds && (
          <div className="text-[10px] text-white/70">{avatar.duration_seconds.toFixed(1)}s</div>
        )}
      </div>
      {/* 选中标记 */}
      {selected && (
        <div className="absolute top-1.5 left-1.5 w-5 h-5 rounded-full bg-[var(--text)] text-[var(--bg)] flex items-center justify-center">
          <Check size={12}/>
        </div>
      )}
      {/* 删除按钮 (hover 显示) */}
      <button
        onClick={(e) => { e.stopPropagation(); if (!deleting) onDelete() }}
        disabled={deleting}
        className={`absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-black/60 hover:bg-red-600 text-white flex items-center justify-center transition-opacity ${
          deleting ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
        title="删除"
      >
        {deleting ? <Loader2 size={11} className="animate-spin"/> : <Trash2 size={11}/>}
      </button>
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

