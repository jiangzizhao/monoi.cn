import { useRef, useState } from 'react'
import { Play, Pause, Download, Loader2 } from 'lucide-react'
import type { AudioResult } from '../../types'

export function AudioPlayer({ data }: { data: AudioResult }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [downloading, setDownloading] = useState(false)

  const fullUrl = data.audio_url.startsWith('http')
    ? data.audio_url
    : `/api/proxy?path=${encodeURIComponent(data.audio_url)}`

  const toggle = () => {
    const a = audioRef.current
    if (!a) return
    if (playing) { a.pause(); setPlaying(false) }
    else { a.play(); setPlaying(true) }
  }

  const onTime = () => {
    const a = audioRef.current
    if (!a || !a.duration) return
    setProgress((a.currentTime / a.duration) * 100)
  }

  // 通过 fetch + blob 触发下载,绕开 <a download> 在跨源/代理场景下失效的问题
  const handleDownload = async () => {
    if (downloading) return
    setDownloading(true)
    try {
      const res = await fetch(fullUrl)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      // 文件名: 优先用音色 label, 否则用 audio_url 末尾
      const baseName = (data.voice_label || data.preset_key || 'voice').replace(/[\\/:*?"<>|]/g, '_')
      const ext = (data.audio_url.match(/\.(\w{2,5})(?:\?|$)/)?.[1] || 'wav').toLowerCase()
      a.download = `${baseName}_${Math.round((data.duration_seconds ?? 0) * 10) / 10}s.${ext}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(blobUrl)
    } catch (e) {
      // 兜底: 新窗口打开,让用户右键另存
      window.open(fullUrl, '_blank')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 flex flex-col gap-3">
      {data.text_preview && (
        <div className="text-xs text-[var(--text-3)] leading-relaxed whitespace-pre-wrap line-clamp-3">
          {data.text_preview}
        </div>
      )}
      <div className="flex items-center gap-3">
        <button
          onClick={toggle}
          className="w-10 h-10 rounded-full bg-[var(--text)] text-[var(--bg)] flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity flex-shrink-0"
        >
          {playing ? <Pause size={16} fill="currentColor"/> : <Play size={16} fill="currentColor" className="ml-0.5"/>}
        </button>
        <div className="flex-1 min-w-0">
          <div className="h-1.5 rounded-full bg-[var(--bg-hover)] overflow-hidden">
            <div className="h-full bg-[var(--text)] transition-all" style={{ width: `${progress}%` }}/>
          </div>
          <div className="flex items-center justify-between mt-1.5 text-xs text-[var(--text-3)]">
            <span>{data.voice_label || data.preset_key || '配音'} · {data.speed || '1.0x'}</span>
            <span>{data.duration_seconds ? `${data.duration_seconds.toFixed(1)}s` : ''}</span>
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
      <audio ref={audioRef} src={fullUrl} onTimeUpdate={onTime} onEnded={() => { setPlaying(false); setProgress(0) }} preload="metadata"/>
    </div>
  )
}
