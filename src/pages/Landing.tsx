import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Sparkles, ArrowRight, Play, MessageSquare, Mic, Video, Film, Scissors, Image as ImageIcon,
  Send, ChevronDown, ChevronUp, Check, PencilLine,
} from 'lucide-react'
import { fetchDesktopLatest, type DesktopLatest } from '../services/desktop'
import { Logo } from '../components/Logo'


// =============== 内容数据 ===============

const PLACEHOLDER_PROMPTS = [
  '介绍北京冬天最好吃的 5 家小吃店...',
  '我想做一条减肥科普视频, 讲清楚为啥少吃多动不一定瘦',
  '夏天日系穿搭分享, 适合身高 160 的女生',
  '深度解析新出的 iPhone, 跟上一代区别在哪',
  '推荐最近看的 3 本好书, 每本简评 30 字',
]

const STEPS = [
  { Icon: MessageSquare, title: '输入想法', desc: '一句话告诉 monoi 你要做什么主题' },
  { Icon: PencilLine,    title: 'AI 写文案', desc: '自动生成爆款结构的口播稿' },
  { Icon: Mic,           title: '配音 / 数字人', desc: '选音色 · 克隆你的声音 · 数字人念稿' },
  { Icon: Scissors,      title: '智能剪辑', desc: '自动找素材 · 配字幕 · 加封面' },
  { Icon: Send,          title: '一键发布', desc: '直接发到抖音 / 小红书' },
]

const FEATURES = [
  { icon: MessageSquare, title: 'AI 文案生成' },
  { icon: Mic, title: '配音音色库 + 克隆' },
  { icon: Video, title: '数字人' },
  { icon: Film, title: '智能素材匹配' },
  { icon: Scissors, title: '口播剪辑' },
  { icon: ImageIcon, title: '封面 + 自动发布' },
]

const PRICING = [
  {
    tier: 'free', name: '免费', price: '¥0', period: '7 天体验',
    features: [
      '赠送 700 积分 (7 天免费创作)',
      '配音预设',
      '数字人 (1 个形象)',
      '文案 + 封面',
    ],
    cta: '免费开始',
  },
  {
    tier: 'pro', name: 'Pro', price: '¥99', period: '/月',
    features: [
      '1,500 积分/月',
      '1 个克隆声音 · 数字人 5 个形象',
      '一键合成 + 素材匹配',
      '口播剪辑 + 抠图 + 封面模板',
    ],
    cta: '选 Pro',
  },
  {
    tier: 'max', name: 'Max', price: '¥199', period: '/月', highlighted: true, badge: '最受欢迎',
    features: [
      '4,000 积分/月',
      '3 个克隆声音 · 数字人 10 个形象',
      'Pro 全部功能',
      '去人声 + 自动发布 (Beta)',
    ],
    cta: '选 Max',
  },
]

const FAQS = [
  {
    q: '不愿意出镜怎么办?',
    a: '用数字人替你出镜. 上传一段 30 秒-2 分钟的形象视频, AI 学会你的脸 + 口型, 之后所有口播 monoi 都能替你录制. 也可以只克隆声音, 用现成的数字人形象.',
  },
  {
    q: '没有视频素材怎么办?',
    a: 'AI 按你的文案逐句拆解, 自动从 Pexels / Pixabay 等无版权素材库匹配对应画面. 不满意可以一句一句换关键词重搜.',
  },
  {
    q: '生成的视频质量怎么样, 真能发出去吗?',
    a: '1080p 高清输出, 无水印. 字幕自动生成, 不要的句子词级编辑删除. 用户已经发到抖音/小红书拿到爆款数据.',
  },
  {
    q: '克隆声音 / 数字人形象有什么不一样?',
    a: '克隆声音 = 复刻你的声音 (上传 5-15s 样本); 数字人形象 = AI 替你出镜口播 (上传 30秒-2分钟形象视频). Pro 1 个克隆声音 / 5 个数字人形象, Max 3 个 / 10 个, 旗舰 5 个 / 不限.',
  },
  {
    q: '自动发布功能什么时候能用?',
    a: '自动发布需要安装桌面客户端 (因为浏览器安全限制无法直接操控本地浏览器). Max 起可用, 客户端 Beta 内测中, 加客服微信申请优先体验.',
  },
  {
    q: '支持退款吗?',
    a: '所有套餐和积分包不支持退款, 请按需购买. 月卡可以随时取消自动续费, 当期内仍然能用.',
  },
]


// =============== 组件 ===============

export default function Landing() {
  const nav = useNavigate()
  const [prompt, setPrompt] = useState('')
  const [placeholderIdx, setPlaceholderIdx] = useState(0)
  const [scrolled, setScrolled] = useState(false)
  const [openFaq, setOpenFaq] = useState<number | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [desktop, setDesktop] = useState<DesktopLatest | null>(null)

  // 拉桌面端最新版本 (后端 desktop_release.json), 没发布隐藏按钮
  useEffect(() => {
    if (typeof (window as any).monoiDesktop !== 'undefined') return  // 已经在桌面端
    fetchDesktopLatest().then(setDesktop).catch(() => { /* 静默 */ })
  }, [])

  // placeholder 轮播
  useEffect(() => {
    const t = setInterval(() => {
      setPlaceholderIdx(i => (i + 1) % PLACEHOLDER_PROMPTS.length)
    }, 3500)
    return () => clearInterval(t)
  }, [])

  // 滚动时 nav 加阴影
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const submitPrompt = () => {
    const text = prompt.trim()
    if (text) {
      // 注册/登录完进 /app 时, ChatInput 会读这个 key 预填
      localStorage.setItem('pending_prompt', text)
    }
    nav('/register')
  }

  const focusInput = () => inputRef.current?.focus()

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">

      {/* =============== Nav =============== */}
      <nav className={`sticky top-0 z-50 transition-all ${
        scrolled ? 'bg-white/80 backdrop-blur-md border-b border-[var(--border)]' : 'bg-transparent'
      }`}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Logo className="w-8 h-8 rounded-xl object-contain"/>
            <span className="font-semibold">monoi</span>
          </div>
          <div className="hidden sm:flex items-center gap-6 text-sm text-[var(--text-2)]">
            <a href="#features" className="hover:text-[var(--text)]">功能</a>
            <a href="#pricing" className="hover:text-[var(--text)]">定价</a>
            <a href="#faq" className="hover:text-[var(--text)]">FAQ</a>
            {/* 下载桌面版 — 桌面端自身不显示 (已经装了); 后端没配也不显示 */}
            {typeof (window as any).monoiDesktop === 'undefined' && desktop?.available && desktop.exe_url && (
              <a href={desktop.exe_url}
                download
                className="hover:text-[var(--text)] flex items-center gap-1"
                title={`v${desktop.version}${desktop.size_mb ? ` · ${desktop.size_mb} MB` : ''}`}>
                💻 桌面版
              </a>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => nav('/login')}
              className="px-3 sm:px-4 py-2 text-sm text-[var(--text-2)] hover:text-[var(--text)] cursor-pointer">
              登录
            </button>
            <button onClick={() => nav('/register')}
              className="px-3 sm:px-4 py-2 text-sm bg-[var(--text)] text-[var(--bg)] rounded-xl hover:opacity-80 cursor-pointer font-medium">
              免费开始
            </button>
          </div>
        </div>
      </nav>

      {/* =============== Hero =============== */}
      <section className="px-4 sm:px-6 pt-12 sm:pt-20 pb-16 sm:pb-24 max-w-5xl mx-auto text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--bg-hover)] border border-[var(--border)] text-[var(--text-2)] text-xs mb-6 sm:mb-8">
          <Sparkles size={12}/> AI 短视频全流程 · 一句话搞定
        </div>

        <h1 className="text-4xl sm:text-6xl md:text-7xl font-bold leading-[1.1] mb-4 sm:mb-6">
          把你的想法<br/>
          <span className="text-[var(--text-2)]">一句话变成爆款视频</span>
        </h1>

        <p className="text-base sm:text-lg text-[var(--text-2)] max-w-2xl mx-auto mb-8 sm:mb-10 leading-relaxed">
          monoi 帮你写文案 · 配音 · 数字人 · 剪辑 · 自动发布<br/>
          全程对话, 像聊天一样简单
        </p>

        {/* 巨型输入框 (焦点) */}
        <div className="max-w-2xl mx-auto">
          <div className="relative bg-[var(--bg-card)] border-2 border-[var(--border)] rounded-2xl p-2 shadow-ios focus-within:border-[var(--text-3)] transition-colors">
            <textarea
              ref={inputRef}
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitPrompt() } }}
              placeholder={PLACEHOLDER_PROMPTS[placeholderIdx]}
              rows={3}
              className="w-full px-4 py-3 bg-transparent text-base resize-none focus:outline-none placeholder:text-[var(--text-3)]"
            />
            <div className="flex items-center justify-between px-2">
              <span className="text-[11px] text-[var(--text-3)]">
                ⚡ 新用户 7 天免费 · 每天送 60 积分 · 不需要任何视频技能
              </span>
              <button onClick={submitPrompt}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-[var(--text)] text-[var(--bg)] rounded-xl text-sm font-medium hover:opacity-80 cursor-pointer">
                开始创作 <ArrowRight size={14}/>
              </button>
            </div>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-center gap-3 text-sm text-[var(--text-3)]">
          <a href="#examples" className="hover:text-[var(--text-2)] cursor-pointer">看看示例</a>
          <span>·</span>
          <a href="#pricing" className="hover:text-[var(--text-2)] cursor-pointer">查看定价</a>
        </div>
      </section>

      {/* =============== 示例视频墙 (auto-scroll marquee) =============== */}
      <section id="examples" className="py-12 sm:py-20 max-w-6xl mx-auto">
        <div className="text-center mb-8 sm:mb-12 px-4">
          <h2 className="text-2xl sm:text-4xl font-bold mb-3">用 monoi 已经做出的视频</h2>
          <p className="text-sm text-[var(--text-3)]">真实用户作品 · 一句话生成的完整短视频</p>
        </div>
        {/* 跑马灯: 复制一份元素拼接, animation 平移 50% 形成无缝循环. 容器 overflow-hidden 限制宽度. hover 暂停 */}
        <div className="relative overflow-hidden mx-4 sm:mx-0"
          onMouseEnter={e => { (e.currentTarget.querySelector('[data-marquee]') as HTMLElement)?.style.setProperty('animation-play-state', 'paused') }}
          onMouseLeave={e => { (e.currentTarget.querySelector('[data-marquee]') as HTMLElement)?.style.setProperty('animation-play-state', 'running') }}>
          <div data-marquee className="flex gap-3 sm:gap-4 w-max animate-marquee">
            {[...Array(2)].flatMap((_, dup) =>
              [...Array(6)].map((_, i) => (
                <div key={`${dup}-${i}`} className="flex-shrink-0 w-36 sm:w-44">
                  <div className="aspect-[9/16] rounded-2xl bg-gradient-to-br from-[var(--bg-card)] to-[var(--bg-hover)] border border-[var(--border)] flex items-center justify-center cursor-pointer hover:scale-105 transition-transform group relative overflow-hidden">
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                        <Play size={20} className="text-black ml-1" fill="currentColor"/>
                      </div>
                    </div>
                    <span className="text-[10px] text-[var(--text-3)] absolute bottom-2 left-2">示例 #{i+1}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {/* =============== 5 步流程 =============== */}
      <section className="px-4 sm:px-6 py-12 sm:py-20 max-w-6xl mx-auto bg-[var(--bg-hover)]/30 rounded-3xl">
        <div className="text-center mb-8 sm:mb-12">
          <h2 className="text-2xl sm:text-4xl font-bold mb-3">从一段文字, 到一条能发的视频</h2>
          <p className="text-sm text-[var(--text-3)]">5 步, 全程对话</p>
        </div>
        <div className="flex flex-col sm:flex-row items-center sm:items-stretch gap-3 sm:gap-2">
          {STEPS.map((s, i) => (
            <div key={i} className="flex-1 flex sm:flex-col items-center gap-3 sm:gap-2 w-full">
              <div className="flex flex-col items-center flex-shrink-0">
                <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] flex items-center justify-center mb-1 sm:mb-2">
                  <s.Icon size={22} className="text-[var(--text-2)]" strokeWidth={1.6}/>
                </div>
                <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-[var(--text)] text-[var(--bg)] flex items-center justify-center text-xs font-bold">{i+1}</div>
              </div>
              <div className="flex-1 text-left sm:text-center">
                <div className="text-sm sm:text-base font-semibold mb-0.5 sm:mb-1">{s.title}</div>
                <div className="text-xs text-[var(--text-3)] leading-relaxed">{s.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* =============== 核心功能 =============== */}
      <section id="features" className="px-4 sm:px-6 py-12 sm:py-20 max-w-6xl mx-auto">
        <div className="text-center mb-8 sm:mb-12">
          <h2 className="text-2xl sm:text-4xl font-bold mb-3">你能用 monoi 做什么</h2>
          <p className="text-sm text-[var(--text-3)]">从文案到发布, 全链路 AI 辅助</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {FEATURES.map((f, i) => (
            <button key={i} onClick={focusInput}
              className="text-left p-5 sm:p-6 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--text-3)] hover:bg-[var(--bg-hover)] transition-all cursor-pointer">
              <div className="w-10 h-10 rounded-xl bg-[var(--bg-hover)] flex items-center justify-center mb-3">
                <f.icon size={18} className="text-[var(--text-2)]" strokeWidth={1.8}/>
              </div>
              <div className="text-base font-semibold">{f.title}</div>
            </button>
          ))}
        </div>
      </section>

      {/* =============== 定价 =============== */}
      <section id="pricing" className="px-4 sm:px-6 py-12 sm:py-20 max-w-6xl mx-auto">
        <div className="text-center mb-8 sm:mb-12">
          <h2 className="text-2xl sm:text-4xl font-bold mb-3">定价</h2>
          <p className="text-sm text-[var(--text-3)]">按需选择, 月卡随时可取消自动续费</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 max-w-4xl mx-auto">
          {PRICING.map(p => (
            <div key={p.tier} className={`relative p-5 sm:p-6 rounded-2xl border-2 flex flex-col gap-3 bg-[var(--bg-card)] ${
              p.highlighted ? 'border-amber-400' : 'border-[var(--border)]'
            }`}>
              {p.badge && (
                <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full bg-amber-400 text-black text-[10px] font-medium">⭐ {p.badge}</div>
              )}
              <div className="text-lg font-semibold">{p.name}</div>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold">{p.price}</span>
                <span className="text-xs text-[var(--text-3)]">{p.period}</span>
              </div>
              <ul className="text-xs text-[var(--text-2)] space-y-1.5 flex-1">
                {p.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <Check size={12} className="text-green-500 mt-0.5 flex-shrink-0"/>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <button onClick={() => nav('/register')}
                className={`mt-2 py-2.5 rounded-xl text-sm font-medium cursor-pointer ${
                  p.highlighted ? 'bg-amber-400 text-black hover:opacity-90' : 'bg-[var(--text)] text-[var(--bg)] hover:opacity-80'
                }`}>
                {p.cta}
              </button>
            </div>
          ))}
        </div>
        <div className="text-center mt-6 text-sm text-[var(--text-3)]">
          工作室 / MCN? 试试 <button onClick={() => nav('/register')} className="text-[var(--text-2)] underline hover:text-[var(--text)] cursor-pointer">旗舰年卡 ¥2980/年</button>
        </div>
      </section>

      {/* =============== FAQ =============== */}
      <section id="faq" className="px-4 sm:px-6 py-12 sm:py-20 max-w-3xl mx-auto">
        <div className="text-center mb-8 sm:mb-12">
          <h2 className="text-2xl sm:text-4xl font-bold mb-3">常见问题</h2>
        </div>
        <div className="flex flex-col gap-2">
          {FAQS.map((f, i) => (
            <div key={i} className="border border-[var(--border)] bg-[var(--bg-card)] rounded-xl overflow-hidden">
              <button onClick={() => setOpenFaq(openFaq === i ? null : i)}
                className="w-full flex items-center justify-between px-5 py-4 text-left cursor-pointer hover:bg-[var(--bg-hover)] transition-colors">
                <span className="text-sm sm:text-base font-medium">{f.q}</span>
                {openFaq === i ? <ChevronUp size={16} className="text-[var(--text-3)] flex-shrink-0"/> : <ChevronDown size={16} className="text-[var(--text-3)] flex-shrink-0"/>}
              </button>
              {openFaq === i && (
                <div className="px-5 pb-4 text-sm text-[var(--text-2)] leading-relaxed">{f.a}</div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* =============== 底部 CTA =============== */}
      <section className="px-4 sm:px-6 py-16 sm:py-24 text-center bg-[var(--text)] text-[var(--bg)] mx-4 sm:mx-6 mb-12 rounded-3xl">
        <h2 className="text-3xl sm:text-5xl font-bold mb-4">现在开始你的第一条视频</h2>
        <p className="text-sm sm:text-base opacity-80 mb-8">新用户 7 天免费 · 每天送 60 积分, 不需要任何视频技能</p>
        <button onClick={() => nav('/register')}
          className="inline-flex items-center gap-2 px-8 py-3.5 bg-[var(--bg)] text-[var(--text)] rounded-xl text-base font-medium hover:opacity-90 cursor-pointer">
          免费开始 <Send size={16}/>
        </button>
      </section>

      {/* =============== Footer =============== */}
      <footer className="border-t border-[var(--border)] px-4 sm:px-6 py-12 max-w-6xl mx-auto">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 sm:gap-8 mb-8">
          <div>
            <div className="text-sm font-semibold mb-3">产品</div>
            <ul className="text-xs text-[var(--text-3)] space-y-1.5">
              <li><a href="#features" className="hover:text-[var(--text-2)]">功能</a></li>
              <li><a href="#pricing" className="hover:text-[var(--text-2)]">定价</a></li>
              <li><a href="#faq" className="hover:text-[var(--text-2)]">FAQ</a></li>
            </ul>
          </div>
          <div>
            <div className="text-sm font-semibold mb-3">资源</div>
            <ul className="text-xs text-[var(--text-3)] space-y-1.5">
              <li>帮助文档 (V2)</li>
              <li>API 文档 (V2)</li>
              <li>教程视频</li>
            </ul>
          </div>
          <div>
            <div className="text-sm font-semibold mb-3">法律</div>
            <ul className="text-xs text-[var(--text-3)] space-y-1.5">
              <li>用户协议</li>
              <li>隐私政策</li>
              <li>ICP 备案 (待补)</li>
            </ul>
          </div>
          <div>
            <div className="text-sm font-semibold mb-3">联系</div>
            <ul className="text-xs text-[var(--text-3)] space-y-1.5">
              <li>微信: monoi-service</li>
              <li>邮箱: hi@monoi.cn</li>
              <li>商务合作</li>
            </ul>
          </div>
        </div>
        <div className="border-t border-[var(--border-subtle)] pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Logo className="w-6 h-6 rounded-lg object-contain"/>
            <span className="text-xs text-[var(--text-3)]">© 2026 monoi · 专为中文创作者</span>
          </div>
          <div className="text-xs text-[var(--text-3)]">
            AI 短视频口播全流程工具
          </div>
        </div>
      </footer>
    </div>
  )
}
