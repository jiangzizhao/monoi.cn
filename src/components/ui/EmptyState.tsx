import React from 'react'

interface EmptyStateProps {
  icon?: string
  title: string
  description?: string
  action?: React.ReactNode
}

export function EmptyState({ icon = '✦', title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="text-4xl mb-4 opacity-20">{icon}</div>
      <div className="text-[var(--text-secondary)] font-medium mb-1.5">{title}</div>
      {description && <div className="text-[var(--text-muted)] text-sm mb-5">{description}</div>}
      {action}
    </div>
  )
}
