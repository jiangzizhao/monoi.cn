import { useEffect } from 'react'
import { X } from 'lucide-react'

export function Modal({ open, onClose, title, children, width = 'max-w-md' }:
  { open:boolean; onClose:()=>void; title?:string; children:React.ReactNode; width?:string }) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm"/>
      <div className={`relative w-full ${width} rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] shadow-2xl`} onClick={e => e.stopPropagation()}>
        {title && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
            <h3 className="font-semibold text-[var(--text)]">{title}</h3>
            <button onClick={onClose} className="text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors cursor-pointer p-1 rounded-lg hover:bg-[var(--bg-hover)]"><X size={16}/></button>
          </div>
        )}
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}
