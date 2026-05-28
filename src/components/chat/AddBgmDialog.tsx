// 数字人 / 任意视频 后期加 BGM 的弹窗.
// BGM 三种来源: ① 内置 BGM 库选 ② 上传自己的音乐 ③ 上传有人声的歌 AI 去人声.
// 选定后 → 后端 ffmpeg amix → 返新视频 URL → 替换原 video_player.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Music, Loader2, Volume2, Upload, Sparkles } from 'lucide-react'
import { listBgmLibrary, type BgmTrack } from '../../services/audio'
import { VocalRemoverDialog } from '../VocalRemoverDialog'
import { getToken } from '../../lib/auth'

const directBase = (import.meta as any).env?.VITE_DIRECT_API_URL || 'https://monoi.nat100.top'

interface Props {
  videoUrl: string
  onClose: () => void
  onSuccess: (newVideoUrl: string, ossKey: string) => void
}

// 选定的 BGM — 不管来自库 / 上传 / 去人声, 统一成 oss_key + 名字 (+ 可选试听 URL)
interface SelectedBgm {
  oss_key: string
  name: string
  preview_url?: string
}

export function AddBgmDialog({ videoUrl, onClose, onSuccess }: Props) {
  const [list, setList] = useState<BgmTrack[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [selected, setSelected] = useState<SelectedBgm | null>(null)
  const [volume, setVolume] = useState(0.3)
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [vocalRemoverOpen, setVocalRemoverOpen] = useState(false)
  const [previewKey, setPreviewKey] = useState<string | null>(null)
  const [previewAudio, setPreviewAudio] = useState<HTMLAudioElement | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    listBgmLibrary()
      .then(d => setList(d.bgms || []))
      .catch(e => setErr(e.message || '加载失败'))
      .finally(() => setLoading(false))
  }, [])

  const stopPreview = () => {
    previewAudio?.pause()
    setPreviewAudio(null)
    setPreviewKey(null)
  }

  // 试听库里的 BGM (用 preview_url)
  const togglePreview = (key: string, url: string) => {
    if (previewAudio) { previewAudio.pause(); setPreviewAudio(null) }
    if (previewKey === key) { setPreviewKey(null); return }
    const audio = new Audio(url)
    audio.volume = volume
    audio.play().catch(() => {})
    audio.onended = () => setPreviewKey(null)
    setPreviewAudio(audio)
    setPreviewKey(key)
  }

  useEffect(() => {
    if (previewAudio) previewAudio.volume = volume
  }, [volume, previewAudio])

  // 上传自己的音乐 → 直传 OSS → 直接作为 BGM
  const handleUpload = async (file: File) => {
    if (file.size > 50 * 1024 * 1024) { setErr('音乐文件太大 (>50MB), 建议先压缩'); return }
    setUploading(true); setErr('')
    try {
      const signRes = await fetch(directBase + '/api/oss/sign-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken() || ''}` },
        body: JSON.stringify({ filename: file.name, content_type: file.type || 'audio/mpeg' }),
      })
      if (!signRes.ok) throw new Error(`签名失败 (${signRes.status})`)
      const { put_url, oss_key, content_type } = await signRes.json()
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.onload = () => { (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error(`PUT ${xhr.status}`)) }
        xhr.onerror = () => reject(new Error('网络错误'))
        xhr.open('PUT', put_url)
        xhr.setRequestHeader('Content-Type', content_type)
        xhr.send(file)
      })
      stopPreview()
      setSelected({ oss_key, name: file.name, preview_url: URL.createObjectURL(file) })
    } catch (e: any) {
      setErr(`上传失败: ${e.message}`)
    } finally {
      setUploading(false)
    }
  }

  // 提交合流
  const submit = async () => {
    if (!selected || submitting) return
    stopPreview()
    setSubmitting(true); setErr('')
    try {
      const res = await fetch(directBase + '/api/voice/add-bgm-to-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken() || ''}` },
        body: JSON.stringify({
          video_url: videoUrl,
          bgm_oss_key: selected.oss_key,
          volume,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.detail || data.error || `合流失败 (${res.status})`)
      }
      onSuccess(data.video_url, data.oss_key)
    } catch (e: any) {
      setErr(e.message || '合流失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleClose = () => {
    stopPreview()
    onClose()
  }

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={handleClose}>
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)]">
          <div className="text-base font-semibold flex items-center gap-2"><Music size={16}/> 给视频加 BGM</div>
          <button onClick={handleClose} className="text-[var(--text-3)] hover:text-[var(--text)] cursor-pointer"><X size={18}/></button>
        </div>

        <div className="flex-1 overflow-auto p-4 flex flex-col gap-3">
          {/* 音量条 */}
          <div className="flex items-center gap-3 text-xs bg-[var(--bg-input)] rounded-lg px-3 py-2">
            <Volume2 size={14} className="text-[var(--text-3)] flex-shrink-0"/>
            <span className="text-[var(--text-3)] flex-shrink-0">BGM 音量:</span>
            <input type="range" min={0} max={1} step={0.05} value={volume}
              onChange={e => setVolume(Number(e.target.value))}
              className="flex-1"/>
            <span className="text-[var(--text-2)] w-10 text-right">{Math.round(volume * 100)}%</span>
          </div>
          <p className="text-[10px] text-[var(--text-3)] -mt-1">推荐 20-40%, BGM 不会盖过人声.</p>

          {err && <div className="text-xs text-red-400 bg-red-950/20 border border-red-900/30 rounded-lg px-3 py-2">{err}</div>}

          {/* 已选中的 BGM */}
          {selected ? (
            <div className="flex flex-col gap-2 border border-[var(--text)] rounded-xl p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-[var(--text)] truncate flex items-center gap-2 min-w-0">
                  <Music size={14} className="flex-shrink-0"/>
                  <span className="truncate">{selected.name}</span>
                </span>
                <button onClick={() => { stopPreview(); if (selected.preview_url?.startsWith('blob:')) URL.revokeObjectURL(selected.preview_url); setSelected(null) }}
                  className="text-[11px] text-[var(--text-3)] hover:text-red-400 px-2 py-1 cursor-pointer flex-shrink-0">
                  重选
                </button>
              </div>
              {selected.preview_url && (
                <audio src={selected.preview_url} controls className="w-full" style={{ height: 32 }}/>
              )}
            </div>
          ) : (
            <>
              {/* 来源 1: 内置 BGM 库 */}
              {loading && (
                <div className="text-sm text-[var(--text-3)] py-6 flex items-center justify-center gap-2">
                  <Loader2 size={14} className="animate-spin"/> 加载 BGM 库...
                </div>
              )}
              {!loading && list.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <div className="text-[10px] text-[var(--text-3)] px-0.5">从内置 BGM 库选 (商用授权)</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {list.map(bgm => {
                      const isPlaying = previewKey === `lib-${bgm.id}`
                      return (
                        <div key={bgm.id}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs bg-[var(--bg-hover)] text-[var(--text-2)] hover:bg-[var(--bg-input)] transition-colors">
                          <button onClick={() => { stopPreview(); setSelected({ oss_key: bgm.oss_key, name: bgm.name, preview_url: bgm.preview_url }) }}
                            className="flex-1 flex items-center gap-2 text-left cursor-pointer min-w-0">
                            <Music size={12} className="flex-shrink-0"/>
                            <span className="flex-1 truncate">{bgm.name}</span>
                            <span className="text-[10px] opacity-60 flex-shrink-0">{bgm.category}</span>
                          </button>
                          <button onClick={() => togglePreview(`lib-${bgm.id}`, bgm.preview_url)} disabled={submitting}
                            className="text-[10px] underline cursor-pointer opacity-70 hover:opacity-100"
                            title="试听">
                            {isPlaying ? '暂停' : '试听'}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
              {!loading && list.length === 0 && !err && (
                <div className="text-xs text-[var(--text-3)] text-center py-3">内置 BGM 库为空 — 可上传自己的音乐 ↓</div>
              )}

              {/* 来源 2: 上传自己的音乐 */}
              <button onClick={() => fileRef.current?.click()} disabled={uploading}
                className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-dashed border-[var(--border)] text-xs text-[var(--text-2)] hover:bg-[var(--bg-hover)] hover:border-[var(--text-3)] cursor-pointer disabled:opacity-50 transition-all">
                {uploading ? <><Loader2 size={14} className="animate-spin"/> 上传中...</> : <><Upload size={14}/> 上传自己的音乐 (mp3/wav, ≤50MB)</>}
              </button>

              {/* 来源 3: 上传有人声的歌 → AI 去人声 */}
              <button onClick={() => setVocalRemoverOpen(true)}
                className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-[11px] text-[var(--text-2)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors">
                <Sparkles size={12}/> 或者: 上传有人声的歌, AI 自动去人声做 BGM
              </button>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--border)]">
          <button onClick={handleClose} disabled={submitting}
            className="px-4 py-2 text-sm text-[var(--text-2)] hover:bg-[var(--bg-hover)] rounded-lg cursor-pointer disabled:opacity-50">
            取消
          </button>
          <button onClick={submit} disabled={!selected || submitting}
            className={`px-4 py-2 text-sm rounded-lg inline-flex items-center gap-2 ${
              !selected || submitting
                ? 'bg-[var(--bg-hover)] text-[var(--text-3)] cursor-not-allowed'
                : 'bg-[var(--text)] text-[var(--bg)] hover:opacity-80 cursor-pointer'
            }`}>
            {submitting && <Loader2 size={12} className="animate-spin"/>}
            {submitting ? '合成中, 可能 1-3 分钟...' : '合成新视频'}
          </button>
        </div>
      </div>

      {/* 上传文件 input */}
      <input ref={fileRef} type="file" accept="audio/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); if (fileRef.current) fileRef.current.value = '' }}/>

      {/* 去人声弹窗 — 完成后直接当 BGM 用. 包一层挡掉冒泡, 避免点它的遮罩连带关掉加BGM弹窗 */}
      <div onClick={e => e.stopPropagation()}>
        <VocalRemoverDialog
          open={vocalRemoverOpen}
          onClose={() => setVocalRemoverOpen(false)}
          onUseAsBgm={(oss_key, name) => { stopPreview(); setSelected({ oss_key, name }) }}
        />
      </div>
    </div>,
    document.body,
  )
}
