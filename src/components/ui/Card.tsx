import React from 'react'

interface CardProps {
  children: React.ReactNode
  className?: string
  hover?: boolean
  onClick?: () => void
}

export function Card({ children, className = '', hover = false, onClick }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={[
        'rounded-2xl bg-white border border-[var(--border)] p-5',
        'shadow-[0_1px_4px_rgba(0,0,0,0.06)]',
        'transition-all duration-200',
        hover && 'hover:border-blue-300 hover:shadow-[0_4px_16px_rgba(79,127,255,0.10)] cursor-pointer',
        onClick && 'cursor-pointer',
        className,
      ].filter(Boolean).join(' ')}
    >
      {children}
    </div>
  )
}
