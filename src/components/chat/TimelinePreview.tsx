import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Pause, Play, X } from 'lucide-react'
import type { FootageSentenceItem, VideoAsset } from '../../types'

interface Props {
  videoUrl: string
  segmentTimes: { start: number; end: number }[]
  items: FootageSentenceItem[]
  selected: Record<number, VideoAsset[]>
  onClose: () => void
}

// PIP 配置 (V1: 全局, 全片统一)
type PipShape = 'circle' | 'rounded'
type PipPos = 'tl' | 'tr' | 'bl' | 'br' | 'center'
type PipSize = 'S' | 'M' | 'L'

const POS_LABEL: Record<PipPos, string> = { tl: '左上', tr: '右上', bl: '左下', br: '右下', center: '居中' }
const SIZE_RATIO: Record<PipSize, number> = { S: 0.20, M: 0.25, L: 0.33 }

export function TimelinePreview({ videoUrl, segmentTimes, items, selected, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [shape, setShape] = useState<PipShape>('rounded')
  const [pos, setPos] = useState<PipPos>('bl')
  const [size, setSize] = useState<PipSize>('M')

  // 当前镜头索引: currentTime 落在哪个 segment 时间段
  const currentShotIdx = segmentTimes.findIndex(s => currentTime >= s.start && currentTime < s.end)

  // 该镜头用户选了哪些素材 (多个素材按时长平均切)
  const currentShotAssets: VideoAsset[] = currentShotIdx >= 0 ? (selected[currentShotIdx] || []) : []
  const currentBroll: VideoAsset | null = (() => {
    if (currentShotIdx < 0 || currentShotAssets.length === 0) return null
    const seg = segmentTimes[currentShotIdx]
    const segLen = seg.end - seg.start
    const sliceLen = segLen / currentShotAssets.length
    const subIdx = Math.min(Math.floor((currentTime - seg.start) / sliceLen), currentShotAssets.length - 1)
    return currentShotAssets[subIdx] || null
  })()

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onTime = () => setCurrentTime(v.currentTime)
    const onMeta = () => setDuration(v.duration || 0)
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    v.addEventListener('timeupdate', onTime)
    v.addEventListener('loadedmetadata', onMeta)
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    return () => {
      v.removeEventListener('timeupdate', onTime)
      v.removeEventListener('loadedmetadata', onMeta)
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
    }
  }, [])

  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) v.play()
    else v.pause()
  }

  const seekTo = (t: number) => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = Math.max(0, Math.min(t, duration))
  }

  // PIP 样式 (CSS 预览, 跟最终 ffmpeg 合成保持一致)
  const pipStyle: React.CSSProperties = (() => {
    const pad = 12
    const s: React.CSSProperties = { position: 'absolute', overflow: 'hidden' }
    if (pos === 'tl') { s.top = pad; s.left = pad }
    else if (pos === 'tr') { s.top = pad; s.right = pad }
    else if (pos === 'bl') { s.bottom = pad; s.left = pad }
    else if (pos === 'br') { s.bottom = pad; s.right = pad }
    else { s.top = '50%'; s.left = '50%'; s.transform = 'translate(-50%, -50%)' }
    s.borderRadius = shape === 'circle' ? '50%' : '12px'
    s.boxShadow = '0 4px 16px rgba(0,0,0,0.4)'
    return s
  })()

  const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`

  const modal = (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative bg-[var(--bg-card)] border border-[var(--border)] rounded-[22px] shadow-ios-lg w-full max-w-4xl max-h-[92vh] flex flex-col sheet-enter overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div className="text-base font-semibold text-[var(--text)]">预览效果 · 双轨合成示意</div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-[var(--text-2)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors">
            <X size={16}/>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          {/* 预览画面: b-roll 全屏 + 口播 PIP 小窗 */}
          <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden" style={{ maxHeight: '50vh' }}>
            {/* 上层 b-roll (按当前 currentShotIdx 显示对应素材的缩略图) */}
            {currentBroll ? (
              <img src={currentBroll.thumbnail} alt="" className="absolute inset-0 w-full h-full object-cover" />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-[var(--text-3)] text-xs">
                {currentShotIdx >= 0 ? '当前镜头未选素材, 显示口播原画面' : '准备开始'}
              </div>
            )}
            {/* 口播 PIP 小窗 */}
            <video
              ref={videoRef}
              src={videoUrl}
              playsInline
              style={{
                ...pipStyle,
                width: `${SIZE_RATIO[size] * 100}%`,
                aspectRatio: '16/9',
                objectFit: 'cover',
              }}
            />
          </div>

          {/* 控制栏 */}
          <div className="flex items-center gap-3 px-1">
            <button onClick={togglePlay} className="w-10 h-10 rounded-full bg-[var(--text)] text-[var(--bg)] flex items-center justify-center hover:opacity-80 cursor-pointer transition-opacity flex-shrink-0">
              {playing ? <Pause size={16}/> : <Play size={16} className="ml-0.5"/>}
            </button>
            <div className="flex-1">
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={currentTime}
                onChange={(e) => seekTo(Number(e.target.value))}
                className="w-full accent-current cursor-pointer"
              />
            </div>
            <div className="text-xs text-[var(--text-3)] font-mono flex-shrink-0">
              {fmt(currentTime)} / {fmt(duration)}
            </div>
          </div>

          {/* 双轨道时间轴 */}
          <div className="border border-[var(--border)] rounded-xl overflow-hidden">
            {/* 上轨: b-roll 缩略图条 (按 segment 时长占比) */}
            <div className="flex h-12 bg-[var(--bg-hover)] relative">
              {duration > 0 && segmentTimes.map((seg, i) => {
                const widthPct = ((seg.end - seg.start) / duration) * 100
                const assets = selected[i] || []
                const isCurrent = i === currentShotIdx
                return (
                  <div
                    key={i}
                    onClick={() => seekTo(seg.start)}
                    className={`flex-shrink-0 border-r border-[var(--border)] cursor-pointer hover:opacity-80 transition-opacity overflow-hidden flex ${isCurrent ? 'ring-2 ring-inset ring-[var(--text)]' : ''}`}
                    style={{ width: `${widthPct}%` }}
                    title={`镜 ${i + 1}: ${items[i]?.text?.slice(0, 30)}`}
                  >
                    {assets.length > 0 ? (
                      assets.map((a, j) => (
                        <img key={`${a.source}-${a.id}-${j}`} src={a.thumbnail} className="h-full object-cover flex-1" alt="" />
                      ))
                    ) : (
                      <div className="flex-1 flex items-center justify-center text-[10px] text-[var(--text-3)]">未选</div>
                    )}
                  </div>
                )
              })}
              {/* 时间游标 */}
              {duration > 0 && (
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-red-500 pointer-events-none"
                  style={{ left: `${(currentTime / duration) * 100}%` }}
                />
              )}
            </div>
            {/* 下轨: 原视频示意条 (灰色 + 文案预览) */}
            <div className="flex h-8 bg-[var(--bg-input)] border-t border-[var(--border)] relative">
              {duration > 0 && segmentTimes.map((seg, i) => {
                const widthPct = ((seg.end - seg.start) / duration) * 100
                return (
                  <div
                    key={i}
                    className="flex-shrink-0 border-r border-[var(--border)] flex items-center px-2 overflow-hidden"
                    style={{ width: `${widthPct}%` }}
                  >
                    <span className="text-[10px] text-[var(--text-3)] truncate">{items[i]?.text}</span>
                  </div>
                )
              })}
              {duration > 0 && (
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-red-500 pointer-events-none"
                  style={{ left: `${(currentTime / duration) * 100}%` }}
                />
              )}
            </div>
          </div>

          {/* PIP 配置 */}
          <div className="border border-[var(--border)] rounded-xl p-3 flex flex-col gap-3">
            <div className="text-xs font-medium text-[var(--text-2)]">画中画样式 (口播小窗)</div>

            <div className="flex items-center gap-3">
              <span className="text-xs text-[var(--text-3)] w-12">形状</span>
              <div className="flex gap-2">
                {(['rounded', 'circle'] as PipShape[]).map(s => (
                  <button
                    key={s}
                    onClick={() => setShape(s)}
                    className={`px-3 py-1.5 rounded-lg text-xs border transition-all cursor-pointer ${shape === s ? 'bg-[var(--text)] text-[var(--bg)] border-[var(--text)]' : 'bg-[var(--bg-card)] text-[var(--text-2)] border-[var(--border)] hover:border-[var(--text-3)]'}`}
                  >
                    {s === 'circle' ? '○ 圆形' : '▢ 圆角矩形'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs text-[var(--text-3)] w-12">位置</span>
              <div className="flex gap-2">
                {(['tl', 'tr', 'bl', 'br', 'center'] as PipPos[]).map(p => (
                  <button
                    key={p}
                    onClick={() => setPos(p)}
                    className={`px-3 py-1.5 rounded-lg text-xs border transition-all cursor-pointer ${pos === p ? 'bg-[var(--text)] text-[var(--bg)] border-[var(--text)]' : 'bg-[var(--bg-card)] text-[var(--text-2)] border-[var(--border)] hover:border-[var(--text-3)]'}`}
                  >
                    {POS_LABEL[p]}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs text-[var(--text-3)] w-12">大小</span>
              <div className="flex gap-2">
                {(['S', 'M', 'L'] as PipSize[]).map(sz => (
                  <button
                    key={sz}
                    onClick={() => setSize(sz)}
                    className={`px-3 py-1.5 rounded-lg text-xs border transition-all cursor-pointer ${size === sz ? 'bg-[var(--text)] text-[var(--bg)] border-[var(--text)]' : 'bg-[var(--bg-card)] text-[var(--text-2)] border-[var(--border)] hover:border-[var(--text-3)]'}`}
                  >
                    {sz}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <p className="text-[11px] text-[var(--text-3)] leading-relaxed">
            💡 这是预览示意图. 当前 PIP 样式 / 位置 / 大小会在最终合成时按这个布局生效.
            点上方时间轴上的镜头可跳转, 同步看到对应 b-roll. 多素材按时长平均切.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--border)]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-[var(--text-2)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors cursor-pointer"
          >
            关闭
          </button>
          <button
            disabled
            title="下一步要做的, 等"
            className="px-4 py-2 text-sm bg-[var(--bg-hover)] text-[var(--text-3)] rounded-lg cursor-not-allowed"
          >
            一键合成 (下一步)
          </button>
        </div>
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}
