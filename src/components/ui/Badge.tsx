import React from 'react'
const colors = {
  indigo: 'bg-indigo-950/60 text-indigo-400 border-indigo-800/40',
  amber:  'bg-amber-950/40 text-amber-400 border-amber-800/30',
  green:  'bg-green-950/40 text-green-400 border-green-800/30',
  default:'bg-[var(--bg-hover)] text-[var(--text-2)] border-[var(--border)]',
}
export function Badge({ children, color = 'default' as keyof typeof colors, className = '' }: { children: React.ReactNode; color?: keyof typeof colors; className?: string }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs border ${colors[color]} ${className}`}>{children}</span>
}
