import React from 'react'
const colors = {
  indigo: 'bg-[var(--bg-hover)] text-[var(--text-2)] border-[var(--border)]',
  amber:  'bg-[var(--bg-hover)] text-[var(--text-2)] border-[var(--border)]',
  green:  'bg-[var(--bg-hover)] text-[var(--text-2)] border-[var(--border)]',
  default:'bg-[var(--bg-hover)] text-[var(--text-2)] border-[var(--border)]',
}
export function Badge({ children, color = 'default' as keyof typeof colors, className = '' }: { children: React.ReactNode; color?: keyof typeof colors; className?: string }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs border ${colors[color]} ${className}`}>{children}</span>
}
