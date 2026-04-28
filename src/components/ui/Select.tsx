import React from 'react'

interface Option { value: string; label: string }

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  options: Option[]
}

export function Select({ label, options, className = '', ...props }: SelectProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label className="text-xs text-[var(--text-secondary)] font-medium">{label}</label>}
      <select
        className={[
          'rounded-xl bg-[var(--bg-elevated)] border border-[var(--border)] px-3 py-2',
          'text-sm text-[var(--text-primary)] cursor-pointer',
          'focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100',
          'transition-all duration-200',
          className,
        ].join(' ')}
        {...props}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  )
}
