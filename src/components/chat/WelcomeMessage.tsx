import { FileText, Mic, Video, Film, Scissors, Image, Send, Download } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const MODULES: { id: string; label: string; Icon: LucideIcon; description: string }[] = [
  { id: 'copy',    label: '文案',  Icon: FileText,  description: '原创 / 仿写爆款链接' },
  { id: 'voice',   label: '配音',  Icon: Mic,       description: '预设音色 / 上传 / 克隆' },
  { id: 'talking', label: '口播',  Icon: Video,     description: '自录 / 数字人 / AI生成' },
  { id: 'footage', label: '素材',  Icon: Film,      description: '文案拆词匹配视频素材' },
  { id: 'edit',    label: '剪辑',  Icon: Scissors,  description: '小林风格 · 剪映云渲染' },
  { id: 'cover',   label: '封面',  Icon: Image,     description: 'AI生成封面图' },
  { id: 'publish', label: '发布',  Icon: Send,      description: '一键多平台发布' },
  { id: 'export',  label: '导出',  Icon: Download,  description: '高清 MP4 成片输出' },
]

export function WelcomeMessage({ onModuleClick }: { onModuleClick: (label: string) => void }) {
  return (
    <div className="flex flex-col items-start gap-4 msg-enter">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-xl bg-[var(--text)] flex items-center justify-center text-[var(--bg)] text-sm font-bold flex-shrink-0 mt-0.5">M</div>
        <div className="flex flex-col gap-3">
          <p className="text-[var(--text)] leading-relaxed">
            你好！我是 monoi，帮你完成口播视频的全流程制作。<br/>
            <span className="text-[var(--text-2)]">从哪个环节开始？</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {MODULES.map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => onModuleClick(label)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] hover:border-[var(--text-3)] hover:bg-[var(--bg-hover)] transition-all duration-150 cursor-pointer group"
              >
                <Icon size={13} className="text-[var(--text-3)] group-hover:text-[var(--text)] transition-colors flex-shrink-0" strokeWidth={1.8}/>
                <span className="text-sm text-[var(--text)]">{label}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-[var(--text-3)]">或直接描述你的需求，比如"帮我仿写这个视频的文案"</p>
        </div>
      </div>
    </div>
  )
}
