import { useRef, useCallback } from 'react'
import { useChatStore, makeUserMsg, makeAssistantMsg } from '../store/chatStore'
import { callAI, callScriptAI, isScriptPrompt, parseBlocks } from '../services/ai'
import { searchPexels } from '../services/pexels'
import { searchPixabay } from '../services/pixabay'
import type { ChoiceOption, FootageSentenceItem, MessageBlock } from '../types'

function findLastScriptPrompt(messages: { role: string; blocks: MessageBlock[] }[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== 'user') continue
    const text = msg.blocks.find((block) => block.type === 'text')?.content
    if (text && isScriptPrompt(text)) return text
  }
  return null
}

function findLastScript(messages: { role: string; blocks: MessageBlock[] }[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== 'assistant') continue
    const card = msg.blocks.find((block) => block.type === 'script_card') as any
    if (card?.data?.script) return card.data.script as string
  }
  return null
}

function makeScriptCard(script: string): MessageBlock {
  return {
    type: 'script_card',
    data: {
      script,
      original: '',
      analysis: '',
      titles: { douyin: '', xiaohongshu: '', shipinhao: '' },
      tags: [],
    },
  }
}

function buildRegenerateScriptPrompt(prompt: string) {
  return `${prompt}

【重新生成要求】
沿用上面同样的平台、风格、字数、行业、目标用户或参考原文，只重新生成一版不同表达的文案。
要求开头不同、案例细节不同、句式不同，但不要改变原本的创作方向。
仍然只输出最终文案正文，不要输出解释、JSON、代码或标题标签。`
}

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

    // 配音合成：用户可见消息显示友好标签，而不是原始 payload
    let displayText = text
    if (text.startsWith('__synth_voice__')) {
      try {
        const p = JSON.parse(text.slice('__synth_voice__'.length))
        displayText = `配音：${p.voice_label || p.voice_id}（${p.speed}）`
      } catch { /* keep raw */ }
    }

    // Add user message
    const userMsg = makeUserMsg(displayText)
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

      // 配音合成：从对话中找最新文案，调后端合成 TTS
      if (text.startsWith('__synth_voice__')) {
        const payload = JSON.parse(text.slice('__synth_voice__'.length))
        const script = findLastScript(conv.messages)
        if (!script) {
          store.updateLastAssistantBlocks(convId, [{ type: 'error', message: '请先生成文案再做配音' }])
          return
        }
        store.updateLastAssistantBlocks(convId, [{ type: 'loading', label: '正在合成音频...' }])
        const res = await fetch('/api/proxy?path=' + encodeURIComponent('/api/voice/synthesize'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: script,
            preset_key: payload.voice_id,
            speed: payload.speed,
            emotion: payload.emotion,
          }),
          signal: ctrl.signal,
        })
        const data = await res.json()
        if (!res.ok || !data.audio_url) {
          store.updateLastAssistantBlocks(convId, [{ type: 'error', message: data.detail || data.error || '合成失败' }])
          return
        }
        store.updateLastAssistantBlocks(convId, [{
          type: 'audio_player',
          data: {
            audio_url: data.audio_url,
            duration_seconds: data.duration_seconds,
            preset_key: payload.voice_id,
            voice_label: payload.voice_label,
            speed: payload.speed,
            engine: data.engine,
            text_preview: script.slice(0, 80),
          },
        }])
        return
      }

      const isRegenerateScript = text.startsWith('重新生成')
      const scriptPrompt = isScriptPrompt(text)
        ? text
        : isRegenerateScript
          ? findLastScriptPrompt(conv.messages)
          : null

      if (scriptPrompt) {
        const promptForModel = isRegenerateScript ? buildRegenerateScriptPrompt(scriptPrompt) : scriptPrompt
        const script = await callScriptAI(promptForModel, (chunk) => {
          rawText += chunk
          store.updateLastAssistantBlocks(convId, [{ type: 'loading', label: 'AI 正在生成文案...' }])
        }, ctrl.signal)
        store.updateLastAssistantBlocks(convId, [makeScriptCard(script)])
        return
      }

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
