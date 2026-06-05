import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, X, Trash2, Captions } from 'lucide-react'
import { subtitleTranscribe, subtitleBurn, type SubSeg } from '../../services/subtitle'
import { loadFont, fontFamily } from '../../utils/coverFonts'

const directBase = (import.meta as any).env?.VITE_DIRECT_API_URL || 'https://monoi.nat100.top'

// 文字颜色调色板 (跟封面常用色一致)
const COLORS: [string, string][] = [
  ['#FFFFFF', '白'], ['#000000', '黑'], ['#FFE14D', '黄'], ['#FF4D4D', '红'],
  ['#FF8C1A', '橙'], ['#3B9EFF', '蓝'], ['#34C759', '绿'], ['#FF6FB5', '粉'],
]
// 描边粗细档位 (倍率): 跟后端 borderw = fontsize*0.07*倍率 对应
const STROKES: [number, string][] = [[0, '无'], [0.6, '细'], [1, '中'], [1.8, '粗']]

interface FontItem { file: string; label: string }

function fmt(t: number) {
  const s = Math.max(0, Math.floor(t))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export function SubtitleEditor({ transcribeInput, previewUrl, onClose, onDone }: {
  transcribeInput: { video_oss_key?: string; video_url?: string }
  previewUrl: string
  onClose: () => void
  onDone: (url: string, ossKey: string) => void
}) {
  const [phase, setPhase] = useState<'loading' | 'edit' | 'burning' | 'error'>('loading')
  const [err, setErr] = useState('')
  const [ossKey, setOssKey] = useState('')
  const [segs, setSegs] = useState<SubSeg[]>([])
  const [activeSeg, setActiveSeg] = useState(0)

  // 字幕样式
  const [fontFile, setFontFile] = useState('')          // 空 = 默认思源黑体
  const [fontScale, setFontScale] = useState(1.0)
  const [color, setColor] = useState('#FFFFFF')
  const [strokeWidth, setStrokeWidth] = useState(1.0)
  const [strokeColor, setStrokeColor] = useState('#000000')
  const [shadow, setShadow] = useState(true)
  // 字幕位置 = 中心点比例 (0-1), 可拖动自由摆放; 预设按钮设到底/中/顶
  const [subX, setSubX] = useState(0.5)
  const [subY, setSubY] = useState(0.9)
  const [dragging, setDragging] = useState(false)
  const [fonts, setFonts] = useState<FontItem[]>([])

  // 预览字号要跟视频实际高度挂钩 (跟后端 h*0.05 一致), 用 ResizeObserver 量预览框高度
  const boxRef = useRef<HTMLDivElement>(null)
  const [boxH, setBoxH] = useState(0)

  useEffect(() => {
    let alive = true
    setPhase('loading'); setErr('')
    subtitleTranscribe(transcribeInput)
      .then(r => { if (!alive) return; setOssKey(r.video_oss_key); setSegs(r.segments); setPhase(r.segments.length ? 'edit' : 'error'); if (!r.segments.length) setErr('没识别到语音内容') })
      .catch(e => { if (!alive) return; setErr(e.message || '识别失败'); setPhase('error') })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 拉字体列表 + 预加载给下拉/预览用
  useEffect(() => {
    fetch(directBase + '/api/voice/cover-fonts')
      .then(r => r.json())
      .then(d => {
        const list: FontItem[] = (d.fonts || []).map((f: any) => ({ file: f.file, label: f.label || f.file }))
        setFonts(list)
        list.slice(0, 16).forEach(f => loadFont(f.file))
      })
      .catch(() => { /* 字体列表拉不到就用默认 */ })
  }, [])

  useEffect(() => { if (fontFile) loadFont(fontFile) }, [fontFile])

  useEffect(() => {
    if (phase !== 'edit' && phase !== 'burning') return
    const el = boxRef.current
    if (!el) return
    setBoxH(el.getBoundingClientRect().height)
    const ro = new ResizeObserver(es => setBoxH(es[0].contentRect.height))
    ro.observe(el)
    return () => ro.disconnect()
  }, [phase])

  const updateText = (i: number, text: string) => setSegs(prev => prev.map((s, j) => j === i ? { ...s, text } : s))
  const removeSeg = (i: number) => { setSegs(prev => prev.filter((_, j) => j !== i)); setActiveSeg(0) }

  const handleBurn = async () => {
    const clean = segs.filter(s => s.text.trim())
    if (!clean.length) { setErr('字幕都空了'); return }
    setPhase('burning'); setErr('')
    try {
      const r = await subtitleBurn({
        video_oss_key: ossKey, segments: clean,
        font_scale: fontScale, color,
        font_file: fontFile, stroke_color: strokeColor, stroke_width: strokeWidth, shadow,
        x_pct: subX, y_pct: subY,
      })
      onDone(r.video_url, r.output_oss_key)
    } catch (e: any) {
      setErr(e.message || '生成失败'); setPhase('edit')
    }
  }

  // 拖动字幕: 指针位置 → 中心点比例 (夹 5%-95% 防出框)
  const onSubPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    try { (e.target as HTMLElement).setPointerCapture(e.pointerId) } catch { /* noop */ }
    setDragging(true)
  }
  const onSubPointerMove = (e: React.PointerEvent) => {
    if (!dragging || !boxRef.current) return
    const r = boxRef.current.getBoundingClientRect()
    if (!r.width || !r.height) return
    setSubX(Math.min(0.95, Math.max(0.05, (e.clientX - r.left) / r.width)))
    setSubY(Math.min(0.95, Math.max(0.05, (e.clientY - r.top) / r.height)))
  }
  const onSubPointerUp = (e: React.PointerEvent) => {
    setDragging(false)
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* noop */ }
  }

  // 预览字幕 CSS 样式 (近似最终 ffmpeg 烧录效果)
  const previewText = segs[activeSeg]?.text || segs[0]?.text || '字幕预览效果'
  const subFontPx = Math.max(10, boxH * 0.05 * fontScale)
  const strokePx = strokeWidth > 0 ? Math.max(1, subFontPx * 0.07 * strokeWidth) : 0
  const subStyle: React.CSSProperties = {
    fontFamily: fontFile ? `"${fontFamily(fontFile)}", sans-serif` : 'sans-serif',
    color,
    fontSize: subFontPx,
    fontWeight: 800,
    lineHeight: 1.25,
    textAlign: 'center',
    maxWidth: '86%',
    whiteSpace: 'pre-wrap',
    textShadow: shadow ? '2px 2px 5px rgba(0,0,0,0.75)' : 'none',
    WebkitTextStroke: strokePx > 0 ? `${strokePx}px ${strokeColor}` : undefined,
    paintOrder: 'stroke fill',
    pointerEvents: 'auto',
    touchAction: 'none',
    cursor: dragging ? 'grabbing' : 'grab',
  } as React.CSSProperties

  const styleBtn = (active: boolean) =>
    `px-2.5 py-1 rounded-lg border text-xs cursor-pointer transition-colors ${active
      ? 'border-[var(--text)] bg-[var(--text)] text-[var(--bg)]'
      : 'border-[var(--border)] text-[var(--text-2)] hover:border-[var(--text)]'}`

  const modal = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-3">
      <div className="w-full max-w-5xl max-h-[92vh] flex flex-col rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] shadow-2xl overflow-hidden">
        {/* 头 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] flex-shrink-0">
          <div className="flex items-center gap-2 text-sm font-medium"><Captions size={16}/> 加字幕</div>
          <button onClick={onClose} className="text-[var(--text-3)] hover:text-[var(--text)] cursor-pointer"><X size={18}/></button>
        </div>

        {phase === 'loading' && (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-[var(--text-3)] text-sm">
            <Loader2 size={24} className="animate-spin"/> 正在识别语音, 生成字幕…
          </div>
        )}

        {phase === 'error' && (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-sm">
            <p className="text-red-400">{err || '出错了'}</p>
            <button onClick={onClose} className="px-4 py-2 rounded-lg border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--bg-hover)] cursor-pointer">关闭</button>
          </div>
        )}

        {(phase === 'edit' || phase === 'burning') && (
          <>
            <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
              {/* 左: 字幕条 */}
              <div className="lg:w-72 flex-shrink-0 lg:border-r border-b lg:border-b-0 border-[var(--border)] overflow-y-auto p-3 flex flex-col gap-2 max-h-[28vh] lg:max-h-none">
                <div className="text-xs text-[var(--text-3)] mb-1 flex-shrink-0">识别出 {segs.length} 句 · 改错别字 / 删多余 · 点某句在右边看效果</div>
                {segs.map((s, i) => (
                  <div key={i} onClick={() => setActiveSeg(i)}
                    className={`flex items-center gap-2 rounded-lg p-1 cursor-pointer ${activeSeg === i ? 'bg-[var(--bg-hover)] ring-1 ring-[var(--text-3)]' : ''}`}>
                    <span className="text-[10px] text-[var(--text-3)] font-mono w-10 flex-shrink-0">{fmt(s.start)}</span>
                    <input value={s.text} onChange={e => updateText(i, e.target.value)}
                      className="flex-1 min-w-0 px-2 py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm focus:border-[var(--text)] outline-none"/>
                    <button onClick={(e) => { e.stopPropagation(); removeSeg(i) }} className="text-[var(--text-3)] hover:text-red-400 cursor-pointer flex-shrink-0" title="删除这句"><Trash2 size={14}/></button>
                  </div>
                ))}
              </div>

              {/* 中: 视频预览 + 字幕示意 */}
              <div className="flex-1 min-w-0 flex items-center justify-center bg-black/40 p-3">
                <div ref={boxRef} className="relative max-h-[58vh] rounded-lg overflow-hidden" style={{ lineHeight: 0 }}>
                  <video src={previewUrl} controls playsInline className="max-h-[58vh] max-w-full object-contain rounded-lg bg-black"/>
                  {/* 字幕示意层: 中心点定位, 可拖动 (整层不挡视频控件, 只字幕本身可拖) */}
                  <div className="absolute pointer-events-none" style={{ left: `${subX * 100}%`, top: `${subY * 100}%`, transform: 'translate(-50%, -50%)', width: '86%', display: 'flex', justifyContent: 'center' }}>
                    <span
                      onPointerDown={onSubPointerDown}
                      onPointerMove={onSubPointerMove}
                      onPointerUp={onSubPointerUp}
                      style={subStyle}>{previewText}</span>
                  </div>
                </div>
              </div>

              {/* 右: 样式控制 */}
              <div className="lg:w-64 flex-shrink-0 lg:border-l border-t lg:border-t-0 border-[var(--border)] overflow-y-auto p-3 flex flex-col gap-4">
                {/* 字体 */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-[var(--text-3)]">字体</span>
                  <select value={fontFile} onChange={e => setFontFile(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border)] text-sm text-[var(--text)] focus:border-[var(--text)] outline-none cursor-pointer">
                    <option value="">默认 (思源黑体)</option>
                    {fonts.map(f => <option key={f.file} value={f.file}>{f.label}</option>)}
                  </select>
                </div>

                {/* 字号 */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--text-3)]">字号</span>
                    <span className="text-[11px] text-[var(--text-3)] tabular-nums">{Math.round(fontScale * 100)}%</span>
                  </div>
                  <input type="range" min={0.6} max={1.6} step={0.05} value={fontScale}
                    onChange={e => setFontScale(parseFloat(e.target.value))}
                    className="w-full accent-[var(--text)] cursor-pointer"/>
                </div>

                {/* 颜色 */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-[var(--text-3)]">颜色</span>
                  <div className="flex flex-wrap gap-2">
                    {COLORS.map(([c, label]) => (
                      <button key={c} title={label} onClick={() => setColor(c)}
                        className={`w-6 h-6 rounded-full border-2 cursor-pointer transition-all ${color === c ? 'border-[var(--text)] scale-110' : 'border-[var(--border)]'}`}
                        style={{ background: c }}/>
                    ))}
                  </div>
                </div>

                {/* 描边 */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-[var(--text-3)]">描边</span>
                  <div className="flex gap-2">
                    {STROKES.map(([w, label]) => (
                      <button key={label} onClick={() => setStrokeWidth(w)} className={styleBtn(strokeWidth === w)}>{label}</button>
                    ))}
                  </div>
                  {strokeWidth > 0 && (
                    <div className="flex gap-2 mt-1">
                      {(['#000000', '#FFFFFF'] as const).map(c => (
                        <button key={c} title={c === '#000000' ? '黑边' : '白边'} onClick={() => setStrokeColor(c)}
                          className={`w-6 h-6 rounded-full border-2 cursor-pointer ${strokeColor === c ? 'border-[var(--text)] scale-110' : 'border-[var(--border)]'}`}
                          style={{ background: c }}/>
                      ))}
                    </div>
                  )}
                </div>

                {/* 阴影 */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--text-3)]">阴影</span>
                  <div className="flex gap-2">
                    <button onClick={() => setShadow(true)} className={styleBtn(shadow)}>开</button>
                    <button onClick={() => setShadow(false)} className={styleBtn(!shadow)}>关</button>
                  </div>
                </div>

                {/* 位置 */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-[var(--text-3)]">位置</span>
                  <div className="flex gap-2">
                    {([['底部', 0.9], ['中间', 0.5], ['顶部', 0.1]] as const).map(([l, y]) => (
                      <button key={l} onClick={() => { setSubX(0.5); setSubY(y) }}
                        className={styleBtn(Math.abs(subX - 0.5) < 0.02 && Math.abs(subY - y) < 0.02)}>{l}</button>
                    ))}
                  </div>
                  <span className="text-[11px] text-[var(--text-3)]">↑ 快捷位置, 也可直接拖动中间预览里的字幕到任意位置</span>
                </div>
              </div>
            </div>

            {/* 底部操作 */}
            <div className="px-4 py-3 border-t border-[var(--border)] flex items-center justify-between gap-3 flex-shrink-0">
              {err ? <span className="text-xs text-red-400 truncate">{err}</span> : <span className="text-[10px] text-[var(--text-3)]">字幕会硬烧进视频 (发抖音/小红书自带字幕)</span>}
              <button onClick={handleBurn} disabled={phase === 'burning'}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--text)] text-[var(--bg)] text-sm cursor-pointer disabled:opacity-50 disabled:cursor-wait flex-shrink-0">
                {phase === 'burning' ? <><Loader2 size={14} className="animate-spin"/> 生成中 (约 30-90 秒)</> : '生成带字幕的视频'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}
