import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

export function CopyButton({ text, className = '' }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button onClick={copy} title="复制"
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-all duration-150 cursor-pointer ${copied ? 'text-green-400 bg-green-950/30' : 'text-[var(--text-3)] hover:text-[var(--text-2)] hover:bg-[var(--bg-hover)]'} ${className}`}>
      {copied ? <><Check size={12} strokeWidth={2.5}/><span>已复制</span></> : <><Copy size={12} strokeWidth={1.8}/><span>复制</span></>}
    </button>
  )
}
