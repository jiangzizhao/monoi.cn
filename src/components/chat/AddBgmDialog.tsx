// 数字人 / 任意视频 后期加 BGM 的弹窗.
// 用户选 BGM 库里一首 + 调音量 → 后端 ffmpeg amix → 返新视频 URL → 替换原 video_player.
//
// 跟 RecordTab 的 BGM 选择面板逻辑类似, 但是是 modal 弹窗, 因为这里不是创作流的"内嵌设置".

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Music, Loader2, Volume2 } from 'lucide-react'
import { listBgmLibrary, type BgmTrack } from '../../services/audio'
import { getToken } from '../../lib/auth'

const directBase = (import.meta as any).env?.VITE_DIRECT_API_URL || 'https://monoi.nat100.top'

interface Props {
  videoUrl: string
  onClose: () => void
  onSuccess: (newVideoUrl: string, ossKey: string) => void
}

export function AddBgmDialog({ videoUrl, onClose, onSuccess }: Props) {
  const [list, setList] = useState<BgmTrack[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [selected, setSelected] = useState<BgmTrack | null>(null)
  const [volume, setVolume] = useState(0.3)
  const [submitting, setSubmitting] = useState(false)
  const [previewBgmId, setPreviewBgmId] = useState<number | null>(null)
  const [previewAudio, setPreviewAudio] = useState<HTMLAudioElement | null>(null)

  useEffect(() => {
    listBgmLibrary()
      .then(d => setList(d.bgms || []))
      .catch(e => setErr(e.message || '加载失败'))
      .finally(() => setLoading(false))
  }, [])

  // 预览 BGM (用 <audio> 元素, 防止用户选了再合流才发现不对)
  const togglePreview = (bgm: BgmTrack) => {
    if (previewAudio) {
      previewAudio.pause()
      setPreviewAudio(null)
    }
    if (previewBgmId === bgm.id) {
      setPreviewBgmId(null)
      return
    }
    const audio = new Audio(bgm.preview_url)
    audio.volume = volume
    audio.play().catch(() => {})
    audio.onended = () => setPreviewBgmId(null)
    setPreviewAudio(audio)
    setPreviewBgmId(bgm.id)
  }

  useEffect(() => {
    if (previewAudio) previewAudio.volume = volume
  }, [volume, previewAudio])

  // 提交合流
  const submit = async () => {
    if (!selected || submitting) return
    // 停掉预览
    previewAudio?.pause()
    setPreviewAudio(null); setPreviewBgmId(null)

    setSubmitting(true); setErr('')
    try {
      const token = getToken() || ''
      const res = await fetch(directBase + '/api/voice/add-bgm-to-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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

  // 关弹窗时确保停掉预览
  const handleClose = () => {
    previewAudio?.pause()
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

          {/* BGM 列表 */}
          {loading && (
            <div className="text-sm text-[var(--text-3)] py-6 flex items-center justify-center gap-2">
              <Loader2 size={14} className="animate-spin"/> 加载 BGM 库...
            </div>
          )}
          {err && <div className="text-xs text-red-400 bg-red-950/20 border border-red-900/30 rounded-lg px-3 py-2">{err}</div>}
          {!loading && list.length === 0 && !err && (
            <div className="text-xs text-[var(--text-3)] text-center py-6">BGM 库为空 (admin 后台可上传)</div>
          )}
          {!loading && list.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {list.map(bgm => {
                const isSelected = selected?.id === bgm.id
                const isPlaying = previewBgmId === bgm.id
                return (
                  <div key={bgm.id}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors ${
                      isSelected
                        ? 'bg-[var(--text)] text-[var(--bg)]'
                        : 'bg-[var(--bg-hover)] text-[var(--text-2)] hover:bg-[var(--bg-input)]'
                    }`}>
                    <button onClick={() => setSelected(bgm)}
                      className="flex-1 flex items-center gap-2 text-left cursor-pointer min-w-0">
                      <Music size={12} className="flex-shrink-0"/>
                      <span className="flex-1 truncate">{bgm.name}</span>
                      <span className="text-[10px] opacity-60 flex-shrink-0">{bgm.category}</span>
                    </button>
                    <button onClick={() => togglePreview(bgm)} disabled={submitting}
                      className="text-[10px] underline cursor-pointer opacity-70 hover:opacity-100"
                      title="试听">
                      {isPlaying ? '暂停' : '试听'}
                    </button>
                  </div>
                )
              })}
            </div>
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
    </div>,
    document.body,
  )
}
