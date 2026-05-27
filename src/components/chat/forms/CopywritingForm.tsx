import { useState, useRef, useEffect } from 'react'
import { Loader2, AlertCircle, Upload } from 'lucide-react'
import { consumePrefill } from '../../../lib/formPrefill'
import { getToken } from '../../../lib/auth'

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
  mode: 'original' | 'rewrite' | 'paste'
  onSubmit: (message: string) => void
  onClose: () => void
}

const ORIGINAL_STEPS = ['platform', 'style', 'length', 'industry', 'audience']
const REWRITE_STEPS = ['url', 'platform', 'style', 'length']

export function CopywritingForm({ mode, onSubmit, onClose }: Props) {
  if (mode === 'paste') {
    return <PasteScriptForm onSubmit={onSubmit} onClose={onClose}/>
  }
  return <GuidedForm mode={mode} onSubmit={onSubmit} onClose={onClose}/>
}

function GuidedForm({ mode, onSubmit, onClose }: { mode: 'original' | 'rewrite'; onSubmit: (m: string) => void; onClose: () => void }) {
  // Agentic AI: 如果 prefill 把所有 step 都填齐了, 直接 submit 跳过引导
  const formId = mode === 'original' ? '__form_original__' : '__form_rewrite__'
  const initial = consumePrefill<Answers>(formId)
  const steps = mode === 'original' ? ORIGINAL_STEPS : REWRITE_STEPS

  // 计算从哪个 step 起跳: prefill 填了几项就跳几个
  const initialStep = (() => {
    if (!initial) return 0
    for (let i = 0; i < steps.length; i++) {
      if (!initial[steps[i] as keyof Answers]) return i
    }
    return steps.length  // 全填完了, 应该直接 submit
  })()

  const [step, setStep] = useState(Math.min(initialStep, steps.length - 1))
  const [answers, setAnswers] = useState<Answers>(initial || {})
  const [inputVal, setInputVal] = useState('')
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState('')

  const currentStep = steps[step]
  const isLastStep = step === steps.length - 1

  // 全填齐了 → mount 后一次性 submit 跳过整个引导 (deps 空, 只跑一次)
  useEffect(() => {
    if (initial && initialStep >= steps.length) {
      if (mode === 'original') {
        onSubmit(`【原创文案】平台:${initial.platform},风格:${initial.style},字数:${initial.length},行业:${initial.industry},目标用户:${initial.audience || '通用'}`)
      } else {
        onSubmit(`【仿写文案】平台:${initial.platform},风格:${initial.style},字数:${initial.length}\n\n参考原文:\n${initial.url}`)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const handleSubmit = (finalAnswers: Answers) => {
    if (mode === 'original') {
      onSubmit(`【原创文案】平台：${finalAnswers.platform}，风格：${finalAnswers.style}，字数：${finalAnswers.length}，行业：${finalAnswers.industry}，目标用户：${finalAnswers.audience || '通用'}`)
    } else {
      onSubmit(`【仿写文案】平台：${finalAnswers.platform}，风格：${finalAnswers.style}，字数：${finalAnswers.length}\n\n参考原文：\n${finalAnswers.url}`)
    }
  }

  const handleUrlNext = async () => {
    if (!inputVal.trim()) return
    setFetching(true)
    setFetchError('')
    try {
      const token = getToken()
      const res = await fetch('/api/fetch-content', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ url: inputVal.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '获取失败')
      next('url', data.content)
    } catch (e: any) {
      setFetchError(e.message || '链接内容获取失败，请换一个链接试试')
    } finally {
      setFetching(false)
    }
  }

  const handleTextNext = () => {
    if (!inputVal.trim() && currentStep !== 'audience') return
    next(currentStep, inputVal.trim() || '通用用户')
  }

  const questions: Record<string, string> = {
    platform: '发布到哪个平台？',
    style:    '选择文案风格',
    length:   '字数要求',
    industry: '你的行业或赛道是？',
    audience: '目标用户是谁？（可跳过）',
    url:      '粘贴参考链接',
  }

  const summary = Object.entries(answers)
    .map(([k, v]) => k === 'url' ? '原文 ✓' : v)
    .join(' · ')

  const isTextStep = ['industry', 'audience'].includes(currentStep)

  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose}/>
      <div className="absolute bottom-full left-0 right-0 mb-2 z-20 bg-[var(--bg-card)] border border-[var(--border)] rounded-[18px] shadow-ios-lg overflow-hidden sheet-enter">

        {/* 进度条 */}
        <div className="px-4 py-2.5 border-b border-[var(--border)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            {steps.map((_, i) => (
              <div key={i} className={`w-1.5 h-1.5 rounded-full transition-all ${i <= step ? 'bg-[var(--text)]' : 'bg-[var(--border)]'}`}/>
            ))}
          </div>
          {summary && <span className="text-xs text-[var(--text-3)] truncate ml-3">{summary}</span>}
        </div>

        <div className="px-4 pt-3 pb-1">
          <p className="text-sm text-[var(--text)]">{questions[currentStep]}</p>
        </div>

        <div className="px-4 pb-4 pt-2">

          {/* 平台选项 */}
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

          {/* 风格选项 */}
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

          {/* 字数选项 */}
          {currentStep === 'length' && (
            <div className="flex gap-2">
              {LENGTHS.map(l => (
                <button key={l.label} onClick={() => next('length', l.label)}
                  className="flex-1 flex flex-col items-center py-2 rounded-lg border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--text)] hover:text-[var(--bg)] hover:border-[var(--text)] transition-all cursor-pointer">
                  <span className="text-sm font-medium">{l.label}</span>
                  <span className="text-xs opacity-60">{l.desc}</span>
                </button>
              ))}
            </div>
          )}

          {/* 链接输入 */}
          {currentStep === 'url' && (
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <input
                  autoFocus
                  value={inputVal}
                  onChange={e => { setInputVal(e.target.value); setFetchError('') }}
                  onKeyDown={e => { if (e.key === 'Enter') handleUrlNext() }}
                  placeholder="粘贴链接，按回车..."
                  className={`flex-1 bg-[var(--bg-input)] border rounded-lg px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none transition-colors ${fetchError ? 'border-red-500/60' : 'border-[var(--border)] focus:border-[var(--text-3)]'}`}
                />
                <button onClick={handleUrlNext} disabled={fetching || !inputVal.trim()}
                  className="px-4 py-2 bg-[var(--text)] text-[var(--bg)] rounded-lg text-sm font-medium hover:opacity-80 disabled:opacity-40 cursor-pointer flex items-center gap-1.5">
                  {fetching ? <Loader2 size={13} className="animate-spin"/> : '确认'}
                </button>
              </div>
              {fetchError && (
                <div className="flex items-center gap-1.5 text-xs text-red-400">
                  <AlertCircle size={12}/>
                  <span>{fetchError}</span>
                </div>
              )}
            </div>
          )}

          {/* 文字输入步骤 */}
          {isTextStep && (
            <div className="flex gap-2">
              <input
                autoFocus
                value={inputVal}
                onChange={e => setInputVal(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleTextNext() }}
                placeholder={
                  currentStep === 'industry' ? '例如：美容院、二手车、健身教练...' :
                  '例如：25-35岁女性、创业者、宝妈...'
                }
                className="flex-1 bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none focus:border-[var(--text-3)] transition-colors"
              />
              <button onClick={handleTextNext}
                disabled={!inputVal.trim() && currentStep !== 'audience'}
                className="px-4 py-2 bg-[var(--text)] text-[var(--bg)] rounded-lg text-sm font-medium hover:opacity-80 disabled:opacity-40 cursor-pointer">
                {isLastStep ? '生成' : '下一步'}
              </button>
              {currentStep === 'audience' && (
                <button onClick={() => next('audience', '通用用户')}
                  className="px-3 py-2 text-sm text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors cursor-pointer">
                  跳过
                </button>
              )}
            </div>
          )}

        </div>
      </div>
    </>
  )
}

function PasteScriptForm({ onSubmit, onClose }: { onSubmit: (m: string) => void; onClose: () => void }) {
  // Agentic AI: AI 串步可以预填文案 (例如写完 script_card 后开 paste 流让用户接配音)
  const initial = consumePrefill<{ text?: string; script?: string }>('__form_paste__')
  const [text, setText] = useState(initial?.text || initial?.script || '')
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const charCount = text.replace(/\s/g, '').length

  const handleFile = async (f: File) => {
    if (f.size > 1024 * 1024) {
      setError('文件太大 (>1MB), 请粘贴文本')
      return
    }
    try {
      const content = await f.text()
      setText(content.trim())
      setError('')
    } catch {
      setError('读取文件失败')
    }
  }

  const handleSubmit = () => {
    const trimmed = text.trim()
    if (!trimmed) {
      setError('请粘贴文案或上传 .txt 文件')
      return
    }
    if (trimmed.length < 20) {
      setError('文案太短 (<20 字), 这能配音吗?')
      return
    }
    onSubmit(`__paste_script__${trimmed}`)
  }

  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose}/>
      <div className="absolute bottom-full left-0 right-0 mb-2 z-20 bg-[var(--bg-card)] border border-[var(--border)] rounded-[18px] shadow-ios-lg overflow-hidden sheet-enter">
        <div className="px-4 py-2.5 border-b border-[var(--border)] flex items-center justify-between">
          <span className="text-xs text-[var(--text-3)]">我有文案 · 直接用</span>
          <span className="text-xs text-[var(--text-3)]">{charCount} 字</span>
        </div>

        <div className="px-4 pt-3 pb-4 flex flex-col gap-2">
          <textarea
            autoFocus
            value={text}
            onChange={e => { setText(e.target.value); setError('') }}
            placeholder="把你写好的口播文案粘贴在这里, 后面接配音/素材/分镜..."
            rows={6}
            className={`w-full bg-[var(--bg-input)] border rounded-lg px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none transition-colors resize-none ${error ? 'border-red-500/60' : 'border-[var(--border)] focus:border-[var(--text-3)]'}`}
            style={{ minHeight: '120px', maxHeight: '300px' }}
          />

          {error && (
            <div className="flex items-center gap-1.5 text-xs text-red-400">
              <AlertCircle size={12}/>
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 mt-1">
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-2 text-xs text-[var(--text-2)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors cursor-pointer"
            >
              <Upload size={12}/>
              上传 .txt 文件
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,text/plain"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0]
                if (f) handleFile(f)
                if (fileRef.current) fileRef.current.value = ''
              }}
            />
            <button
              onClick={handleSubmit}
              disabled={!text.trim()}
              className="px-4 py-2 bg-[var(--text)] text-[var(--bg)] rounded-lg text-sm font-medium hover:opacity-80 disabled:opacity-40 cursor-pointer"
            >
              用这篇
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
