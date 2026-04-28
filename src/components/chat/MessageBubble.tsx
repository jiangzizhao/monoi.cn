import { Loader2 } from 'lucide-react'
import { ChoiceButtons } from './ChoiceButtons'
import { ScriptCard } from './ScriptCard'
import { FootageGrid } from './FootageGrid'
import { StoryboardTable } from './StoryboardTable'
import { TeleprompterCard } from './TeleprompterCard'
import { PlatformCopyCard } from './PlatformCopyCard'
import type { ChatMessage, MessageBlock, ChoiceOption, FootageSentenceItem } from '../../types'

interface Props {
  message: ChatMessage
  onChoose: (msgId: string, blockIdx: number, opt: ChoiceOption) => void
  onScriptRegenerate?: (msgId: string) => void
  onScriptFootage?: (script: string) => void
  onScriptStoryboard?: (script: string) => void
  onStoryboardMultiPlatform?: (msgId: string) => void
  onFootageUpdate?: (msgId: string, blockIdx: number, data: FootageSentenceItem[]) => void
}

function StreamText({ content, streaming }: { content: string; streaming?: boolean }) {
  return (
    <span className="whitespace-pre-wrap leading-relaxed">
      {content}
      {streaming && <span className="cursor-blink"/>}
    </span>
  )
}

function Block({ block, msgId, blockIdx, props }: { block: MessageBlock; msgId: string; blockIdx: number; props: Props }) {
  switch (block.type) {
    case 'text':
      return <StreamText content={block.content} streaming={block.streaming}/>

    case 'choices':
      return (
        <ChoiceButtons
          question={block.question}
          options={block.options}
          chosen={block.chosen}
          onChoose={opt => props.onChoose(msgId, blockIdx, opt)}
        />
      )

    case 'script_card':
      return (
        <ScriptCard
          data={block.data}
          onRegenerate={() => props.onScriptRegenerate?.(msgId)}
          onFootage={() => props.onScriptFootage?.(block.data.script)}
          onStoryboard={() => props.onScriptStoryboard?.(block.data.script)}
        />
      )

    case 'footage_grid':
      return (
        <FootageGrid
          data={block.data}
          msgId={msgId}
          blockIndex={blockIdx}
          onUpdate={d => props.onFootageUpdate?.(msgId, blockIdx, d)}
        />
      )

    case 'storyboard':
      return (
        <StoryboardTable
          data={block.data}
          onMultiPlatform={() => props.onStoryboardMultiPlatform?.(msgId)}
        />
      )

    case 'teleprompter':
      return <TeleprompterCard rawText={block.data}/>

    case 'platform_copy':
      return <PlatformCopyCard data={block.data}/>

    case 'loading':
      return (
        <div className="flex items-center gap-2 text-sm text-[var(--text-2)]">
          <Loader2 size={14} className="animate-spin"/>
          {block.label}
        </div>
      )

    case 'error':
      return (
        <div className="text-sm text-red-400 bg-red-950/20 border border-red-900/30 rounded-lg px-3 py-2">
          {block.message}
        </div>
      )

    default:
      return null
  }
}

export function MessageBubble({ message, ...props }: Props) {
  const isUser = message.role === 'user'

  if (isUser) {
    return (
      <div className="flex justify-end msg-enter">
        <div className="max-w-[75%] px-4 py-2.5 rounded-2xl rounded-tr-sm bg-indigo-600/20 border border-indigo-500/20 text-sm text-[var(--text)]">
          {message.blocks.map((b, i) => b.type === 'text' ? <span key={i}>{b.content}</span> : null)}
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-start gap-3 msg-enter">
      <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0 mt-0.5">V</div>
      <div className="flex-1 min-w-0 flex flex-col gap-3">
        {message.blocks.map((block, i) => (
          <Block key={i} block={block} msgId={message.id} blockIdx={i} props={{ message, ...props }}/>
        ))}
      </div>
    </div>
  )
}
