import { useRef, useCallback } from 'react'
import { useChatStore, makeUserMsg, makeAssistantMsg } from '../store/chatStore'
import { callAI, parseBlocks } from '../services/ai'
import { searchPexels } from '../services/pexels'
import { searchPixabay } from '../services/pixabay'
import type { ChoiceOption, FootageSentenceItem, MessageBlock } from '../types'

export function useChat() {
  const store = useChatStore()
  const abortRef = useRef<AbortController | null>(null)

  const ensureConv = useCallback(() => {
    if (store.activeId) return store.activeId
    return store.newConversation()
  }, [store])

  const send = useCallback(async (text: string) => {
    const convId = ensureConv()
    const conv = store.conversations.find(c => c.id === convId)
    if (!conv) return

    // Add user message
    const userMsg = makeUserMsg(text)
    store.addMessage(convId, userMsg)

    // Add placeholder assistant message
    const placeholderMsg = makeAssistantMsg([{ type: 'loading', label: 'AI 正在思考...' }])
    store.addMessage(convId, placeholderMsg)
    store.setGenerating(true)

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    let rawText = ''
    try {
      const messages = [...conv.messages, userMsg]
      await callAI(messages, (chunk) => {
        rawText += chunk
        // 流式阶段只显示加载动画，不展示原始 JSON
        store.updateLastAssistantBlocks(convId, [{ type: 'loading', label: 'AI 正在生成...' }])
      }, ctrl.signal)

      const rawBlocks = parseBlocks(rawText) as any[]
      // Post-process footage_request → fetch real assets
      const processedBlocks: MessageBlock[] = []
      for (const block of rawBlocks) {
        if (block.type === 'footage_request') {
          const sentences: FootageSentenceItem[] = (block.data?.sentences ?? []).map((s: any) => ({
            ...s, assets: [], loadingAssets: true,
          }))
          processedBlocks.push({ type: 'footage_grid', data: sentences })
        } else if (block.type === 'teleprompter_request') {
          processedBlocks.push({ type: 'teleprompter', data: block.data?.text ?? '' })
        } else {
          processedBlocks.push(block as MessageBlock)
        }
      }
      store.updateLastAssistantBlocks(convId, processedBlocks)

      // Fetch footage in background
      const footageIdx = processedBlocks.findIndex(b => b.type === 'footage_grid')
      if (footageIdx >= 0) {
        const gridBlock = processedBlocks[footageIdx] as Extract<MessageBlock, { type: 'footage_grid' }>
        const fetchAll = async () => {
          const updated = [...gridBlock.data]
          for (let i = 0; i < updated.length; i++) {
            const kw = updated[i].search_en[0] || updated[i].search_cn[0] || updated[i].text
            const [p, px] = await Promise.all([searchPexels(kw, 5), searchPixabay(kw, 3)])
            updated[i] = { ...updated[i], assets: [...p, ...px], loadingAssets: false }
            const newBlocks = processedBlocks.map((b, bi) =>
              bi === footageIdx ? { ...b, data: [...updated] } : b
            )
            store.updateLastAssistantBlocks(convId, newBlocks as MessageBlock[])
            await new Promise(r => setTimeout(r, 300))
          }
        }
        fetchAll()
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        store.updateLastAssistantBlocks(convId, [{ type: 'error', message: `出错了：${e.message}` }])
      }
    } finally {
      store.setGenerating(false)
    }
  }, [store, ensureConv])

  const chooseOption = useCallback((msgId: string, blockIdx: number, opt: ChoiceOption) => {
    const convId = store.activeId
    if (!convId) return
    store.chooseOption(convId, msgId, blockIdx, opt.id)
    send(opt.label)
  }, [store, send])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    store.setGenerating(false)
  }, [store])

  return { send, chooseOption, stop }
}
