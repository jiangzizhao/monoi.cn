// 新对话首屏 — 之前只有一句问候, 用户得等 AI 回复才看到选项, 而且 AI 偶尔
// 不输出完整 9 项菜单. 现在把菜单写死前端 -> 100% 稳定显示.
//
// 每项点击直接 dispatch monoi:open-form 事件 -> ChatInput 收到打开对应弹窗,
// 跟 chat 里的 chip 选项走同一条路.

const OPTIONS = [
  { id: '__form_original__',  label: '原创文案',  desc: '按平台/风格生成专属文案' },
  { id: '__form_rewrite__',   label: '仿写文案',  desc: '基于原文改写, 降重优化' },
  { id: '__form_paste__',     label: '我有现成文案', desc: '直接粘贴文案继续后面流程' },
  { id: '__voice_preset__',   label: '配音',      desc: '用预设音色或克隆声音' },
  { id: '__narration_video__', label: '口播剪辑', desc: '上传自录视频进行词级修剪' },
  { id: '__digital_human__',  label: '数字人',    desc: '上传形象生成对口型视频' },
  { id: '__form_footage__',   label: '素材匹配',  desc: '按文案自动搜索视频片段' },
  { id: '__form_cover__',     label: '封面生成',  desc: '自动生成各平台封面' },
  { id: '__form_cutout__',    label: '人物抠图',  desc: 'AI 抠去背景, 透明 PNG 可下载' },
  { id: '__form_publish__',   label: '自动发布',  desc: '一键发布到小红书 / 抖音' },
]

export function WelcomeMessage() {
  const pick = (id: string) => {
    window.dispatchEvent(new CustomEvent('monoi:open-form', { detail: id }))
  }
  return (
    <div className="flex items-start gap-3 msg-enter">
      <img src="/logo.png" alt="monoi" className="w-8 h-8 rounded-xl object-contain flex-shrink-0 mt-0.5"/>
      <div className="flex-1 min-w-0 flex flex-col gap-4 pt-1">
        <div className="flex flex-col gap-1.5">
          <p className="text-[var(--text)] leading-relaxed">
            你好! 我是 monoi, 你的视频口播创作助手. 我能帮你完成从文案到发布的全流程. 你想从哪里开始?
          </p>
          <p className="text-sm text-[var(--text-3)]">选一个方向, 我带你走:</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {OPTIONS.map(opt => (
            <button
              key={opt.id}
              onClick={() => pick(opt.id)}
              className="text-left px-3.5 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--text-3)] hover:bg-[var(--bg-hover)] transition-all cursor-pointer"
            >
              <div className="text-sm font-medium text-[var(--text)] leading-tight">{opt.label}</div>
              <div className="text-xs text-[var(--text-3)] mt-0.5 leading-tight">{opt.desc}</div>
            </button>
          ))}
        </div>
        <p className="text-xs text-[var(--text-3)]">
          也可以直接在下方输入框描述你的需求, 或点底部图标选模块.
        </p>
      </div>
    </div>
  )
}
