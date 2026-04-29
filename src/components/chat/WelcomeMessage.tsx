export function WelcomeMessage() {
  return (
    <div className="flex flex-col items-start gap-4 msg-enter">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-xl bg-[var(--text)] flex items-center justify-center text-[var(--bg)] text-sm font-bold flex-shrink-0 mt-0.5">M</div>
        <div className="flex flex-col gap-1.5 pt-1">
          <p className="text-[var(--text)] leading-relaxed">
            你好！我是 monoi，帮你完成口播视频的全流程制作。
          </p>
          <p className="text-sm text-[var(--text-3)]">
            点击下方图标选择模块，或直接描述你的需求。
          </p>
        </div>
      </div>
    </div>
  )
}
