import { useEffect, useRef } from 'react'
import { useChatStore } from '../../store/chatStore'
import { useChat } from '../../hooks/useChat'
import { WelcomeMessage } from './WelcomeMessage'
import { MessageBubble } from './MessageBubble'
import type { FootageSentenceItem } from '../../types'

export function ChatContainer() {
  const { conversations, activeId, updateFootageGrid, setPipelineState } = useChatStore()
  const { send, chooseOption } = useChat()
  const endRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)   // 是否贴在底部; 初始 true → 进对话/新消息会滚到底

  const conv = conversations.find(c => c.id === activeId)
  const messages = conv?.messages ?? []

  // 用户滚动时实时记录"是否贴底"。关键: 必须在新内容到来【之前】测量 —— 新内容(尤其
  // 素材网格那种高的)会撑高 scrollHeight, 若等渲染后再算, 离底距离会突然变大被误判成
  // "不在底部"而不滚 (这就是之前"新消息来了也不滚、看不到最新"的根因)。
  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 150
  }

  // 切换对话 / 首次进入: 直接回到底部看最新
  useEffect(() => {
    atBottomRef.current = true
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: 'auto' }))
  }, [activeId])

  // 新消息 / 内容更新(含素材网格): 只有用户原本就贴底才自动滚到底; 往上翻看时不打扰。
  useEffect(() => {
    if (atBottomRef.current) endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, messages[messages.length - 1]?.blocks])

  const handleScriptFootage = (script: string) => send(`用上面这篇文案帮我找素材:\n${script}`)
  const handleScriptStoryboard = (script: string) => send(`用上面这篇文案帮我生成剪辑分镜:\n${script}`)
  const handleScriptRegenerate = () => send('重新生成，换一个不同的版本')
  const handleScriptDialect = (script: string, dialect: string) => send(`__dialect__${dialect}__${script}`)
  const handleMultiPlatform = () => send('帮我生成各平台的发布文案')
  const handleFootageUpdate = (msgId: string, blockIdx: number, data: FootageSentenceItem[]) => {
    if (activeId) updateFootageGrid(activeId, msgId, blockIdx, data)
  }
  const handlePipelineStart = (msgId: string, blockIdx: number) => {
    if (!activeId) return
    setPipelineState(activeId, msgId, blockIdx, { started: true })
    // 一个最简单的确认消息让 AI 知道用户同意 → AI 在下一回合输出第一步产物
    send('好, 按上面流程开始第一步')
  }
  const handlePipelineDismiss = (msgId: string, blockIdx: number) => {
    if (!activeId) return
    setPipelineState(activeId, msgId, blockIdx, { dismissed: true })
  }

  return (
    <div className="flex-1 overflow-y-auto" ref={scrollRef} onScroll={handleScroll}>
      <div className="max-w-3xl mx-auto px-4 py-8 flex flex-col gap-6">
        {messages.length === 0 && (
          <WelcomeMessage/>
        )}
        {messages.map(msg => (
          <MessageBubble
            key={msg.id}
            message={msg}
            onChoose={(msgId, blockIdx, opt) => chooseOption(msgId, blockIdx, opt)}
            onScriptRegenerate={handleScriptRegenerate}
            onScriptDialect={handleScriptDialect}
            onScriptFootage={handleScriptFootage}
            onScriptStoryboard={handleScriptStoryboard}
            onStoryboardMultiPlatform={handleMultiPlatform}
            onFootageUpdate={handleFootageUpdate}
            onPipelineStart={handlePipelineStart}
            onPipelineDismiss={handlePipelineDismiss}
          />
        ))}
        <div ref={endRef}/>
      </div>
    </div>
  )
}
