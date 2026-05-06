import { useEffect, useMemo, useRef, useState } from 'react'
import { Play, Pause, Loader2, Check, X, Scissors, Undo2 } from 'lucide-react'
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
  audio_url_full: string  // 含完整域名
  duration: number
  transcription: string
  segments: Segment[]
  suggested_removals?: {
    silences: { start: number; end: number }[]
    repeats: { start: number; end: number }[]
  }
}

interface Props {
  data: CleanResponse
  apiBase: string  // e.g. https://monoi.nat100.top
  onCancel: () => void
  onDone: (audioUrlFull: string, duration: number, transcription: string) => void
}

interface WordToken {
  segIdx: number
  wordIdx: number
  start: number
  end: number
  word: string
}

export function NarrationEditor({ data, apiBase, onCancel, onDone }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WaveSurfer | null>(null)
  const regionsRef = useRef<any>(null)

  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [deletedKeys, setDeletedKeys] = useState<Set<string>>(new Set())
  const [finalizing, setFinalizing] = useState(false)
  const [error, setError] = useState('')
  const [hasSelection, setHasSelection] = useState(false)

  // 把 segments 摊平成 word tokens
  const allWords: WordToken[] = useMemo(() => {
    const result: WordToken[] = []
    data.segments.forEach((seg, segIdx) => {
      if (seg.words && seg.words.length > 0) {
        seg.words.forEach((w, wordIdx) => {
          result.push({ segIdx, wordIdx, start: w.start, end: w.end, word: w.word })
        })
      } else {
        // 没有 word 级数据，用整段
        result.push({ segIdx, wordIdx: 0, start: seg.start, end: seg.end, word: seg.text })
      }
    })
    return result
  }, [data])

  const wordKey = (t: WordToken) => `${t.segIdx}_${t.wordIdx}`

  // 初始化预删段（建议删除的）
  useEffect(() => {
    if (!data.suggested_removals) return
    const removeRanges = [
      ...data.suggested_removals.silences,
      ...data.suggested_removals.repeats,
    ]
    const initial = new Set<string>()
    for (const t of allWords) {
      for (const r of removeRanges) {
        // 词的中点落在 remove 范围里就标删
        const mid = (t.start + t.end) / 2
        if (mid >= r.start && mid <= r.end) {
          initial.add(wordKey(t))
          break
        }
      }
    }
    setDeletedKeys(initial)
  }, [data, allWords])

  // 计算保留区间
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

  // 用 ref 持有最新的 keepRanges，给 timeupdate 回调读取
  const keepRangesRef = useRef<[number, number][]>([])
  useEffect(() => { keepRangesRef.current = keepRanges }, [keepRanges])

  // 初始化 wavesurfer
  useEffect(() => {
    if (!containerRef.current) return
    const regions = RegionsPlugin.create()
    const ws = WaveSurfer.create({
      container: containerRef.current,
      height: 70,
      waveColor: '#cbd5e1',
      progressColor: '#0ea5e9',
      cursorColor: '#475569',
      barWidth: 2,
      barRadius: 2,
      url: data.audio_url_full,
      plugins: [regions],
    })
    wsRef.current = ws
    regionsRef.current = regions
    ws.on('ready', () => setReady(true))
    ws.on('timeupdate', (t) => {
      setCurrentTime(t)
      // 跳过被删除的段：当前时间不在任何 keepRange 内 → 跳到下一个 keepRange 起点
      if (!ws.isPlaying()) return
      const ranges = keepRangesRef.current
      if (ranges.length === 0) return
      const inKeep = ranges.some(([s, e]) => t >= s - 0.01 && t <= e + 0.01)
      if (!inKeep) {
        const nextRange = ranges.find(([s]) => s > t)
        if (nextRange) {
          ws.setTime(nextRange[0])
        } else {
          // 已经过了所有保留段，停止
          ws.pause()
        }
      }
    })
    ws.on('play', () => setPlaying(true))
    ws.on('pause', () => setPlaying(false))
    ws.on('finish', () => setPlaying(false))
    return () => {
      ws.destroy()
      wsRef.current = null
    }
  }, [data.audio_url_full])

  // 同步删除区域到波形
  useEffect(() => {
    const regions = regionsRef.current
    if (!regions || !ready) return
    regions.clearRegions()
    // 把连续的删除词合并成区间
    const delRanges: [number, number][] = []
    let start: number | null = null
    let lastEnd: number | null = null
    for (const t of allWords) {
      const isDel = deletedKeys.has(wordKey(t))
      if (isDel) {
        if (start === null) start = t.start
        lastEnd = t.end
      } else if (start !== null && lastEnd !== null) {
        delRanges.push([start, lastEnd])
        start = null
        lastEnd = null
      }
    }
    if (start !== null && lastEnd !== null) delRanges.push([start, lastEnd])
    for (const [s, e] of delRanges) {
      regions.addRegion({
        start: s, end: e,
        color: 'rgba(220, 38, 38, 0.25)',
        drag: false, resize: false,
      })
    }
  }, [deletedKeys, ready, allWords])

  const togglePlay = () => {
    const ws = wsRef.current
    if (!ws) return
    if (ws.isPlaying()) ws.pause()
    else ws.play()
  }

  const toggleWord = (key: string) => {
    setDeletedKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // 跳到某词
  const seekToWord = (t: WordToken) => {
    const ws = wsRef.current
    if (!ws || !ready) return
    ws.seekTo(t.start / data.duration)
  }

  // 删除选中范围里的所有词
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
      // 检查这个 span 是否和选区有交集
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

  const textContainerRef = useRef<HTMLDivElement>(null)

  // 监听选区变化以启用"删除选中"按钮
  useEffect(() => {
    const onSelChange = () => {
      const sel = window.getSelection()
      const container = textContainerRef.current
      if (!sel || sel.isCollapsed || !container) {
        setHasSelection(false)
        return
      }
      // 选区必须在转录容器内
      const inside = container.contains(sel.anchorNode) && container.contains(sel.focusNode)
      setHasSelection(inside && sel.toString().trim().length > 0)
    }
    document.addEventListener('selectionchange', onSelChange)
    return () => document.removeEventListener('selectionchange', onSelChange)
  }, [])

  const restoreAll = () => {
    setDeletedKeys(new Set())
  }

  const finalize = async () => {
    if (keepRanges.length === 0) {
      setError('全部都删了，至少保留一段')
      return
    }
    setFinalizing(true)
    setError('')
    try {
      const res = await fetch(apiBase + '/api/voice/finalize-narration', {
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
      const finalUrl = apiBase + result.audio_url_path
      // 拼出转录正文（保留段落对应的文字）
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

      {/* 波形 */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-hover)]">
        <button
          onClick={togglePlay}
          disabled={!ready}
          className="w-9 h-9 rounded-full bg-[var(--text)] text-[var(--bg)] flex items-center justify-center cursor-pointer hover:opacity-80 disabled:opacity-40 flex-shrink-0"
        >
          {!ready ? <Loader2 size={14} className="animate-spin"/> : playing ? <Pause size={14} fill="currentColor"/> : <Play size={14} fill="currentColor" className="ml-0.5"/>}
        </button>
        <div ref={containerRef} className="flex-1 min-w-0"/>
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

      {/* 转录字幕 - 拖选 + 删除按钮 / 单击词切换 */}
      <div ref={textContainerRef} tabIndex={0} className="text-sm leading-loose max-h-64 overflow-y-auto bg-[var(--bg-hover)] rounded-lg p-3 outline-none focus:ring-1 focus:ring-[var(--text-3)]">
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
                  // 如果有选区，不响应单击切换
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
