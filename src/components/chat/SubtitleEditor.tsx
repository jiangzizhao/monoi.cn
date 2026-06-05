import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, X, Trash2, Captions } from 'lucide-react'
import { subtitleTranscribe, subtitleBurn, type SubSeg } from '../../services/subtitle'

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
  const [fontScale, setFontScale] = useState(1.0)
  const [color, setColor] = useState<'white' | 'yellow'>('white')
  const [position, setPosition] = useState<'bottom' | 'center' | 'top'>('bottom')

  useEffect(() => {
    let alive = true
    setPhase('loading'); setErr('')
    subtitleTranscribe(transcribeInput)
      .then(r => { if (!alive) return; setOssKey(r.video_oss_key); setSegs(r.segments); setPhase(r.segments.length ? 'edit' : 'error'); if (!r.segments.length) setErr('没识别到语音内容') })
      .catch(e => { if (!alive) return; setErr(e.message || '识别失败'); setPhase('error') })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const updateText = (i: number, text: string) => setSegs(prev => prev.map((s, j) => j === i ? { ...s, text } : s))
  const removeSeg = (i: number) => setSegs(prev => prev.filter((_, j) => j !== i))

  const handleBurn = async () => {
    const clean = segs.filter(s => s.text.trim())
    if (!clean.length) { setErr('字幕都空了'); return }
    setPhase('burning'); setErr('')
    try {
      const r = await subtitleBurn({ video_oss_key: ossKey, segments: clean, font_scale: fontScale, color, position })
      onDone(r.video_url, r.output_oss_key)
    } catch (e: any) {
      setErr(e.message || '生成失败'); setPhase('edit')
    }
  }

  const btn = (active: boolean) =>
    `px-3 py-1 rounded-lg border text-xs cursor-pointer transition-colors ${active
      ? 'border-[var(--text)] bg-[var(--text)] text-[var(--bg)]'
      : 'border-[var(--border)] text-[var(--text-2)] hover:border-[var(--text)]'}`

  const modal = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-3">
      <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] shadow-2xl overflow-hidden">
        {/* 头 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <div className="flex items-center gap-2 text-sm font-medium"><Captions size={16}/> 加字幕</div>
          <button onClick={onClose} className="text-[var(--text-3)] hover:text-[var(--text)] cursor-pointer"><X size={18}/></button>
        </div>

        {phase === 'loading' && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-[var(--text-3)] text-sm">
            <Loader2 size={24} className="animate-spin"/> 正在识别语音, 生成字幕…
          </div>
        )}

        {phase === 'error' && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-sm">
            <p className="text-red-400">{err || '出错了'}</p>
            <button onClick={onClose} className="px-4 py-2 rounded-lg border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--bg-hover)] cursor-pointer">关闭</button>
          </div>
        )}

        {(phase === 'edit' || phase === 'burning') && (
          <>
            {/* 视频预览 */}
            <div className="px-4 pt-3">
              <video src={previewUrl} controls playsInline className="w-full max-h-[200px] object-contain rounded-lg bg-black"/>
            </div>

            {/* 样式 */}
            <div className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--border)]">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-[var(--text-3)]">字号</span>
                {([['小', 0.8], ['中', 1.0], ['大', 1.3]] as const).map(([l, v]) => (
                  <button key={l} className={btn(fontScale === v)} onClick={() => setFontScale(v)}>{l}</button>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-[var(--text-3)]">颜色</span>
                {([['白', 'white'], ['黄', 'yellow']] as const).map(([l, v]) => (
                  <button key={l} className={btn(color === v)} onClick={() => setColor(v)}>{l}</button>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-[var(--text-3)]">位置</span>
                {([['底部', 'bottom'], ['中间', 'center'], ['顶部', 'top']] as const).map(([l, v]) => (
                  <button key={l} className={btn(position === v)} onClick={() => setPosition(v)}>{l}</button>
                ))}
              </div>
            </div>

            {/* 字幕条编辑 */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-2">
              <div className="text-xs text-[var(--text-3)] mb-1">识别出 {segs.length} 句, 改错别字 / 删多余的, 改好点下面按钮烧进视频:</div>
              {segs.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[10px] text-[var(--text-3)] font-mono w-20 flex-shrink-0">{fmt(s.start)}–{fmt(s.end)}</span>
                  <input value={s.text} onChange={e => updateText(i, e.target.value)}
                    className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm focus:border-[var(--text)] outline-none"/>
                  <button onClick={() => removeSeg(i)} className="text-[var(--text-3)] hover:text-red-400 cursor-pointer flex-shrink-0" title="删除这句"><Trash2 size={14}/></button>
                </div>
              ))}
            </div>

            {/* 底部操作 */}
            <div className="px-4 py-3 border-t border-[var(--border)] flex items-center justify-between gap-3">
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
