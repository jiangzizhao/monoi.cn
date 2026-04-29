import { useState } from 'react'
import { X, Loader2 } from 'lucide-react'

const PLATFORMS = ['抖音', '视频号', '小红书', 'B站', 'YouTube', 'Reels']
const STYLES = ['案例启发型', '避坑指南型', '反常认知型', '共鸣观点型', '问题解决型']
const LENGTHS = [
  { label: '短篇', desc: '150-300字' },
  { label: '中篇', desc: '300-600字' },
  { label: '长篇', desc: '600-1200字' },
  { label: '不限', desc: 'AI自由发挥' },
]

interface Props {
  mode: 'original' | 'rewrite'
  onSubmit: (message: string) => void
  onClose: () => void
}

export function CopywritingForm({ mode, onSubmit, onClose }: Props) {
  // 原创字段
  const [industry, setIndustry] = useState('')
  const [audience, setAudience] = useState('')
  // 仿写字段
  const [url, setUrl] = useState('')
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState('')
  // 公用字段
  const [platform, setPlatform] = useState('抖音')
  const [style, setStyle] = useState('案例启发型')
  const [length, setLength] = useState('不限')

  const handleSubmit = async () => {
    if (mode === 'original') {
      if (!industry.trim()) return
      const msg = `【原创文案】
行业/赛道：${industry}
目标用户：${audience || '未指定'}
发布平台：${platform}
文案风格：${style}
字数要求：${length}`
      onSubmit(msg)
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
        const msg = `【仿写文案】
发布平台：${platform}
文案风格：${style}
字数要求：${length}

参考原文：
${data.content}`
        onSubmit(msg)
      } catch (e: any) {
        setFetchError(e.message)
      } finally {
        setFetching(false)
      }
    }
  }

  const isValid = mode === 'original' ? industry.trim().length > 0 : url.trim().length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}/>
      <div className="relative w-full max-w-lg bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <h2 className="text-sm font-semibold text-[var(--text)]">
            {mode === 'original' ? '原创文案' : '仿写文案'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-[var(--text-3)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer">
            <X size={16}/>
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">

          {/* 原创：行业 */}
          {mode === 'original' && (
            <>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-[var(--text-2)]">行业 / 赛道 <span className="text-red-400">*</span></label>
                <input
                  value={industry} onChange={e => setIndustry(e.target.value)}
                  placeholder="例如：美容院、二手车、健身教练..."
                  className="bg-[var(--bg-input)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none focus:border-[var(--text-3)] transition-colors"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-[var(--text-2)]">目标用户</label>
                <input
                  value={audience} onChange={e => setAudience(e.target.value)}
                  placeholder="例如：25-35岁女性、创业者、宝妈..."
                  className="bg-[var(--bg-input)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none focus:border-[var(--text-3)] transition-colors"
                />
              </div>
            </>
          )}

          {/* 仿写：链接 */}
          {mode === 'rewrite' && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-[var(--text-2)]">参考链接 <span className="text-red-400">*</span></label>
              <input
                value={url} onChange={e => { setUrl(e.target.value); setFetchError('') }}
                placeholder="粘贴文章链接或视频链接..."
                className="bg-[var(--bg-input)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none focus:border-[var(--text-3)] transition-colors"
              />
              {fetchError && <p className="text-xs text-red-400">{fetchError}</p>}
            </div>
          )}

          {/* 发布平台 */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-[var(--text-2)]">发布平台</label>
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map(p => (
                <button key={p} onClick={() => setPlatform(p)}
                  className={`px-3 py-1.5 rounded-lg text-xs border transition-all cursor-pointer ${
                    platform === p
                      ? 'bg-[var(--text)] text-[var(--bg)] border-[var(--text)]'
                      : 'bg-[var(--bg-input)] text-[var(--text-2)] border-[var(--border)] hover:border-[var(--text-3)]'
                  }`}>
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* 文案风格 */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-[var(--text-2)]">文案风格</label>
            <div className="flex flex-wrap gap-2">
              {STYLES.map(s => (
                <button key={s} onClick={() => setStyle(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs border transition-all cursor-pointer ${
                    style === s
                      ? 'bg-[var(--text)] text-[var(--bg)] border-[var(--text)]'
                      : 'bg-[var(--bg-input)] text-[var(--text-2)] border-[var(--border)] hover:border-[var(--text-3)]'
                  }`}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* 字数 */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-[var(--text-2)]">字数</label>
            <div className="flex gap-2">
              {LENGTHS.map(l => (
                <button key={l.label} onClick={() => setLength(l.label)}
                  className={`flex-1 flex flex-col items-center py-2 rounded-xl text-xs border transition-all cursor-pointer ${
                    length === l.label
                      ? 'bg-[var(--text)] text-[var(--bg)] border-[var(--text)]'
                      : 'bg-[var(--bg-input)] text-[var(--text-2)] border-[var(--border)] hover:border-[var(--text-3)]'
                  }`}>
                  <span className="font-medium">{l.label}</span>
                  <span className={`mt-0.5 ${length === l.label ? 'opacity-70' : 'text-[var(--text-3)]'}`}>{l.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={!isValid || fetching}
            className="w-full py-2.5 bg-[var(--text)] text-[var(--bg)] rounded-xl text-sm font-medium hover:opacity-80 disabled:opacity-40 transition-all cursor-pointer flex items-center justify-center gap-2"
          >
            {fetching && <Loader2 size={14} className="animate-spin"/>}
            {fetching ? '正在获取内容...' : '开始生成'}
          </button>
        </div>
      </div>
    </div>
  )
}
