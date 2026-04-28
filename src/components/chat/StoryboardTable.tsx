import { useState } from 'react'
import { FileText, Smartphone, ArrowUp, ArrowDown, Trash2 } from 'lucide-react'
import type { StoryboardRowItem } from '../../types'

const VISUAL_OPTS = ['口播正脸', 'B-roll 素材', '文字全屏']

export function StoryboardTable({ data, onMultiPlatform }: { data: StoryboardRowItem[]; onMultiPlatform?: () => void }) {
  const [rows, setRows] = useState(data)

  const move = (i: number, dir: -1|1) => {
    const r = [...rows]; const t = i + dir
    if (t < 0 || t >= r.length) return
    ;[r[i], r[t]] = [r[t], r[i]]; setRows(r)
  }
  const del = (i: number) => setRows(r => r.filter((_, idx) => idx !== i))
  const setVisual = (i: number, v: string) => setRows(r => r.map((row, idx) => idx === i ? { ...row, visual: v } : row))

  const exportTxt = () => {
    const txt = rows.map(r => `[${r.time}] ${r.visual}\n字幕：${r.subtitle}\n特效：${r.effect}`).join('\n\n---\n\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain' })); a.download = 'storyboard.txt'; a.click()
  }

  return (
    <div className="w-full rounded-xl border border-[var(--border)] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-[var(--bg-hover)] text-[var(--text-3)]">
              {['时间段','画面类型','字幕','特效',''].map(h => (
                <th key={h} className="px-3 py-2.5 text-left font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className="border-t border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] transition-colors">
                <td className="px-3 py-2.5 font-mono text-[var(--text-3)] whitespace-nowrap">{r.time}</td>
                <td className="px-3 py-2.5">
                  <select value={r.visual} onChange={e => setVisual(i, e.target.value)}
                    className="bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-2 py-1 text-[var(--text)] text-xs cursor-pointer focus:outline-none focus:border-indigo-500/60">
                    {VISUAL_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2.5 text-[var(--text)] max-w-[220px]">{r.subtitle}</td>
                <td className="px-3 py-2.5 text-[var(--text-2)] max-w-[140px]">{r.effect}</td>
                <td className="px-3 py-2.5">
                  <div className="flex gap-0.5">
                    <button onClick={() => move(i,-1)} disabled={i===0} className="p-1 rounded text-[var(--text-3)] hover:text-[var(--text-2)] disabled:opacity-20 cursor-pointer transition-colors"><ArrowUp size={12}/></button>
                    <button onClick={() => move(i,1)} disabled={i===rows.length-1} className="p-1 rounded text-[var(--text-3)] hover:text-[var(--text-2)] disabled:opacity-20 cursor-pointer transition-colors"><ArrowDown size={12}/></button>
                    <button onClick={() => del(i)} className="p-1 rounded text-[var(--text-3)] hover:text-red-400 cursor-pointer transition-colors"><Trash2 size={12}/></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-[var(--border)] px-3 py-2.5 flex gap-2">
        <button onClick={exportTxt} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-[var(--text-2)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] border border-[var(--border)] transition-all cursor-pointer">
          <FileText size={12}/> 导出文档
        </button>
        {onMultiPlatform && (
          <button onClick={onMultiPlatform} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-indigo-300 hover:text-indigo-200 hover:bg-indigo-950/40 border border-indigo-800/40 hover:border-indigo-500/50 transition-all cursor-pointer">
            <Smartphone size={12}/> 生成多平台文案
          </button>
        )}
      </div>
    </div>
  )
}
