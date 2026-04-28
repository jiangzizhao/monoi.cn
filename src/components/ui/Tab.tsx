import type { LucideIcon } from 'lucide-react'

interface TabItem {
  key: string
  label: string
  Icon?: LucideIcon
}

interface TabProps {
  items: TabItem[]
  active: string
  onChange: (key: string) => void
  className?: string
}

export function Tab({ items, active, onChange, className = '' }: TabProps) {
  return (
    <div className={[
      'flex gap-1 p-1 bg-[var(--bg-elevated)] rounded-xl border border-[var(--border)]',
      className,
    ].join(' ')}>
      {items.map(({ key, label, Icon }) => {
        const isActive = active === key
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            className={[
              'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer',
              isActive
                ? 'shadow-sm border border-[var(--border)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-white/60',
            ].join(' ')}
            style={isActive ? {
              background: 'linear-gradient(135deg,#f0f6ff 0%,#ffffff 100%)',
              color: '#4f7fff',
            } : {}}
          >
            {Icon && <Icon size={14} strokeWidth={isActive ? 2.2 : 1.8} />}
            {label}
          </button>
        )
      })}
    </div>
  )
}
