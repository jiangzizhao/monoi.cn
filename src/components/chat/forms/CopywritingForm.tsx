import { useState } from 'react'
import { Loader2 } from 'lucide-react'

const PLATFORMS = ['抖音', '视频号', '小红书', 'B站', 'YouTube', 'Reels']
const STYLES = ['案例启发型', '避坑指南型', '反常认知型', '共鸣观点型', '问题解决型']
const LENGTHS = [
  { label: '短篇', desc: '150-300字' },
  { label: '中篇', desc: '300-600字' },
  { label: '长篇', desc: '600-1200字' },
  { label: '不限', desc: '自由发挥' },
]

interface Answers {
  platform?: string
  style?: string
  length?: string
  industry?: string
  audience?: string
  url?: string
}

interface Props {
  mode: 'original' | 'rewrite'
  onSubmit: (message: string) => void
  onClose: () => void
}

// 原创步骤顺序
const ORIGINAL_STEPS = ['platform', 'style', 'length', 'industry', 'audience']
// 仿写步骤顺序
const REWRITE_STEPS = ['url', 'platform', 'style', 'length']

export function CopywritingForm({ mode, onSubmit, onClose }: Props) {
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<Answers>({})
  const [inputVal, setInputVal] = useState('')
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState('')

  const steps = mode === 'original' ? ORIGINAL_STEPS : REWRITE_STEPS
  const currentStep = steps[step]
  const isLastStep = step === steps.length - 1

  const next = (key: string, value: string) => {
    const newAnswers = { ...answers, [key]: value }
    setAnswers(newAnswers)
    setInputVal('')

    if (isLastStep) {
      handleSubmit(newAnswers)
    } else {
      setStep(s => s + 1)
    }
  }

  const handleTextNext = async () => {
    if (!inputVal.trim()) return

    if (currentStep === 'url') {
      setFetching(true)
      setFetchError('')
      try {
        const res = await fetch('/api/fetch-content', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: inputVal.trim() }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || '抓取失败')
        next('url', data.content)
      } catch (e: any) {
        setFetchError(e.message)
      } finally {
        setFetching(false)
      }
    } else {
      next(currentStep, inputVal.trim())
    }
  }

  const handleSubmit = (finalAnswers: Answers) => {
    if (mode === 'original') {
      onSubmit(`【原创文案】平台：${finalAnswers.platform}，风格：${finalAnswers.style}，字数：${finalAnswers.length}，行业：${finalAnswers.industry}，目标用户：${finalAnswers.audience || '通用'}`)
    } else {
      onSubmit(`【仿写文案】平台：${finalAnswers.platform}，风格：${finalAnswers.style}，字数：${finalAnswers.length}\n\n参考原文：\n${finalAnswers.url}`)
    }
  }

  // 每个步骤的问题
  const questions: Record<string, string> = {
    platform: '发布到哪个平台？',
    style:    '选择文案风格',
    length:   '字数要求',
    industry: '你的行业或赛道是？',
    audience: '目标用户是谁？（可跳过）',
    url:      '粘贴参考链接',
  }

  // 已选择的摘要
  const summary = Object.entries(answers)
    .map(([k, v]) => {
      if (k === 'url') return '链接 ✓'
      return v
    })
    .join(' · ')

  const isTextStep = ['industry', 'audience', 'url'].includes(currentStep)

  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose}/>
      <div className="absolute bottom-full left-0 right-0 mb-2 z-20 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden">

        {/* 进度 + 已选摘要 */}
        <div className="px-4 py-2.5 border-b border-[var(--border)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            {steps.map((_, i) => (
              <div key={i} className={`w-1.5 h-1.5 rounded-full transition-all ${i <= step ? 'bg-[var(--text)]' : 'bg-[var(--border)]'}`}/>
            ))}
          </div>
          {summary && <span className="text-xs text-[var(--text-3)] truncate ml-3">{summary}</span>}
        </div>

        {/* 当前问题 */}
        <div className="px-4 pt-3 pb-1">
          <p className="text-sm text-[var(--text)]">{questions[currentStep]}</p>
        </div>

        {/* 选项 or 输入框 */}
        <div className="px-4 pb-4 pt-2">
          {currentStep === 'platform' && (
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map(p => (
                <button key={p} onClick={() => next('platform', p)}
                  className="px-3 py-1.5 rounded-lg text-sm border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--text)] hover:text-[var(--bg)] hover:border-[var(--text)] transition-all cursor-pointer">
                  {p}
                </button>
              ))}
            </div>
          )}

          {currentStep === 'style' && (
            <div className="flex flex-wrap gap-2">
              {STYLES.map(s => (
                <button key={s} onClick={() => next('style', s)}
                  className="px-3 py-1.5 rounded-lg text-sm border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--text)] hover:text-[var(--bg)] hover:border-[var(--text)] transition-all cursor-pointer">
                  {s}
                </button>
              ))}
            </div>
          )}

          {currentStep === 'length' && (
            <div className="flex gap-2">
              {LENGTHS.map(l => (
                <button key={l.label} onClick={() => next('length', l.label)}
                  className="flex-1 flex flex-col items-center py-2 rounded-lg border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--text)] hover:text-[var(--bg)] hover:border-[var(--text)] transition-all cursor-pointer group">
                  <span className="text-sm font-medium">{l.label}</span>
                  <span className="text-xs opacity-60">{l.desc}</span>
                </button>
              ))}
            </div>
          )}

          {isTextStep && (
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <input
                  autoFocus
                  value={inputVal}
                  onChange={e => { setInputVal(e.target.value); setFetchError('') }}
                  onKeyDown={e => { if (e.key === 'Enter') handleTextNext() }}
                  placeholder={
                    currentStep === 'url' ? '粘贴链接，按回车确认...' :
                    currentStep === 'industry' ? '例如：美容院、二手车、健身教练...' :
                    '例如：25-35岁女性、创业者、宝妈...'
                  }
                  className="flex-1 bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none focus:border-[var(--text-3)] transition-colors"
                />
                <button
                  onClick={handleTextNext}
                  disabled={fetching || (!inputVal.trim() && currentStep !== 'audience')}
                  className="px-4 py-2 bg-[var(--text)] text-[var(--bg)] rounded-lg text-sm font-medium hover:opacity-80 disabled:opacity-40 transition-all cursor-pointer flex items-center gap-1.5"
                >
                  {fetching ? <Loader2 size={13} className="animate-spin"/> : null}
                  {isLastStep ? '生成' : '下一步'}
                </button>
                {/* 目标用户可以跳过 */}
                {currentStep === 'audience' && (
                  <button onClick={() => next('audience', '通用用户')}
                    className="px-3 py-2 text-sm text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors cursor-pointer">
                    跳过
                  </button>
                )}
              </div>
              {fetchError && <p className="text-xs text-red-400">{fetchError}</p>}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
