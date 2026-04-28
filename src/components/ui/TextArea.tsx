import React, { useEffect, useRef } from 'react'

interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  showCount?: boolean
  autoResize?: boolean
}

export function TextArea({ label, showCount, autoResize = true, className = '', ...props }: TextAreaProps) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!autoResize || !ref.current) return
    const el = ref.current
    const resize = () => { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px` }
    el.addEventListener('input', resize)
    resize()
    return () => el.removeEventListener('input', resize)
  }, [autoResize])

  return (
    <div className="flex flex-col gap-1.5">
      {label && <label className="text-xs text-[var(--text-secondary)] font-medium">{label}</label>}
      <textarea
        ref={ref}
        className={[
          'w-full rounded-xl bg-[var(--bg-elevated)] border border-[var(--border)] px-4 py-3',
          'text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]',
          'focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100',
          'resize-none transition-all duration-200',
          className,
        ].join(' ')}
        {...props}
      />
      {showCount && typeof props.value === 'string' && (
        <span className="text-xs text-[var(--text-muted)] text-right">
          {props.value.length}{props.maxLength ? ` / ${props.maxLength}` : ''} 字
        </span>
      )}
    </div>
  )
}
