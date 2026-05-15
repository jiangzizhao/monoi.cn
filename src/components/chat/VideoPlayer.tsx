import { useRef, useState } from 'react'
import { Play, Pause, Download, Loader2, FileBox } from 'lucide-react'
import type { VideoResult } from '../../types'

function resolveUrl(raw: string) {
  if (!raw) return ''
  if (raw.startsWith('http')) return raw
  // 视频文件可能很大, 直传 NATAPP 绕开 Vercel 4.5MB 响应体限制
  const directBase = import.meta.env.VITE_DIRECT_API_URL || 'https://monoi.nat100.top'
  return directBase + raw
}

export function VideoPlayer({ data }: { data: VideoResult }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [downloading, setDownloading] = useState(false)
  // 剪映草稿导出状态 (有 jianying_payload 才显示按钮)
  const [exportingDraft, setExportingDraft] = useState(false)
  const [draftUrl, setDraftUrl] = useState<string | null>(null)
  const [draftError, setDraftError] = useState('')
  const [draftSizeMB, setDraftSizeMB] = useState<number | null>(null)

  const url = resolveUrl(data.video_url)
  const durationSec = data.duration_ms ? data.duration_ms / 1000 : undefined

  const toggle = () => {
    const v = videoRef.current
    if (!v) return
    if (playing) { v.pause(); setPlaying(false) }
    else { v.play(); setPlaying(true) }
  }

  const onTime = () => {
    const v = videoRef.current
    if (!v || !v.duration) return
    setProgress((v.currentTime / v.duration) * 100)
  }

  const handleExportDraft = async () => {
    if (exportingDraft || !data.jianying_payload) return
    setExportingDraft(true)
    setDraftError('')
    try {
      const directBase = import.meta.env.VITE_DIRECT_API_URL || 'https://monoi.nat100.top'
      const res = await fetch(directBase + '/api/voice/compose-jianying-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data.jianying_payload),
      })
      const j = await res.json()
      if (!res.ok || !j.success) throw new Error(j.detail || j.error || `导出失败 (${res.status})`)
      setDraftUrl(j.download_url)
      setDraftSizeMB(j.zip_size ? Math.round(j.zip_size / 1024 / 1024 * 10) / 10 : null)
    } catch (e: any) {
      setDraftError(e.message || '导出失败')
    } finally {
      setExportingDraft(false)
    }
  }

  // fetch + blob 触发下载, 绕开 <a download> 跨源失效
  const handleDownload = async () => {
    if (downloading) return
    setDownloading(true)
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      const baseName = (data.audio_label || '数字人').replace(/[\\/:*?"<>|]/g, '_')
      const ext = (data.video_url.match(/\.(\w{2,5})(?:\?|$)/)?.[1] || 'mp4').toLowerCase()
      a.download = `${baseName}_${durationSec ? durationSec.toFixed(1) + 's' : 'video'}.${ext}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(blobUrl)
    } catch {
      window.open(url, '_blank')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3 flex flex-col gap-3">
      {data.text_preview && (
        <div className="text-xs text-[var(--text-3)] leading-relaxed whitespace-pre-wrap line-clamp-2">
          {data.text_preview}
        </div>
      )}
      <div className="relative w-full rounded-lg overflow-hidden bg-black">
        <video
          ref={videoRef}
          src={url}
          className="w-full max-h-[420px] object-contain"
          onTimeUpdate={onTime}
          onEnded={() => { setPlaying(false); setProgress(0) }}
          onClick={toggle}
          preload="none"
          playsInline
        />
        {!playing && (
          <button
            onClick={toggle}
            className="absolute inset-0 flex items-center justify-center cursor-pointer group"
            aria-label="播放"
          >
            <span className="w-14 h-14 rounded-full bg-white/85 group-hover:bg-white text-black flex items-center justify-center shadow-xl transition-colors">
              <Play size={22} fill="currentColor" className="ml-1"/>
            </span>
          </button>
        )}
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={toggle}
          className="w-9 h-9 rounded-full bg-[var(--text)] text-[var(--bg)] flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity flex-shrink-0"
        >
          {playing ? <Pause size={14} fill="currentColor"/> : <Play size={14} fill="currentColor" className="ml-0.5"/>}
        </button>
        <div className="flex-1 min-w-0">
          <div className="h-1.5 rounded-full bg-[var(--bg-hover)] overflow-hidden">
            <div className="h-full bg-[var(--text)] transition-all" style={{ width: `${progress}%` }}/>
          </div>
          <div className="flex items-center justify-between mt-1.5 text-xs text-[var(--text-3)]">
            <span>{data.audio_label || '数字人'} {data.width && data.height ? `· ${data.width}×${data.height}` : ''}</span>
            <span>{durationSec ? `${durationSec.toFixed(1)}s` : ''}</span>
          </div>
        </div>
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="w-9 h-9 rounded-lg flex items-center justify-center text-[var(--text-2)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] cursor-pointer flex-shrink-0 disabled:opacity-50 disabled:cursor-wait"
          title="下载"
        >
          {downloading ? <Loader2 size={14} className="animate-spin"/> : <Download size={14}/>}
        </button>
      </div>

      {data.jianying_payload && (
        <div className="border-t border-[var(--border)] pt-3 flex flex-col gap-2">
          {!draftUrl ? (
            <button
              onClick={handleExportDraft}
              disabled={exportingDraft}
              className="self-start flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-[var(--text-2)] border border-[var(--border)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] disabled:opacity-50 disabled:cursor-wait cursor-pointer transition-colors"
              title="生成剪映草稿 zip, 解压到剪映草稿目录就能在剪映里继续编辑"
            >
              {exportingDraft ? <Loader2 size={12} className="animate-spin"/> : <FileBox size={12}/>}
              {exportingDraft ? '正在打包草稿 (拉素材+组装, 约 30-60 秒)' : '导出剪映草稿 (按句分段)'}
            </button>
          ) : (
            <div className="flex flex-col gap-1.5 text-xs">
              <a href={draftUrl} target="_blank" rel="noopener noreferrer"
                className="self-start flex items-center gap-2 px-3 py-1.5 rounded-lg text-[var(--text)] border border-[var(--border)] hover:bg-[var(--bg-hover)] transition-colors">
                <Download size={12}/>
                下载草稿 zip{draftSizeMB ? ` (${draftSizeMB} MB)` : ''}
              </a>
              <p className="text-[var(--text-3)] leading-relaxed">
                解压到剪映草稿目录后, 打开剪映就能看到一条按句分段的时间线 (视频/音频/字幕 3 轨道).
                <br/>
                Win: <code className="text-[10px] bg-[var(--bg-hover)] px-1 rounded">%LOCALAPPDATA%\JianyingPro\User Data\Projects\com.lveditor.draft\</code>
                <br/>
                Mac: <code className="text-[10px] bg-[var(--bg-hover)] px-1 rounded">~/Movies/JianyingPro/User Data/Projects/com.lveditor.draft/</code>
              </p>
            </div>
          )}
          {draftError && <p className="text-xs text-red-400">{draftError}</p>}
        </div>
      )}
    </div>
  )
}
