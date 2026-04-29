import { useNavigate } from 'react-router-dom'
import { FileText, Mic, Video, Film, Scissors, Image, Send, Download, ArrowRight, Sparkles } from 'lucide-react'

const MODULES = [
  { Icon: FileText,  label: '文案',  desc: '原创 / 仿写爆款' },
  { Icon: Mic,       label: '配音',  desc: '预设音色 / 克隆' },
  { Icon: Video,     label: '口播',  desc: '数字人 / AI生成' },
  { Icon: Film,      label: '素材',  desc: '智能匹配视频' },
  { Icon: Scissors,  label: '剪辑',  desc: '小林风格剪辑' },
  { Icon: Image,     label: '封面',  desc: 'AI生成封面图' },
  { Icon: Send,      label: '发布',  desc: '一键多平台' },
  { Icon: Download,  label: '导出',  desc: '高清MP4输出' },
]

export default function Landing() {
  const nav = useNavigate()

  return (
    <div className="min-h-screen bg-[var(--bg)] flex flex-col">
      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-4 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-bold text-sm">M</div>
          <span className="font-semibold text-[var(--text)]">monoi</span>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => nav('/login')}
            className="px-4 py-2 text-sm text-[var(--text-2)] hover:text-[var(--text)] transition-colors cursor-pointer">
            登录
          </button>
          <button onClick={() => nav('/register')}
            className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-colors cursor-pointer">
            免费注册
          </button>
        </div>
      </nav>

      {/* Hero */}
      <div className="flex flex-col items-center justify-center flex-1 px-6 py-24 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-950/60 border border-indigo-800/40 text-indigo-400 text-xs mb-6">
          <Sparkles size={12}/> AI 驱动的口播视频全流程工具
        </div>
        <h1 className="text-5xl font-bold text-[var(--text)] mb-4 leading-tight">
          从文案到成片<br/>
          <span className="text-indigo-500">一站搞定</span>
        </h1>
        <p className="text-lg text-[var(--text-2)] max-w-md mb-10">
          monoi 帮你完成口播视频制作的每一个环节，文案、配音、数字人、素材、剪辑、发布，全流程 AI 辅助。
        </p>
        <div className="flex items-center gap-3">
          <button onClick={() => nav('/register')}
            className="flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-medium transition-colors cursor-pointer">
            免费开始 <ArrowRight size={16}/>
          </button>
          <button onClick={() => nav('/login')}
            className="px-6 py-3 border border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text)] hover:border-indigo-500/50 rounded-xl font-medium transition-colors cursor-pointer">
            已有账号登录
          </button>
        </div>
      </div>

      {/* Modules */}
      <div className="px-8 pb-24">
        <div className="max-w-4xl mx-auto">
          <p className="text-center text-sm text-[var(--text-3)] mb-6">覆盖口播视频制作全流程</p>
          <div className="grid grid-cols-4 gap-3">
            {MODULES.map(({ Icon, label, desc }) => (
              <div key={label}
                className="flex flex-col gap-2 p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border)]">
                <Icon size={18} className="text-indigo-500" strokeWidth={1.8}/>
                <div className="text-sm font-medium text-[var(--text)]">{label}</div>
                <div className="text-xs text-[var(--text-3)]">{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-[var(--border)] px-8 py-4 text-center text-xs text-[var(--text-3)]">
        © 2025 monoi · 专为中文自媒体创作者设计
      </div>
    </div>
  )
}
