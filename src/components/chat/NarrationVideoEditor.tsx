import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Play, Loader2, Check, X, Scissors, Undo2, Wand2, Repeat, AudioLines } from 'lucide-react'
import { getToken } from '../../lib/auth'

// 中文口播纯口头禅 (没语义, 可无脑删). whisper 会把"嗯"识别成同音"恩"等, 一并收录.
const FILLER_WORDS = new Set([
  '嗯', '啊', '呃', '哦', '诶', '欸', '哎', '唉', '咦', '哟', '呵', '唔', '呢', '嘿', '哈', '哇',
  '恩', '嗯嗯', '啊啊', '呃呃', '嗯哼', '嗯啊', '啊嗯', '唔嗯', '诶嗯', '那个', '这个那个',
])

// 提取成独立 memo 组件: 长视频 (8 分钟+) 1500-3000 词时, currentTime 每秒
// 变化 4-10 次, 不 memo 会让所有词 span 重渲染. memo 后只有 isDel/isCurrent
// 变化的两个词重渲染, 性能从 O(N) 降到 O(2)
interface WordSpanProps {
  wKey: string
  word: string
  start: number
  end: number
  isDel: boolean
  isCurrent: boolean
  onToggle: (key: string) => void
  onSeek: (start: number) => void
}

const WordSpan = memo(function WordSpan({
  wKey, word, start, end, isDel, isCurrent, onToggle, onSeek,
}: WordSpanProps) {
  return (
    <span
      data-word-key={wKey}
      onClick={() => {
        const sel = window.getSelection()
        if (sel && !sel.isCollapsed && sel.toString().length > 0) return
        onToggle(wKey)
      }}
      onDoubleClick={() => onSeek(start)}
      title={`${start.toFixed(2)}s - ${end.toFixed(2)}s`}
      className={`cursor-pointer px-0.5 rounded transition-colors ${
        isDel
          ? 'line-through text-[var(--text-3)] opacity-50'
          : isCurrent
            ? 'bg-yellow-400/40 text-[var(--text)]'
            : 'text-[var(--text)] hover:bg-[var(--bg-card)]'
      }`}
    >
      {word}
    </span>
  )
})

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
  source_file?: string         // 旧 NATAPP 模式: 后端文件名
  source_oss_key?: string      // 新 OSS 模式: clean 阶段保存到 OSS 的 key
  video_url_full: string       // 含完整域名 (NATAPP 路径) 或签名 GET URL (OSS)
  duration: number
  transcription: string
  segments: Segment[]
  waveform?: number[]          // 后端预算的声纹峰值 (0..1); 没有则前端按词时间合成
  suggested_removals?: {
    silences?: { start: number; end: number }[]
    word_gaps?: { start: number; end: number }[]
    repeats?: { start: number; end: number }[]
    fillers?: { start: number; end: number }[]
  }
}

export interface KeptSegment {
  start: number   // 在剪辑后视频里的时间
  end: number
  text: string
  words: Word[]
}

// 把原 segments 按 keep_ranges 重映射到剪辑后视频的时间. 对每个原 word, 看它的 [start, end] 在哪个
// keep_range 内, 算出新时间. 跨边界被部分删除的词丢弃. 相邻保留词组装回 segment (按原 segment 边界 + 新时间连续性).
function computeKeptSegments(originalSegments: Segment[], keepRanges: number[][]): KeptSegment[] {
  const ranges = [...keepRanges].sort((a, b) => a[0] - b[0])
  // 累计偏移: priorLen[i] = ranges[0..i-1] 的总长度
  const priorLen: number[] = []
  let acc = 0
  for (const r of ranges) {
    priorLen.push(acc)
    acc += r[1] - r[0]
  }

  const result: KeptSegment[] = []
  for (const seg of originalSegments) {
    const keptWords: Word[] = []
    let lastNewEnd = -1
    for (const w of seg.words || []) {
      const idx = ranges.findIndex(r => w.start >= r[0] && w.end <= r[1])
      if (idx === -1) continue
      const newStart = priorLen[idx] + (w.start - ranges[idx][0])
      const newEnd = priorLen[idx] + (w.end - ranges[idx][0])
      // 中间出现 gap (词被删了一段) → 切成新 segment
      if (lastNewEnd >= 0 && newStart - lastNewEnd > 0.05 && keptWords.length > 0) {
        result.push({
          start: keptWords[0].start,
          end: keptWords[keptWords.length - 1].end,
          text: keptWords.map(x => x.word).join(''),
          words: [...keptWords],
        })
        keptWords.length = 0
      }
      keptWords.push({ start: newStart, end: newEnd, word: w.word })
      lastNewEnd = newEnd
    }
    if (keptWords.length > 0) {
      result.push({
        start: keptWords[0].start,
        end: keptWords[keptWords.length - 1].end,
        text: keptWords.map(x => x.word).join(''),
        words: keptWords,
      })
    }
  }
  return result
}

interface Props {
  data: CleanResponse
  apiBase: string
  onCancel: () => void
  onDone: (videoUrlFull: string, duration: number, transcription: string, keptSegments: KeptSegment[], narrationOssKey?: string) => void
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

  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [deletedKeys, setDeletedKeys] = useState<Set<string>>(new Set())
  const [finalizing, setFinalizing] = useState(false)
  const [error, setError] = useState('')
  const [hasSelection, setHasSelection] = useState(false)
  // 导出秒表 + abort: 让用户卡住时能看到耗时 + 主动取消
  const [finalizeElapsed, setFinalizeElapsed] = useState(0)
  const finalizeAbortRef = useRef<AbortController | null>(null)
  // 去气口强度 + 声纹拖选
  const [gapMode, setGapMode] = useState<'off' | 'std' | 'strong'>('std')
  const [dragSel, setDragSel] = useState<{ a: number; b: number } | null>(null)
  const waveCanvasRef = useRef<HTMLCanvasElement>(null)
  const waveWrapRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ a: number; moved: boolean } | null>(null)

  // 摊平 segments → word tokens (用于 keepRanges 计算 / 拖选 / 全局逻辑)
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

  // 按 segment 分组的 word tokens (一句话一行展示)
  const wordsBySegment = useMemo(() => {
    const groups: WordToken[][] = []
    let currentSegIdx = -1
    let currentGroup: WordToken[] = []
    for (const t of allWords) {
      if (t.segIdx !== currentSegIdx) {
        if (currentGroup.length > 0) groups.push(currentGroup)
        currentGroup = []
        currentSegIdx = t.segIdx
      }
      currentGroup.push(t)
    }
    if (currentGroup.length > 0) groups.push(currentGroup)
    return groups
  }, [allWords])

  const wordKey = (t: WordToken) => `${t.segIdx}_${t.wordIdx}`

  // 初始化预删除: 默认帮用户去掉口头禅(嗯啊) + 重复句. 气口(空白停顿)由"去气口"统一处理, 不在这里预删词.
  useEffect(() => {
    if (!data.suggested_removals) return
    const sr = data.suggested_removals
    const ranges = [...(sr.repeats || []), ...(sr.fillers || [])]
    const initial = new Set<string>()
    for (const t of allWords) {
      const clean = t.word.replace(/[，。、；！？!?,.;:：~～\-—_…\s]/g, '')
      const mid = (t.start + t.end) / 2
      if (FILLER_WORDS.has(clean) || ranges.some(r => mid >= r.start && mid <= r.end)) {
        initial.add(wordKey(t))
      }
    }
    setDeletedKeys(initial)
  }, [data, allWords])

  // 计算保留段. 两类空隙分开处理:
  //  · 删词造成的空隙 → 全删 (只留极小防爆音 pad)
  //  · 自然停顿(气口) → 超过阈值才删, 留一点换气. gapMode 控制阈值; 关 = 不动气口.
  const keepRanges = useMemo(() => {
    const cfg = gapMode === 'off' ? null : (gapMode === 'strong' ? { max: 0.18, breath: 0.06 } : { max: 0.35, breath: 0.10 })
    const LEAD = cfg ? 0.12 : 0
    const DELPAD = 0.03
    const ranges: [number, number][] = []
    let s: number | null = null
    let e = 0
    let sawDel = false
    for (const t of allWords) {
      if (deletedKeys.has(wordKey(t))) { sawDel = true; continue }
      if (s === null) { s = Math.max(0, t.start - LEAD); e = t.end; sawDel = false; continue }
      const gap = t.start - e
      let cut = false, lp = 0, rp = 0
      if (sawDel && gap > 0.02) { cut = true; lp = Math.min(DELPAD, gap / 2); rp = Math.min(DELPAD, gap / 2) }
      else if (cfg && gap > cfg.max) { cut = true; lp = Math.min(cfg.breath, gap / 2); rp = Math.min(cfg.breath, gap / 2) }
      if (cut) { ranges.push([s, e + lp]); s = t.start - rp; e = t.end }
      else { e = t.end }
      sawDel = false
    }
    if (s !== null) ranges.push([s, cfg ? Math.min(data.duration, e + LEAD) : e])
    return ranges
  }, [allWords, deletedKeys, gapMode, data.duration])

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

  // seek 进行中标志 (留着但暂未使用,自动跳过逻辑被砍了, 只在 onSeeked 里清)
  const seekingRef = useRef(false)

  // 删除段静音 (立刻生效, 不依赖 seek 时机)
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.muted = isInDeletedRange
  }, [isInDeletedRange])

  // ============ 声纹波形 + 拖选 ============
  // 峰值: 优先后端预算的; 没有就按"哪段有词"合成 (能看出说话/空白即可)
  const peaks = useMemo<number[]>(() => {
    if (Array.isArray(data.waveform) && data.waveform.length > 8) return data.waveform
    const N = 360
    const dur = data.duration || 1
    const hash = (i: number) => { const x = Math.sin(i * 12.9898) * 43758.5453; return x - Math.floor(x) }
    const arr = new Array<number>(N)
    for (let i = 0; i < N; i++) {
      const t = (i / N) * dur
      const inWord = allWords.some(w => t >= w.start && t <= w.end)
      arr[i] = inWord ? 0.35 + hash(i) * 0.5 : 0.02 + hash(i) * 0.02
    }
    return arr
  }, [data.waveform, data.duration, allWords])

  const xToTime = useCallback((clientX: number) => {
    const el = waveWrapRef.current
    if (!el) return 0
    const r = el.getBoundingClientRect()
    return Math.max(0, Math.min(data.duration, ((clientX - r.left) / r.width) * data.duration))
  }, [data.duration])

  const deleteTimeRange = useCallback((t0: number, t1: number) => {
    setDeletedKeys(prev => {
      const next = new Set(prev)
      for (const t of allWords) {
        const mid = (t.start + t.end) / 2
        if (mid >= t0 && mid <= t1) next.add(wordKey(t))
      }
      return next
    })
  }, [allWords])

  // 一键去口头禅 (嗯/啊/呃...) — 词文本命中 或 落在后端给的 fillers 区间
  const applyFillers = useCallback(() => {
    setDeletedKeys(prev => {
      const next = new Set(prev)
      const ranges = data.suggested_removals?.fillers || []
      for (const t of allWords) {
        const clean = t.word.replace(/[，。、；！？!?,.;:：~～\-—_…\s]/g, '')
        const mid = (t.start + t.end) / 2
        if (FILLER_WORDS.has(clean) || ranges.some(r => mid >= r.start && mid <= r.end)) next.add(wordKey(t))
      }
      return next
    })
  }, [allWords, data.suggested_removals])

  // 一键去重复句 (同一句说了 2-3 遍 → 删掉前面几遍, 只留最后一遍)
  const applyRepeats = useCallback(() => {
    setDeletedKeys(prev => {
      const next = new Set(prev)
      const ranges = data.suggested_removals?.repeats || []
      for (const t of allWords) {
        const mid = (t.start + t.end) / 2
        if (ranges.some(r => mid >= r.start && mid <= r.end)) next.add(wordKey(t))
      }
      return next
    })
  }, [allWords, data.suggested_removals])

  // 画波形 (绿=保留 / 红=删除). currentTime 不进依赖 — 播放头单独用 div, 避免每秒重绘
  useEffect(() => {
    const canvas = waveCanvasRef.current
    const wrap = waveWrapRef.current
    if (!canvas || !wrap) return
    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const cssW = wrap.clientWidth, cssH = 64
      canvas.width = Math.max(1, Math.floor(cssW * dpr))
      canvas.height = Math.floor(cssH * dpr)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, cssW, cssH)
      const mid = cssH / 2
      const n = peaks.length
      const bw = cssW / n
      const dur = data.duration || 1
      for (let i = 0; i < n; i++) {
        const t = (i / n) * dur
        const inKeep = keepRanges.some(([s, e]) => t >= s && t <= e)
        const h = Math.max(1, peaks[i] * (cssH * 0.46))
        ctx.fillStyle = inKeep ? 'rgba(16,185,129,0.9)' : 'rgba(239,68,68,0.30)'
        ctx.fillRect(i * bw, mid - h, Math.max(1, bw * 0.75), h * 2)
      }
      if (dragSel) {
        const x1 = (Math.min(dragSel.a, dragSel.b) / dur) * cssW
        const x2 = (Math.max(dragSel.a, dragSel.b) / dur) * cssW
        ctx.fillStyle = 'rgba(255,255,255,0.16)'
        ctx.fillRect(x1, 0, x2 - x1, cssH)
        ctx.strokeStyle = 'rgba(255,255,255,0.55)'
        ctx.lineWidth = 1
        ctx.strokeRect(x1 + 0.5, 0.5, Math.max(0, x2 - x1 - 1), cssH - 1)
      }
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [peaks, keepRanges, dragSel, data.duration])

  // 波形上按住拖选 → 删一段; 单击 → 跳转
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragRef.current) return
      dragRef.current.moved = true
      setDragSel({ a: dragRef.current.a, b: xToTime(e.clientX) })
    }
    const up = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      dragRef.current = null
      if (!d.moved) {
        const v = videoRef.current
        if (v && ready) v.currentTime = d.a
        setDragSel(null)
        return
      }
      const t = xToTime(e.clientX)
      const t0 = Math.min(d.a, t), t1 = Math.max(d.a, t)
      if (t1 - t0 >= 0.08) deleteTimeRange(t0, t1)
      setDragSel(null)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, [xToTime, deleteTimeRange, ready])

  // 视频事件
  const onLoadedMetadata = () => setReady(true)

  const onTimeUpdate = () => {
    const v = videoRef.current
    if (!v) return
    setCurrentTime(v.currentTime)
    // 不自动 seek 跳过删除段 — 视频画面流畅度优先, seek 会让画面突变.
    // 删除段由 muted (静音) + 红色蒙层 (视觉) 标识.
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

  // useCallback: 让 WordSpan memo 生效 (回调引用稳定才不会触发重渲染)
  const toggleWord = useCallback((key: string) => {
    setDeletedKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // 整句切删除/恢复 (一键删整句, 适合删整段口误重复)
  const toggleSegment = useCallback((words: WordToken[]) => {
    setDeletedKeys(prev => {
      const next = new Set(prev)
      const allDel = words.every(t => next.has(`${t.segIdx}_${t.wordIdx}`))
      if (allDel) {
        words.forEach(t => next.delete(`${t.segIdx}_${t.wordIdx}`))
      } else {
        words.forEach(t => next.add(`${t.segIdx}_${t.wordIdx}`))
      }
      return next
    })
  }, [])

  const seekToWordTime = useCallback((start: number) => {
    const v = videoRef.current
    if (!v || !ready) return
    v.currentTime = start
  }, [ready])

  // 当前播放词 key (单独 memo, currentTime 变化只重算这个, 不重渲染所有词)
  const currentWordKey = useMemo(() => {
    for (const t of allWords) {
      if (currentTime >= t.start - 0.01 && currentTime <= t.end + 0.01) {
        return wordKey(t)
      }
    }
    return null
  }, [allWords, currentTime])

  // 当前正在说的那一句 (给中间视频底部的"声文"字幕条用 — 播到哪句显示哪句, 高亮当前词)
  const currentSegWords = useMemo(() => {
    if (!currentWordKey) return []
    for (const segWords of wordsBySegment) {
      if (segWords.some(t => wordKey(t) === currentWordKey)) return segWords
    }
    return []
  }, [wordsBySegment, currentWordKey])

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
    setFinalizeElapsed(0)
    const abort = new AbortController()
    finalizeAbortRef.current = abort
    try {
      // OSS 模式优先, 否则退回旧 NATAPP 模式
      const body = data.source_oss_key
        ? { source_oss_key: data.source_oss_key, keep_ranges: keepRanges }
        : { source_file: data.source_file, keep_ranges: keepRanges }
      const res = await fetch(apiBase + '/api/voice/finalize-narration-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken() || ''}` },
        body: JSON.stringify(body),
        signal: abort.signal,
      })
      const result = await res.json()
      if (!res.ok || !result.success) {
        setError(result.detail || result.error || '导出失败')
        return
      }
      // OSS 模式: 后端返回签名 GET URL (video_url); NATAPP 模式: 拼 apiBase + video_url_path
      const finalUrl = result.video_url || (apiBase + result.video_url_path)
      const finalText = allWords.filter(t => !deletedKeys.has(wordKey(t))).map(t => t.word).join('')
      const keptSegments = computeKeptSegments(data.segments, keepRanges)
      onDone(finalUrl, result.duration, finalText, keptSegments, result.output_oss_key)
    } catch (e: any) {
      if (e.name === 'AbortError') {
        setError('已取消导出. 可重新点"完成导出"重试.')
      } else {
        setError(e.message || '导出失败')
      }
    } finally {
      setFinalizing(false)
      finalizeAbortRef.current = null
    }
  }

  // 导出秒表: finalizing 期间每秒 +1, 让用户知道卡了多久
  useEffect(() => {
    if (!finalizing) return
    const t = setInterval(() => setFinalizeElapsed(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [finalizing])

  const cancelFinalize = useCallback(() => {
    finalizeAbortRef.current?.abort()
  }, [])

  const fmtElapsed = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  return (
    <div className="flex flex-col lg:flex-row gap-3 lg:items-start">
      {/* 左: 视频文案 (转录逐句, 单击词删 / 拖选删 / 双击跳转) */}
      <div className="lg:w-80 flex-shrink-0 flex flex-col min-w-0">
        <div className="text-xs font-medium text-[var(--text-2)] mb-1.5">视频文案 (点词删 · 拖选删 · 双击跳转)</div>
        <div ref={textContainerRef} tabIndex={0} className="text-sm leading-loose max-h-[42vh] lg:max-h-[460px] overflow-y-auto bg-[var(--bg-hover)] rounded-[12px] p-3 outline-none focus:ring-1 focus:ring-[var(--text-3)]">
          {wordsBySegment.length === 0 ? (
            <div className="text-[var(--text-3)]">没有转录到内容</div>
          ) : (
            wordsBySegment.map((segWords, sIdx) => {
              const allDel = segWords.every(t => deletedKeys.has(wordKey(t)))
              return (
                <div key={sIdx} className="group flex items-baseline gap-1 mb-0.5">
                  <div className="flex-1">
                    {segWords.map((t) => {
                      const key = wordKey(t)
                      return (
                        <WordSpan
                          key={key}
                          wKey={key}
                          word={t.word}
                          start={t.start}
                          end={t.end}
                          isDel={deletedKeys.has(key)}
                          isCurrent={key === currentWordKey}
                          onToggle={toggleWord}
                          onSeek={seekToWordTime}
                        />
                      )
                    })}
                  </div>
                  <button
                    onClick={() => toggleSegment(segWords)}
                    className={`px-1.5 py-1 rounded transition-opacity flex-shrink-0 inline-flex items-center justify-center ${
                      allDel
                        ? 'opacity-100 text-[var(--text-3)] hover:text-[var(--text-2)] hover:bg-[var(--bg-card)]'
                        : 'opacity-0 group-hover:opacity-100 text-red-400 hover:bg-red-950/30'
                    }`}
                    title={allDel ? '恢复整句' : '删除整句'}
                  >
                    {allDel ? <Undo2 size={12}/> : <Scissors size={12}/>}
                  </button>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* 中: 视频 + 声文字幕条(当前在说的那句) + 时间轴 */}
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <div className="relative rounded-lg overflow-hidden bg-black">
          <video
            ref={videoRef}
            src={data.video_url_full}
            className="w-full max-h-[46vh] object-contain"
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
          {/* 声文字幕条: 当前正在说的那句, 叠在视频底部, 高亮当前词 (删掉的词划掉变淡) */}
          {currentSegWords.length > 0 && (
            <div className="absolute inset-x-0 bottom-0 px-4 pb-2 pt-6 bg-gradient-to-t from-black/85 to-transparent pointer-events-none text-center">
              <span className="text-white text-sm font-medium leading-snug" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>
                {currentSegWords.map((t) => {
                  const k = wordKey(t)
                  return <span key={k} className={k === currentWordKey ? 'text-yellow-300' : deletedKeys.has(k) ? 'opacity-40 line-through' : ''}>{t.word}</span>
                })}
              </span>
            </div>
          )}
        </div>

        {/* 声纹波形: 绿=保留 红=删除(气口/删词). 点击跳转 · 按住拖选删一段 */}
        <div
          ref={waveWrapRef}
          className="relative rounded-lg overflow-hidden bg-[var(--bg-hover)] cursor-pointer select-none"
          style={{ height: 64 }}
          onMouseDown={(e) => {
            const t = xToTime(e.clientX)
            dragRef.current = { a: t, moved: false }
            setDragSel({ a: t, b: t })
          }}
          title="点击跳转 · 按住拖选一段删除"
        >
          <canvas ref={waveCanvasRef} className="absolute inset-0 w-full h-full" />
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-[var(--text)] pointer-events-none"
            style={{ left: `${(currentTime / (data.duration || 1)) * 100}%` }}
          />
        </div>
        <div className="text-[11px] text-[var(--text-3)] text-center">{currentTime.toFixed(1)}s / {data.duration.toFixed(1)}s · 波形上点击跳转 · 拖选一段删除</div>
      </div>

      {/* 右: 工具 + 统计 + 导出 */}
      <div className="lg:w-56 flex-shrink-0 flex flex-col gap-3">
        <div className="text-xs text-[var(--text-3)]">
          原 {data.duration.toFixed(1)}s → <span className="text-[var(--text)] font-medium">{cleanedDuration.toFixed(1)}s</span>
          <span className="text-[var(--text-3)]"> · {deletedKeys.size} 词被删</span>
        </div>

        {/* 去气口强度: 自动删句间空白停顿 */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-xs text-[var(--text-2)]"><AudioLines size={13}/> 去气口 (删空白停顿)</div>
          <div className="flex rounded-lg overflow-hidden border border-[var(--border)] text-xs">
            {([['off', '关'], ['std', '标准'], ['strong', '强']] as const).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setGapMode(v)}
                className={`flex-1 px-2 py-1.5 cursor-pointer transition-colors ${gapMode === v ? 'bg-[var(--text)] text-[var(--bg)] font-medium' : 'text-[var(--text-2)] hover:bg-[var(--bg-hover)]'}`}
              >{label}</button>
            ))}
          </div>
          <div className="text-[10px] text-[var(--text-3)] leading-snug">空白停顿(气口)直接删掉, 波形上红色就是被删的。强=连短停顿也删。</div>
        </div>

        {/* 一键清理 */}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={applyFillers}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
          >
            <Wand2 size={12}/> 去口头禅 (嗯/啊/呃)
          </button>
          <button
            type="button"
            onClick={applyRepeats}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
          >
            <Repeat size={12}/> 去重复句 (留一遍)
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => deleteSelected()}
            disabled={!hasSelection}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text)] hover:bg-red-950/30 hover:text-red-400 hover:border-red-500/40 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
          >
            <Scissors size={12}/> 删除选中
          </button>
          <button
            type="button"
            onClick={restoreAll}
            disabled={deletedKeys.size === 0}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs border border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            <Undo2 size={12}/> 全部恢复
          </button>
        </div>

        <div className="text-[11px] text-[var(--text-3)] leading-relaxed">
          左边文案:单击词 = 删/恢复 · 拖选一段 → 「删除选中」· 双击词跳到对应位置 · 句末剪刀删整句。中间波形上也能直接拖选删一段。
        </div>

        {error && <div className="text-xs text-red-400">{error}</div>}
        {finalizing && finalizeElapsed >= 30 && (
          <span className="text-[11px] text-[var(--text-3)] leading-snug">
            后端在切片+上传到 OSS, 大文件可能要 1-3 分钟. 卡太久可点取消重试.
          </span>
        )}

        <div className="mt-auto flex flex-col gap-2 pt-1">
          <button
            onClick={finalize}
            disabled={finalizing || !ready}
            className="w-full px-3 py-2 rounded-lg text-sm bg-[var(--text)] text-[var(--bg)] hover:opacity-80 cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {finalizing ? <Loader2 size={14} className="animate-spin"/> : <Check size={14}/>}
            {finalizing ? `导出中 ${fmtElapsed(finalizeElapsed)}` : '完成导出'}
          </button>
          <button
            onClick={finalizing ? cancelFinalize : onCancel}
            className="w-full px-3 py-2 rounded-lg text-sm text-[var(--text-2)] hover:bg-[var(--bg-hover)] cursor-pointer flex items-center justify-center gap-1.5"
          >
            <X size={14}/> {finalizing ? '取消导出' : '取消'}
          </button>
        </div>
      </div>
    </div>
  )
}
