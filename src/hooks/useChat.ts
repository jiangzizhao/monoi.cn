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

const DIALECT_INSTRUCTIONS: Record<string, string> = {
  cantonese: `把下面这段文案改写成地道粤语口播版本。
- 用粤语词汇和语法（嘅、喺、嘢、咗、啱、咁、呢、嗰、唔、係、佢、我哋等）
- 保留原文的核心信息和节奏
- 字数尽量接近原文
- 仍然是自媒体口播风格，每行短句，每行以中文逗号或句号结尾`,
  sichuan: `把下面这段文案改写成地道川渝方言口播版本。
- 用四川/重庆方言词汇（巴适、撒子、要得、嘞、嘛、整、莫、咋个、晓得、给老子、龟儿子等）和语气
- 保留原文的核心信息和节奏
- 字数尽量接近原文
- 自媒体口播风格，每行短句，每行以中文逗号或句号结尾`,
  henan: `把下面这段文案改写成地道河南方言口播版本。
- 用河南话词汇和语气（中、咋、恁、得劲、不老儿、咋弄、弄啥嘞、可、贼、敢、爱兜兜里揣等）
- 保留原文的核心信息和节奏
- 字数尽量接近原文
- 自媒体口播风格，每行短句，每行以中文逗号或句号结尾`,
  northeast: `把下面这段文案改写成地道东北方言口播版本。
- 用东北话词汇和语气（嗯呐、咋地、贼、嘎哈、唠嗑、整、得劲、寻思、家伙、可劲儿等）
- 保留原文的核心信息和节奏
- 字数尽量接近原文
- 自媒体口播风格，每行短句，每行以中文逗号或句号结尾`,
  japanese: `Translate the following script into natural, native-sounding Japanese suitable for short-video voiceover.
- Use casual conversational Japanese (です/ます ok, but lean toward 自然な口語表現)
- Keep the same hook, pacing and information density
- Output Japanese only, no Chinese, no explanations
- Each line should be a short clause ending with 、or 。 (Japanese punctuation)`,
  english: `Translate the following script into natural, native-sounding English suitable for short-video voiceover.
- Conversational, casual tone (not formal/academic)
- Keep the same hook, pacing, and information density
- Output English only, no Chinese, no explanations
- Each line a short clause, comma or period at end`,
  korean: `다음 스크립트를 자연스러운 한국어 숏폼 영상 보이스오버용으로 번역하세요.
- 구어체 (반말 또는 친근한 존댓말) 사용
- 원문의 훅, 리듬, 정보 밀도를 유지
- 한국어만 출력, 중국어 및 설명 금지
- 각 줄은 짧은 문장, 쉼표 또는 마침표로 끝내기`,
}

function buildDialectPrompt(dialect: string, script: string) {
  const instr = DIALECT_INSTRUCTIONS[dialect] || ''
  return `${instr}

【原文】
${script}

【输出要求】
只输出改写后的文案正文，不要任何解释、JSON、代码、标题、标签、前后缀说明。`
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
    if (text.startsWith('__dialect__')) {
      const m = text.match(/^__dialect__(\w+)__/)
      const labelMap: Record<string, string> = {
        cantonese: '粤语', sichuan: '川渝', henan: '河南', northeast: '东北',
        japanese: '日语', english: '英语', korean: '韩语',
      }
      const dialectLabel = m ? (labelMap[m[1]] || m[1]) : '方言'
      displayText = `改写成${dialectLabel}版本`
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

      // 方言改写：基于上一篇文案，让 AI 改写成方言版本
      if (text.startsWith('__dialect__')) {
        const m = text.match(/^__dialect__(\w+)__([\s\S]+)$/)
        if (!m) {
          store.updateLastAssistantBlocks(convId, [{ type: 'error', message: '方言参数错误' }])
          return
        }
        const dialect = m[1]
        const script = m[2]
        const promptForModel = buildDialectPrompt(dialect, script)
        const newScript = await callScriptAI(promptForModel, () => {
          store.updateLastAssistantBlocks(convId, [{ type: 'loading', label: 'AI 正在改写...' }])
        }, ctrl.signal)
        store.updateLastAssistantBlocks(convId, [makeScriptCard(newScript)])
        return
      }

      // 配音合成：从对话中找最新文案，调后端合成 TTS
      if (text.startsWith('__synth_voice__')) {
        const payload = JSON.parse(text.slice('__synth_voice__'.length))
        const script = findLastScript(conv.messages)
        if (!script) {
          store.updateLastAssistantBlocks(convId, [{ type: 'error', message: '请先生成文案再做配音' }])
          return
        }
        store.updateLastAssistantBlocks(convId, [{ type: 'loading', label: '正在提交合成任务...' }])
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
        if (!res.ok) {
          store.updateLastAssistantBlocks(convId, [{ type: 'error', message: data.detail || data.error || '合成失败' }])
          return
        }

        let finalAudioUrl = data.audio_url as string | undefined
        let finalDuration = data.duration_seconds as number | undefined

        // 阿里云长文本是异步任务，需要轮询
        if (data.engine === 'aliyun' && data.task_id) {
          store.updateLastAssistantBlocks(convId, [{ type: 'loading', label: '阿里云正在合成中...' }])
          for (let i = 0; i < 60; i++) {  // 最多等 2 分钟
            await new Promise(r => setTimeout(r, 2000))
            if (ctrl.signal.aborted) return
            const tr = await fetch('/api/proxy?path=' + encodeURIComponent('/api/voice/task/' + data.task_id))
            const td = await tr.json()
            if (td.status === 'ready' && td.audio_url) {
              finalAudioUrl = td.audio_url
              finalDuration = td.duration_seconds
              break
            }
            if (td.status === 'error') {
              store.updateLastAssistantBlocks(convId, [{ type: 'error', message: td.message || '阿里云合成失败' }])
              return
            }
            store.updateLastAssistantBlocks(convId, [{ type: 'loading', label: `阿里云正在合成中...（${(i + 1) * 2}s）` }])
          }
          if (!finalAudioUrl) {
            store.updateLastAssistantBlocks(convId, [{ type: 'error', message: '合成超时，请稍后重试' }])
            return
          }
        }

        if (!finalAudioUrl) {
          store.updateLastAssistantBlocks(convId, [{ type: 'error', message: '合成失败：未返回 audio_url' }])
          return
        }

        store.updateLastAssistantBlocks(convId, [{
          type: 'audio_player',
          data: {
            audio_url: finalAudioUrl,
            duration_seconds: finalDuration,
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
