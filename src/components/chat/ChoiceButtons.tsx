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
          // 用户反馈: 选了一个之后其他选项也要能继续点 (反悔 / 多试一个).
          // 之前会锁掉非选中选项, 现在改成全部一直可点, 只用高亮区分选过的.
          return (
            <button
              key={opt.id}
              onClick={() => onChoose(opt)}
              className={[
                'flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border text-sm transition-all duration-150 cursor-pointer',
                vertical ? 'w-full' : '',
                isChosen
                  ? 'bg-[var(--text)] border-[var(--text)] text-[var(--bg)] hover:opacity-90'
                  : 'bg-[var(--bg-card)] border-[var(--border)] text-[var(--text)] hover:border-[var(--text-3)] hover:bg-[var(--bg-hover)]',
              ].join(' ')}
            >
              {opt.icon && <span className="text-base flex-shrink-0">{opt.icon}</span>}
              <div className="text-left">
                <div className="font-medium leading-tight">{opt.label}</div>
                {opt.description && <div className={`text-xs mt-0.5 ${isChosen ? 'text-[var(--bg)] opacity-70' : 'text-[var(--text-3)]'}`}>{opt.description}</div>}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
