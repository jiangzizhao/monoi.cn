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

interface Props {
  mode: 'original' | 'rewrite'
  onSubmit: (message: string) => void
  onClose: () => void
}

export function CopywritingForm({ mode, onSubmit, onClose }: Props) {
  const [industry, setIndustry] = useState('')
  const [audience, setAudience] = useState('')
  const [url, setUrl] = useState('')
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState('')
  const [platform, setPlatform] = useState('抖音')
  const [style, setStyle] = useState('案例启发型')
  const [length, setLength] = useState('不限')

  const handleSubmit = async () => {
    if (mode === 'original') {
      if (!industry.trim()) return
      onSubmit(`【原创文案】行业：${industry}，目标用户：${audience || '通用'}，平台：${platform}，风格：${style}，字数：${length}`)
    } else {
      if (!url.trim()) return
      setFetching(true)
      setFetchError('')
      try {
        const res = await fetch('/api/fetch-content', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || '抓取失败')
        onSubmit(`【仿写文案】平台：${platform}，风格：${style}，字数：${length}\n\n参考原文：\n${data.content}`)
      } catch (e: any) {
        setFetchError(e.message)
      } finally {
        setFetching(false)
      }
    }
  }

  const isValid = mode === 'original' ? industry.trim().length > 0 : url.trim().length > 0

  return (
    <>
      {/* 点空白关闭 */}
      <div className="fixed inset-0 z-10" onClick={onClose}/>

      <div className="absolute bottom-full left-0 right-0 mb-2 z-20 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden">

        {/* 标题 */}
        <div className="px-4 py-2.5 border-b border-[var(--border)]">
          <span className="text-xs text-[var(--text-3)]">
            {mode === 'original' ? '原创文案' : '仿写文案'} · 填写信息
          </span>
        </div>

        <div className="p-4 flex flex-col gap-3">

          {/* 原创：行业 + 用户 */}
          {mode === 'original' && (
            <div className="flex gap-2">
              <input
                value={industry} onChange={e => setIndustry(e.target.value)}
                placeholder="行业 / 赛道 *（如：美容院）"
                className="flex-1 bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none focus:border-[var(--text-3)] transition-colors"
              />
              <input
                value={audience} onChange={e => setAudience(e.target.value)}
                placeholder="目标用户（如：宝妈）"
                className="flex-1 bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none focus:border-[var(--text-3)] transition-colors"
              />
            </div>
          )}

          {/* 仿写：链接 */}
          {mode === 'rewrite' && (
            <div className="flex flex-col gap-1">
              <input
                value={url} onChange={e => { setUrl(e.target.value); setFetchError('') }}
                placeholder="粘贴文章或视频链接..."
                className="w-full bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none focus:border-[var(--text-3)] transition-colors"
              />
              {fetchError && <p className="text-xs text-red-400 px-1">{fetchError}</p>}
            </div>
          )}

          {/* 平台 */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--text-3)] flex-shrink-0 w-8">平台</span>
            <div className="flex flex-wrap gap-1.5">
              {PLATFORMS.map(p => (
                <button key={p} onClick={() => setPlatform(p)}
                  className={`px-2.5 py-1 rounded-lg text-xs border transition-all cursor-pointer ${
                    platform === p
                      ? 'bg-[var(--text)] text-[var(--bg)] border-[var(--text)]'
                      : 'text-[var(--text-2)] border-[var(--border)] hover:border-[var(--text-3)]'
                  }`}>
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* 风格 */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--text-3)] flex-shrink-0 w-8">风格</span>
            <div className="flex flex-wrap gap-1.5">
              {STYLES.map(s => (
                <button key={s} onClick={() => setStyle(s)}
                  className={`px-2.5 py-1 rounded-lg text-xs border transition-all cursor-pointer ${
                    style === s
                      ? 'bg-[var(--text)] text-[var(--bg)] border-[var(--text)]'
                      : 'text-[var(--text-2)] border-[var(--border)] hover:border-[var(--text-3)]'
                  }`}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* 字数 */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--text-3)] flex-shrink-0 w-8">字数</span>
            <div className="flex gap-1.5">
              {LENGTHS.map(l => (
                <button key={l.label} onClick={() => setLength(l.label)}
                  className={`px-2.5 py-1 rounded-lg text-xs border transition-all cursor-pointer ${
                    length === l.label
                      ? 'bg-[var(--text)] text-[var(--bg)] border-[var(--text)]'
                      : 'text-[var(--text-2)] border-[var(--border)] hover:border-[var(--text-3)]'
                  }`}>
                  {l.label}
                  <span className={`ml-1 ${length === l.label ? 'opacity-60' : 'text-[var(--text-3)]'}`}>
                    {l.desc}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* 提交 */}
          <button
            onClick={handleSubmit}
            disabled={!isValid || fetching}
            className="w-full py-2 bg-[var(--text)] text-[var(--bg)] rounded-lg text-sm font-medium hover:opacity-80 disabled:opacity-40 transition-all cursor-pointer flex items-center justify-center gap-2"
          >
            {fetching && <Loader2 size={13} className="animate-spin"/>}
            {fetching ? '获取内容中...' : '开始生成'}
          </button>
        </div>
      </div>
    </>
  )
}
