import { useEffect, useMemo, useRef, useState } from 'react'
import { Play, Loader2, Check, X, Scissors, Undo2 } from 'lucide-react'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.js'

interface Word {
  start: number
  end: number
  word: string
}

interface Segment {
  start: number
  end: number
  text: string
  words: Word[]
}

interface CleanResponse {
  source_file: string
  video_url_full: string  // 含完整域名 (apiBase + video_url_path)
  duration: number
  transcription: string
  segments: Segment[]
  suggested_removals?: {
    silences?: { start: number; end: number }[]
    word_gaps?: { start: number; end: number }[]
    repeats?: { start: number; end: number }[]
    fillers?: { start: number; end: number }[]
  }
}

interface Props {
  data: CleanResponse
  apiBase: string
  onCancel: () => void
  onDone: (videoUrlFull: string, duration: number, transcription: string) => void
}

interface WordToken {
  segIdx: number
  wordIdx: number
  start: number
  end: number
  word: string
}

export function NarrationVideoEditor({ data, apiBase, onCancel, onDone }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const textContainerRef = useRef<HTMLDivElement>(null)
  const wsContainerRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WaveSurfer | null>(null)
  const regionsRef = useRef<any>(null)

  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [deletedKeys, setDeletedKeys] = useState<Set<string>>(new Set())
  const [finalizing, setFinalizing] = useState(false)
  const [error, setError] = useState('')
  const [hasSelection, setHasSelection] = useState(false)

  // 摊平 segments → word tokens
  const allWords: WordToken[] = useMemo(() => {
    const result: WordToken[] = []
    data.segments.forEach((seg, segIdx) => {
      if (seg.words && seg.words.length > 0) {
        seg.words.forEach((w, wordIdx) => {
          result.push({ segIdx, wordIdx, start: w.start, end: w.end, word: w.word })
        })
      } else {
        result.push({ segIdx, wordIdx: 0, start: seg.start, end: seg.end, word: seg.text })
      }
    })
    return result
  }, [data])

  const wordKey = (t: WordToken) => `${t.segIdx}_${t.wordIdx}`

  // 初始化预删除 (静音 + 词间隔 + 重复 + 填充词)
  useEffect(() => {
    if (!data.suggested_removals) return
    const sr = data.suggested_removals
    const removeRanges = [
      ...(sr.silences || []),
      ...(sr.word_gaps || []),
      ...(sr.repeats || []),
      ...(sr.fillers || []),
    ]
    const initial = new Set<string>()
    for (const t of allWords) {
      const mid = (t.start + t.end) / 2
      for (const r of removeRanges) {
        if (mid >= r.start && mid <= r.end) {
          initial.add(wordKey(t))
          break
        }
      }
    }
    setDeletedKeys(initial)
  }, [data, allWords])

  // 计算保留段
  const keepRanges = useMemo(() => {
    const ranges: [number, number][] = []
    let start: number | null = null
    let lastEnd: number | null = null
    for (const t of allWords) {
      const isDel = deletedKeys.has(wordKey(t))
      if (!isDel) {
        if (start === null) start = t.start
        lastEnd = t.end
      } else if (start !== null && lastEnd !== null) {
        ranges.push([start, lastEnd])
        start = null
        lastEnd = null
      }
    }
    if (start !== null && lastEnd !== null) {
      ranges.push([start, lastEnd])
    }
    return ranges
  }, [allWords, deletedKeys])

  const cleanedDuration = useMemo(() => {
    return keepRanges.reduce((sum, [s, e]) => sum + (e - s), 0)
  }, [keepRanges])

  // 当前播放位置是否在删除段 (不在任何 keepRange 内)
  const isInDeletedRange = useMemo(() => {
    if (keepRanges.length === 0) return false
    return !keepRanges.some(([s, e]) => currentTime >= s - 0.01 && currentTime <= e + 0.01)
  }, [currentTime, keepRanges])

  // 用 ref 持有最新的 keepRanges, 给 video.ontimeupdate 读
  const keepRangesRef = useRef<[number, number][]>([])
  useEffect(() => { keepRangesRef.current = keepRanges }, [keepRanges])

  // seek 进行中标志: 防止 video 大文件 seek 慢, ontimeupdate 多次触发导致重复 seek 死循环
  const seekingRef = useRef(false)
  const lastJumpToRef = useRef<number>(-1)

  // 删除段静音 (立刻生效, 不依赖 seek 时机)
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.muted = isInDeletedRange
  }, [isInDeletedRange])

  // 视频元数据加载完后, 初始化 wavesurfer 绑定到 video 元素
  // (wavesurfer 会从视频提取音轨显示波形, 进度自动跟视频同步)
  useEffect(() => {
    if (!ready || !videoRef.current || !wsContainerRef.current) return
    const regions = RegionsPlugin.create()
    const ws = WaveSurfer.create({
      container: wsContainerRef.current,
      media: videoRef.current,
      height: 50,
      waveColor: '#94a3b8',
      progressColor: '#0ea5e9',
      cursorColor: '#475569',
      barWidth: 2,
      barRadius: 2,
      plugins: [regions],
    })
    wsRef.current = ws
    regionsRef.current = regions
    return () => {
      try { ws.destroy() } catch {}
      wsRef.current = null
      regionsRef.current = null
    }
  }, [ready])

  // 同步删除段到 wavesurfer regions (红色阴影)
  useEffect(() => {
    const regions = regionsRef.current
    if (!regions) return
    regions.clearRegions()
    // 把连续的删除词合并成区间
    const delRanges: [number, number][] = []
    let s: number | null = null
    let lastE: number | null = null
    for (const t of allWords) {
      const isDel = deletedKeys.has(wordKey(t))
      if (isDel) {
        if (s === null) s = t.start
        lastE = t.end
      } else if (s !== null && lastE !== null) {
        delRanges.push([s, lastE])
        s = null
        lastE = null
      }
    }
    if (s !== null && lastE !== null) delRanges.push([s, lastE])
    for (const [start, end] of delRanges) {
      regions.addRegion({
        start, end,
        color: 'rgba(220, 38, 38, 0.28)',
        drag: false,
        resize: false,
      })
    }
  }, [deletedKeys, allWords])

  // 视频事件
  const onLoadedMetadata = () => setReady(true)

  const onTimeUpdate = () => {
    const v = videoRef.current
    if (!v) return
    setCurrentTime(v.currentTime)
    // 不再自动 seek 跳过删除段 — 视频大文件 seek 慢 + wavesurfer 双向绑定
    // 容易出 bug (重复跳第一句 / 卡回去 / 死循环).
    // 改用 muted + 红色蒙层: 用户听不到 + 看得到删除段.
    // 真正的剪辑效果以"完成导出"后的新视频为准.
  }

  const onSeeked = () => {
    seekingRef.current = false
  }

  const togglePlay = () => {
    const v = videoRef.current
    if (!v || !ready) return
    if (v.paused) v.play()
    else v.pause()
  }

  const toggleWord = (key: string) => {
    setDeletedKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const seekToWord = (t: WordToken) => {
    const v = videoRef.current
    if (!v || !ready) return
    v.currentTime = t.start
  }

  // 拖选 → 删除选中范围内的词
  const deleteSelected = () => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) return false
    const range = sel.getRangeAt(0)
    const container = textContainerRef.current
    if (!container || !container.contains(range.commonAncestorContainer)) return false

    const spans = container.querySelectorAll<HTMLElement>('[data-word-key]')
    const newDeleted = new Set(deletedKeys)
    let anyDeleted = false
    spans.forEach(span => {
      const key = span.dataset.wordKey
      if (!key) return
      const spanRange = document.createRange()
      spanRange.selectNodeContents(span)
      const intersects = !(
        range.compareBoundaryPoints(Range.END_TO_START, spanRange) >= 0 ||
        range.compareBoundaryPoints(Range.START_TO_END, spanRange) <= 0
      )
      if (intersects) {
        newDeleted.add(key)
        anyDeleted = true
      }
    })
    if (anyDeleted) {
      setDeletedKeys(newDeleted)
      sel.removeAllRanges()
      return true
    }
    return false
  }

  // 监听选区变化
  useEffect(() => {
    const onSelChange = () => {
      const sel = window.getSelection()
      const container = textContainerRef.current
      if (!sel || sel.isCollapsed || !container) {
        setHasSelection(false)
        return
      }
      const inside = container.contains(sel.anchorNode) && container.contains(sel.focusNode)
      setHasSelection(inside && sel.toString().trim().length > 0)
    }
    document.addEventListener('selectionchange', onSelChange)
    return () => document.removeEventListener('selectionchange', onSelChange)
  }, [])

  const restoreAll = () => setDeletedKeys(new Set())

  const finalize = async () => {
    if (keepRanges.length === 0) {
      setError('全部都删了, 至少保留一段')
      return
    }
    setFinalizing(true)
    setError('')
    try {
      const res = await fetch(apiBase + '/api/voice/finalize-narration-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_file: data.source_file,
          keep_ranges: keepRanges,
        }),
      })
      const result = await res.json()
      if (!res.ok || !result.success) {
        setError(result.detail || result.error || '导出失败')
        return
      }
      const finalUrl = apiBase + result.video_url_path
      const finalText = allWords.filter(t => !deletedKeys.has(wordKey(t))).map(t => t.word).join('')
      onDone(finalUrl, result.duration, finalText)
    } catch (e: any) {
      setError(e.message || '导出失败')
    } finally {
      setFinalizing(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* 顶部统计 */}
      <div className="flex items-center justify-between text-xs text-[var(--text-3)]">
        <div>
          原 {data.duration.toFixed(1)}s →{' '}
          <span className="text-[var(--text)] font-medium">{cleanedDuration.toFixed(1)}s</span>
          {' '}({deletedKeys.size} 词被删)
        </div>
        <div>{currentTime.toFixed(1)}s / {data.duration.toFixed(1)}s</div>
      </div>

      {/* 视频播放器 */}
      <div className="relative rounded-lg overflow-hidden bg-black">
        <video
          ref={videoRef}
          src={data.video_url_full}
          className="w-full max-h-[300px] object-contain"
          onLoadedMetadata={onLoadedMetadata}
          onTimeUpdate={onTimeUpdate}
          onSeeked={onSeeked}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onClick={togglePlay}
          playsInline
        />
        {!playing && ready && (
          <button
            onClick={togglePlay}
            className="absolute inset-0 flex items-center justify-center cursor-pointer group"
          >
            <span className="w-12 h-12 rounded-full bg-white/85 group-hover:bg-white text-black flex items-center justify-center shadow-xl transition-colors">
              <Play size={20} fill="currentColor" className="ml-0.5"/>
            </span>
          </button>
        )}
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center text-white/70 text-xs">
            <Loader2 size={20} className="animate-spin"/>
          </div>
        )}
        {/* 当前在删除段时的红色蒙层 + 标识 (跟 muted 状态联动) */}
        {isInDeletedRange && playing && (
          <div className="absolute inset-0 bg-red-500/35 flex items-center justify-center pointer-events-none">
            <span className="text-white text-xs font-medium bg-black/60 px-3 py-1 rounded-full">
              已删除段 (跳过中)
            </span>
          </div>
        )}
      </div>

      {/* 波形时间轴 (绑定到上面 video 元素, 进度自动同步, 删除段红色阴影) */}
      <div className="rounded-lg bg-[var(--bg-hover)] px-3 py-2">
        <div ref={wsContainerRef} className="w-full"/>
      </div>

      {/* 工具栏 */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => deleteSelected()}
          disabled={!hasSelection}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text)] hover:bg-red-950/30 hover:text-red-400 hover:border-red-500/40 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
        >
          <Scissors size={12}/> 删除选中
        </button>
        <button
          type="button"
          onClick={restoreAll}
          disabled={deletedKeys.size === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          <Undo2 size={12}/> 全部恢复
        </button>
        <div className="text-xs text-[var(--text-3)] ml-auto">
          {deletedKeys.size} 词被删
        </div>
      </div>

      {/* 转录字幕 */}
      <div ref={textContainerRef} tabIndex={0} className="text-sm leading-loose max-h-40 overflow-y-auto bg-[var(--bg-hover)] rounded-[12px] p-3 outline-none focus:ring-1 focus:ring-[var(--text-3)]">
        {allWords.length === 0 ? (
          <div className="text-[var(--text-3)]">没有转录到内容</div>
        ) : (
          allWords.map((t) => {
            const key = wordKey(t)
            const isDel = deletedKeys.has(key)
            const isCurrent = currentTime >= t.start && currentTime <= t.end
            return (
              <span
                key={key}
                data-word-key={key}
                onClick={() => {
                  const sel = window.getSelection()
                  if (sel && !sel.isCollapsed && sel.toString().length > 0) return
                  toggleWord(key)
                }}
                onDoubleClick={() => seekToWord(t)}
                title={`${t.start.toFixed(2)}s - ${t.end.toFixed(2)}s`}
                className={`cursor-pointer px-0.5 rounded transition-colors ${
                  isDel
                    ? 'line-through text-[var(--text-3)] opacity-50'
                    : isCurrent
                      ? 'bg-yellow-400/40 text-[var(--text)]'
                      : 'text-[var(--text)] hover:bg-[var(--bg-card)]'
                }`}
              >
                {t.word}
              </span>
            )
          })
        )}
      </div>

      {error && <div className="text-xs text-red-400">{error}</div>}

      <div className="text-xs text-[var(--text-3)]">
        💡 拖选文字 → 点 <span className="text-[var(--text-2)]">删除选中</span> · 单击词切换删除 · 双击词跳到对应时间
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg text-sm text-[var(--text-2)] hover:bg-[var(--bg-hover)] cursor-pointer flex items-center gap-1.5"
        >
          <X size={14}/> 取消
        </button>
        <button
          onClick={finalize}
          disabled={finalizing || !ready}
          className="px-3 py-1.5 rounded-lg text-sm bg-[var(--text)] text-[var(--bg)] hover:opacity-80 cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
        >
          {finalizing ? <Loader2 size={14} className="animate-spin"/> : <Check size={14}/>}
          {finalizing ? '导出中...' : '完成导出'}
        </button>
      </div>
    </div>
  )
}
