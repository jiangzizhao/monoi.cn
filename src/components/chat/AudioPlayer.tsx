import { useRef, useState } from 'react'
import { Play, Pause, Download } from 'lucide-react'
import type { AudioResult } from '../../types'

export function AudioPlayer({ data }: { data: AudioResult }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)

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
        <a
          href={fullUrl}
          download
          className="w-9 h-9 rounded-lg flex items-center justify-center text-[var(--text-2)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] cursor-pointer flex-shrink-0"
          title="下载"
        >
          <Download size={14}/>
        </a>
      </div>
      <audio ref={audioRef} src={fullUrl} onTimeUpdate={onTime} onEnded={() => { setPlaying(false); setProgress(0) }} preload="metadata"/>
    </div>
  )
}
