import { Loader2 } from 'lucide-react'
import { ChoiceButtons } from './ChoiceButtons'
import { ScriptCard } from './ScriptCard'
import { FootageGrid } from './FootageGrid'
import { StoryboardTable } from './StoryboardTable'
import { TeleprompterCard } from './TeleprompterCard'
import { PlatformCopyCard } from './PlatformCopyCard'
import { AudioPlayer } from './AudioPlayer'
import { VideoPlayer } from './VideoPlayer'
import type { ChatMessage, MessageBlock, ChoiceOption, FootageSentenceItem } from '../../types'

interface Props {
  message: ChatMessage
  onChoose: (msgId: string, blockIdx: number, opt: ChoiceOption) => void
  onScriptRegenerate?: (msgId: string) => void
  onScriptDialect?: (script: string, dialect: string) => void
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
          onDialect={(d) => props.onScriptDialect?.(block.data.script, d)}
          onFootage={() => props.onScriptFootage?.(block.data.script)}
          onStoryboard={() => props.onScriptStoryboard?.(block.data.script)}
        />
      )

    case 'footage_grid':
      return (
        <FootageGrid
          data={block.data}
          videoUrl={(block as any).video_url}
          segmentTimes={(block as any).segment_times}
          narrationOssKey={(block as any).narration_oss_key}
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

    case 'audio_player':
      return <AudioPlayer data={block.data}/>

    case 'video_player':
      return <VideoPlayer data={block.data}/>

    case 'cover_result': {
      const covers = block.data.covers || []
      return (
        <div className="flex flex-col gap-2">
          <div className="text-xs text-[var(--text-3)]">封面 ({covers.length} 张)</div>
          <div className="grid grid-cols-2 gap-2">
            {covers.map((c, i) => (
              <div key={i} className="flex flex-col gap-1 border border-[var(--border)] rounded-lg p-2">
                <img src={c.url} alt="" className="w-full rounded bg-black max-h-[40vh] object-contain"/>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-[var(--text-3)]">{c.ratio}</span>
                  <a href={c.url} download={`cover-${c.ratio.replace(':', 'x')}.jpg`} target="_blank" rel="noreferrer"
                     className="text-[11px] text-[var(--text)] hover:opacity-80 cursor-pointer">下载</a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )
    }

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

// 裸 sentinel: __xxx_yyy__ 这种用户其实没打过, 是早期 bug 把表单触发 id 当文本发出去的残留
// (修复在 useChat.chooseOption, 这里做渲染兜底, 避免老 chat history 显示 __form_cover__ 这类垃圾)
const SENTINEL_RE = /^__[a-z][a-z0-9_]*__$/i

export function MessageBubble({ message, ...props }: Props) {
  const isUser = message.role === 'user'

  if (isUser) {
    // user 气泡: 跳过纯 sentinel 文本块. 全是 sentinel → 整条消息不渲染
    const visibleBlocks = message.blocks.filter(b => b.type !== 'text' || !SENTINEL_RE.test(b.content.trim()))
    if (visibleBlocks.length === 0) return null
    return (
      <div className="flex justify-end msg-enter">
        <div className="max-w-[85%] sm:max-w-[75%] px-4 py-2.5 rounded-2xl rounded-tr-sm bg-[var(--bg-card)] border border-[var(--border)] text-sm text-[var(--text)]">
          {visibleBlocks.map((b, i) => b.type === 'text' ? <span key={i}>{b.content}</span> : null)}
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-start gap-3 msg-enter">
      <div className="w-8 h-8 rounded-xl bg-[var(--text)] flex items-center justify-center text-[var(--bg)] text-sm font-bold flex-shrink-0 mt-0.5">M</div>
      <div className="flex-1 min-w-0 flex flex-col gap-3">
        {message.blocks.map((block, i) => (
          <Block key={i} block={block} msgId={message.id} blockIdx={i} props={{ message, ...props }}/>
        ))}
      </div>
    </div>
  )
}
