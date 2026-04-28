

interface SliderProps {
  label?: string
  min: number
  max: number
  value: number
  onChange: (v: number) => void
  step?: number
  unit?: string
}

export function Slider({ label, min, max, value, onChange, step = 1, unit = '' }: SliderProps) {
  return (
    <div className="flex flex-col gap-2">
      {label && (
        <div className="flex justify-between items-center">
          <label className="text-xs text-[var(--text-secondary)] font-medium">{label}</label>
          <span className="text-xs text-[var(--text-primary)] font-mono">
            {value}{unit}
          </span>
        </div>
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-indigo-500 cursor-pointer h-1.5 rounded-full"
      />
      <div className="flex justify-between text-xs text-[var(--text-muted)]">
        <span>{min}{unit}</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  )
}
