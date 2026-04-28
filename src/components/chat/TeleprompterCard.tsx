import { Download } from 'lucide-react'
import { CopyButton } from '../ui/CopyButton'
import { formatTeleprompter } from '../../utils/teleprompter'

export function TeleprompterCard({ rawText }: { rawText: string }) {
  const formatted = formatTeleprompter(rawText, 15)
  const download = () => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([formatted], { type: 'text/plain' })); a.download = 'teleprompter.txt'; a.click()
  }
  return (
    <div className="w-full rounded-xl border border-[var(--border)] overflow-hidden">
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-[var(--border)]">
        <span className="text-xs text-[var(--text-3)] font-medium">提词器</span>
        <div className="flex gap-1.5">
          <CopyButton text={formatted}/>
          <button onClick={download} className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-[var(--text-3)] hover:text-[var(--text-2)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer">
            <Download size={11}/> 导出 .txt
          </button>
        </div>
      </div>
      <div className="p-4 bg-black/30 font-mono text-lg leading-loose text-[var(--text)] max-h-72 overflow-y-auto">
        {formatted.split('\n').map((line, i) =>
          line.trim() ? (
            <div key={i} className="py-0.5">
              <span className="text-amber-400">{line}</span>
            </div>
          ) : <div key={i} className="h-3"/>
        )}
      </div>
    </div>
  )
}
