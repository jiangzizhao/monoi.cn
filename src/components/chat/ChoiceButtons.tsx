import type { ChoiceOption } from '../../types'

interface Props {
  question?: string
  options: ChoiceOption[]
  chosen?: string
  onChoose: (opt: ChoiceOption) => void
}

export function ChoiceButtons({ question, options, chosen, onChoose }: Props) {
  const vertical = options.length >= 4
  return (
    <div className="flex flex-col gap-2 mt-1">
      {question && <p className="text-sm text-[var(--text-2)]">{question}</p>}
      <div className={`flex gap-2 flex-wrap ${vertical ? 'flex-col' : ''}`}>
        {options.map(opt => {
          const isChosen = chosen === opt.id
          const isDisabled = !!chosen && !isChosen
          return (
            <button
              key={opt.id}
              disabled={isDisabled}
              onClick={() => !chosen && onChoose(opt)}
              className={[
                'flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border text-sm transition-all duration-150',
                vertical ? 'w-full' : '',
                isChosen
                  ? 'bg-indigo-600 border-indigo-500 text-white shadow-sm shadow-indigo-900/40'
                  : isDisabled
                  ? 'bg-transparent border-[var(--border-subtle)] text-[var(--text-3)] cursor-not-allowed opacity-40'
                  : 'bg-[var(--bg-card)] border-[var(--border)] text-[var(--text)] hover:border-indigo-500/60 hover:bg-[var(--bg-hover)] hover:scale-[1.02] cursor-pointer',
              ].join(' ')}
            >
              {opt.icon && <span className="text-base flex-shrink-0">{opt.icon}</span>}
              <div className="text-left">
                <div className="font-medium leading-tight">{opt.label}</div>
                {opt.description && <div className={`text-xs mt-0.5 ${isChosen ? 'text-indigo-200' : 'text-[var(--text-3)]'}`}>{opt.description}</div>}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
