import { useEffect, useRef } from 'react'
import { useChatStore } from '../../store/chatStore'
import { useChat } from '../../hooks/useChat'
import { WelcomeMessage } from './WelcomeMessage'
import { MessageBubble } from './MessageBubble'
import type { FootageSentenceItem } from '../../types'

export function ChatContainer() {
  const { conversations, activeId, updateFootageGrid } = useChatStore()
  const { send, chooseOption } = useChat()
  const endRef = useRef<HTMLDivElement>(null)

  const conv = conversations.find(c => c.id === activeId)
  const messages = conv?.messages ?? []

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, messages[messages.length - 1]?.blocks])

  const handleScriptFootage = (script: string) => send(`用上面这篇文案帮我找素材:\n${script}`)
  const handleScriptStoryboard = (script: string) => send(`用上面这篇文案帮我生成剪辑分镜:\n${script}`)
  const handleScriptRegenerate = () => send('重新生成，换一个不同的版本')
  const handleMultiPlatform = () => send('帮我生成各平台的发布文案')
  const handleFootageUpdate = (msgId: string, blockIdx: number, data: FootageSentenceItem[]) => {
    if (activeId) updateFootageGrid(activeId, msgId, blockIdx, data)
  }

  return (
    <div className="flex-1 overflow-y-auto">
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
            onScriptFootage={handleScriptFootage}
            onScriptStoryboard={handleScriptStoryboard}
            onStoryboardMultiPlatform={handleMultiPlatform}
            onFootageUpdate={handleFootageUpdate}
          />
        ))}
        <div ref={endRef}/>
      </div>
    </div>
  )
}
