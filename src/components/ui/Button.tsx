import { type ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'ghost' | 'danger' | 'amber'
type Size = 'xs' | 'sm' | 'md'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant; size?: Size; loading?: boolean
}

const variants: Record<Variant, string> = {
  primary: 'bg-indigo-600 hover:bg-indigo-500 text-white border-transparent shadow-sm shadow-indigo-900/40',
  ghost:   'bg-transparent hover:bg-[var(--bg-hover)] text-[var(--text-2)] hover:text-[var(--text)] border-[var(--border)]',
  danger:  'bg-transparent hover:bg-red-950/40 text-red-400 hover:text-red-300 border-red-900/50',
  amber:   'bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border-amber-500/30',
}
const sizes: Record<Size, string> = {
  xs: 'px-2.5 py-1 text-xs gap-1',
  sm: 'px-3 py-1.5 text-xs gap-1.5',
  md: 'px-4 py-2 text-sm gap-2',
}

export function Button({ variant = 'ghost', size = 'sm', loading, children, className = '', disabled, ...p }: Props) {
  return (
    <button
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center rounded-lg border font-medium transition-all duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`}
      {...p}
    >
      {loading
        ? <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeDasharray="60" strokeDashoffset="20"/></svg>
        : children}
    </button>
  )
}
