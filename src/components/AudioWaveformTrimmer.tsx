import { useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.js'
import { Play, Pause, Loader2 } from 'lucide-react'

interface Props {
  audioUrl: string
  /** 默认 trim 选区 (秒). 不传默认全段 */
  initialStart?: number
  initialEnd?: number
  /** 用户改了起止时间时调 (双向同步外面的 state). */
  onChange?: (start: number, end: number) => void
  /** 父级 ref 接口: 暴露当前 start/end 值给父级取 */
  onReady?: (api: { getStart: () => number; getEnd: () => number; getDuration: () => number }) => void
}

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) return '00:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

export function AudioWaveformTrimmer({ audioUrl, initialStart, initialEnd, onChange, onReady }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WaveSurfer | null>(null)
  const regionRef = useRef<any>(null)
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [start, setStart] = useState(initialStart ?? 0)
  const [end, setEnd] = useState(initialEnd ?? 0)

  // sync to parent
  useEffect(() => { onChange?.(start, end) }, [start, end])

  useEffect(() => {
    if (!containerRef.current) return
    const regions = RegionsPlugin.create()
    const ws = WaveSurfer.create({
      container: containerRef.current,
      height: 80,
      waveColor: '#94a3b8',
      progressColor: '#0ea5e9',
      cursorColor: '#475569',
      barWidth: 2,
      barRadius: 2,
      url: audioUrl,
      plugins: [regions],
    })
    wsRef.current = ws

    ws.on('ready', () => {
      const d = ws.getDuration()
      setDuration(d)
      const s = initialStart ?? 0
      const e = initialEnd ?? d
      setStart(s); setEnd(e)
      const region = regions.addRegion({
        start: s, end: e,
        color: 'rgba(14, 165, 233, 0.18)',     // sky-500 alpha
        drag: true, resize: true,
      })
      regionRef.current = region
      region.on('update', () => {
        setStart(region.start)
        setEnd(region.end)
      })
      // 播放只在 region 内, 到尾自动停 (wavesurfer 默认会播全段, 我们手动控)
      ws.on('timeupdate', (t) => {
        if (ws.isPlaying() && t >= region.end) {
          ws.pause()
          ws.setTime(region.start)
        }
      })
      setReady(true)
      onReady?.({
        getStart: () => regionRef.current?.start ?? 0,
        getEnd: () => regionRef.current?.end ?? d,
        getDuration: () => d,
      })
    })
    ws.on('play', () => setPlaying(true))
    ws.on('pause', () => setPlaying(false))

    return () => {
      try { ws.destroy() } catch {}
      wsRef.current = null
      regionRef.current = null
    }
  }, [audioUrl])

  const playRegion = () => {
    const ws = wsRef.current
    const region = regionRef.current
    if (!ws || !region) return
    if (ws.isPlaying()) { ws.pause(); return }
    ws.setTime(region.start)
    ws.play()
  }

  // 手动输入起止 (双向: 改了同步到 wavesurfer region)
  const updateStart = (v: number) => {
    const clamped = Math.max(0, Math.min(v, end - 0.5))
    setStart(clamped)
    if (regionRef.current) {
      regionRef.current.setOptions({ start: clamped, end })
    }
  }
  const updateEnd = (v: number) => {
    const clamped = Math.min(duration, Math.max(v, start + 0.5))
    setEnd(clamped)
    if (regionRef.current) {
      regionRef.current.setOptions({ start, end: clamped })
    }
  }

  const selectedDuration = end - start

  return (
    <div className="flex flex-col gap-2">
      {/* 波形容器 */}
      <div className="relative">
        <div ref={containerRef} className="w-full"/>
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg-card)]/60 text-xs text-[var(--text-3)]">
            <Loader2 size={14} className="animate-spin mr-2"/>加载波形...
          </div>
        )}
      </div>

      {/* 起止时间 + 选区时长 + 播放 */}
      <div className="flex items-center gap-3 text-xs">
        <button onClick={playRegion} disabled={!ready}
          className="w-8 h-8 rounded-full bg-[var(--text)] text-[var(--bg)] flex items-center justify-center cursor-pointer hover:opacity-80 disabled:opacity-30 flex-shrink-0">
          {playing ? <Pause size={12} fill="currentColor"/> : <Play size={12} fill="currentColor" className="ml-0.5"/>}
        </button>
        <div className="flex items-center gap-1.5 text-[var(--text-2)]">
          <span>起</span>
          <input type="number" min={0} max={duration} step={0.1}
            value={start.toFixed(1)}
            onChange={e => updateStart(Number(e.target.value))}
            className="w-16 bg-[var(--bg-input)] border border-[var(--border)] rounded px-1.5 py-1 text-[var(--text)]"/>
          <span className="text-[10px] text-[var(--text-3)]">{fmtTime(start)}</span>
        </div>
        <div className="flex items-center gap-1.5 text-[var(--text-2)]">
          <span>止</span>
          <input type="number" min={0} max={duration} step={0.1}
            value={end.toFixed(1)}
            onChange={e => updateEnd(Number(e.target.value))}
            className="w-16 bg-[var(--bg-input)] border border-[var(--border)] rounded px-1.5 py-1 text-[var(--text)]"/>
          <span className="text-[10px] text-[var(--text-3)]">{fmtTime(end)}</span>
        </div>
        <div className="ml-auto text-[var(--text-3)]">
          选 <span className="text-[var(--text)] font-medium">{selectedDuration.toFixed(1)}s</span> / {duration.toFixed(1)}s
        </div>
      </div>
      <div className="text-[10px] text-[var(--text-3)]">
        拖蓝色框边缘改起止, 或直接改数字. 播放按钮只播选中段.
      </div>
    </div>
  )
}
