import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { Conversation, ChatMessage, MessageBlock } from '../types'

// 当前登录用户的 user_id (从 JWT 解出来), 没登录返 'anon'
function getCurrentUserId(): string {
  try {
    const token = localStorage.getItem('monoi_token') || ''
    if (!token) return 'anon'
    const payload = JSON.parse(atob(token.split('.')[1]))
    return String(payload.sub || 'anon')
  } catch {
    return 'anon'
  }
}

// 自定义 localStorage 包装: key 自动加 user_id 后缀, 实现"每个用户独立 chat 历史"
// 例如 vm-chat-store-1 (Tina), vm-chat-store-2 (老k), 切换账号互不污染
const userScopedStorage = {
  getItem: (name: string) => localStorage.getItem(`${name}-${getCurrentUserId()}`),
  setItem: (name: string, value: string) => localStorage.setItem(`${name}-${getCurrentUserId()}`, value),
  removeItem: (name: string) => localStorage.removeItem(`${name}-${getCurrentUserId()}`),
}

function newConvId() { return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown, fallback = Date.now()) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeBlock(block: unknown): MessageBlock | null {
  if (!isRecord(block) || typeof block.type !== 'string') return null

  switch (block.type) {
    case 'text':
      return { type: 'text', content: asString(block.content) }

    case 'choices':
      return {
        type: 'choices',
        question: asString(block.question) || undefined,
        options: Array.isArray(block.options) ? block.options.filter(isRecord).map((opt, idx) => ({
          id: asString(opt.id, `option_${idx}`),
          label: asString(opt.label, '选项'),
          description: asString(opt.description) || undefined,
          icon: asString(opt.icon) || undefined,
        })) : [],
        chosen: asString(block.chosen) || undefined,
      }

    case 'script_card': {
      const data = isRecord(block.data) ? block.data : {}
      const titles = isRecord(data.titles) ? data.titles : {}
      return {
        type: 'script_card',
        data: {
          script: asString(data.script),
          original: asString(data.original) || undefined,
          analysis: asString(data.analysis) || undefined,
          titles: {
            douyin: asString(titles.douyin),
            xiaohongshu: asString(titles.xiaohongshu),
            shipinhao: asString(titles.shipinhao),
          },
          tags: Array.isArray(data.tags) ? data.tags.filter((tag): tag is string => typeof tag === 'string') : [],
        },
      }
    }

    case 'footage_grid':
      return {
        type: 'footage_grid',
        data: Array.isArray(block.data) ? block.data as any : [],
        video_url: asString((block as any).video_url) || undefined,
        segment_times: Array.isArray((block as any).segment_times) ? (block as any).segment_times : undefined,
        narration_oss_key: asString((block as any).narration_oss_key) || undefined,
      }

    case 'cover_result':
      return {
        type: 'cover_result',
        data: { covers: Array.isArray((block.data as any)?.covers) ? (block.data as any).covers : [] },
      }

    case 'storyboard':
      return { type: 'storyboard', data: Array.isArray(block.data) ? block.data as any : [] }

    case 'teleprompter':
      return { type: 'teleprompter', data: asString(block.data) }

    case 'platform_copy':
      return isRecord(block.data) ? { type: 'platform_copy', data: block.data as any } : null

    case 'audio_player': {
      const data = isRecord(block.data) ? block.data : {}
      const url = asString(data.audio_url)
      if (!url) return null
      const src = asString(data.source) as any
      return {
        type: 'audio_player',
        data: {
          audio_url: url,
          duration_seconds: typeof data.duration_seconds === 'number' ? data.duration_seconds : undefined,
          preset_key: asString(data.preset_key) || undefined,
          voice_label: asString(data.voice_label) || undefined,
          text_preview: asString(data.text_preview) || undefined,
          speed: asString(data.speed) || undefined,
          engine: asString(data.engine) || undefined,
          oss_key: asString(data.oss_key) || undefined,
          source: (src === 'voice' || src === 'vocal_removed_bgm') ? src : undefined,
        },
      }
    }

    case 'video_player': {
      const data = isRecord(block.data) ? block.data : {}
      const url = asString(data.video_url)
      if (!url) return null
      // jianying_payload 完整结构由后端 endpoint 校验, 这里只确认是个 object 就保留
      const jp = isRecord(data.jianying_payload) ? data.jianying_payload as any : undefined
      return {
        type: 'video_player',
        data: {
          video_url: url,
          duration_ms: typeof data.duration_ms === 'number' ? data.duration_ms : undefined,
          width: typeof data.width === 'number' ? data.width : undefined,
          height: typeof data.height === 'number' ? data.height : undefined,
          audio_label: asString(data.audio_label) || undefined,
          source: data.source === 'digital_human' || data.source === 'upload' || data.source === 'ai_generated'
            ? data.source
            : undefined,
          text_preview: asString(data.text_preview) || undefined,
          kept_segments: Array.isArray(data.kept_segments) ? data.kept_segments as any : undefined,
          narration_oss_key: asString(data.narration_oss_key) || undefined,
          jianying_payload: jp && Array.isArray(jp.shots) ? jp : undefined,
        },
      }
    }

    case 'loading':
      return { type: 'loading', label: asString(block.label, '处理中...') }

    case 'error':
      return { type: 'error', message: asString(block.message, '发生错误') }

    case 'footage_request': {
      const data = isRecord(block.data) ? block.data : {}
      return { type: 'footage_request', data: { sentences: Array.isArray(data.sentences) ? data.sentences as any : [] } }
    }

    case 'teleprompter_request': {
      const data = isRecord(block.data) ? block.data : {}
      return { type: 'teleprompter_request', data: { text: asString(data.text), max_chars: typeof data.max_chars === 'number' ? data.max_chars : undefined } }
    }

    default:
      return null
  }
}

function normalizeMessage(message: unknown): ChatMessage | null {
  if (!isRecord(message)) return null
  const blocks = Array.isArray(message.blocks) ? message.blocks.map(normalizeBlock).filter((block): block is MessageBlock => !!block) : []
  return {
    id: asString(message.id, `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`),
    role: message.role === 'assistant' ? 'assistant' : 'user',
    blocks,
    timestamp: asNumber(message.timestamp),
  }
}

function normalizePersistedState(persisted: unknown) {
  const state = isRecord(persisted) ? persisted : {}
  const conversations = Array.isArray(state.conversations)
    ? state.conversations.filter(isRecord).map((conv): Conversation => {
      const messages = Array.isArray(conv.messages)
        ? conv.messages.map(normalizeMessage).filter((msg): msg is ChatMessage => !!msg)
        : []
      const id = asString(conv.id, newConvId())
      return {
        id,
        title: asString(conv.title, '新对话'),
        messages,
        createdAt: asNumber(conv.createdAt),
        updatedAt: asNumber(conv.updatedAt),
      }
    })
    : []
  const activeId = conversations.some(conv => conv.id === state.activeId)
    ? state.activeId as string
    : conversations[0]?.id ?? null
  return { conversations, activeId }
}

interface ChatState {
  conversations: Conversation[]
  activeId: string | null
  setActiveId: (id: string) => void
  newConversation: () => string
  deleteConversation: (id: string) => void
  getActive: () => Conversation | undefined

  addMessage: (convId: string, msg: ChatMessage) => void
  updateLastAssistantBlocks: (convId: string, blocks: MessageBlock[]) => void
  chooseOption: (convId: string, msgId: string, blockIndex: number, chosenId: string) => void
  setPipelineState: (convId: string, msgId: string, blockIndex: number, state: { started?: boolean; dismissed?: boolean }) => void
  updateFootageGrid: (convId: string, msgId: string, blockIndex: number, data: import('../types').FootageSentenceItem[]) => void

  isGenerating: boolean
  setGenerating: (v: boolean) => void
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      conversations: [],
      activeId: null,

      setActiveId: (id) => set({ activeId: id }),

      newConversation: () => {
        const id = newConvId()
        const conv: Conversation = { id, title: '新对话', messages: [], createdAt: Date.now(), updatedAt: Date.now() }
        set((s) => ({ conversations: [conv, ...s.conversations], activeId: id }))
        return id
      },

      deleteConversation: (id) =>
        set((s) => {
          const convs = s.conversations.filter((c) => c.id !== id)
          return { conversations: convs, activeId: s.activeId === id ? (convs[0]?.id ?? null) : s.activeId }
        }),

      getActive: () => get().conversations.find((c) => c.id === get().activeId),

      addMessage: (convId, msg) =>
        set((s) => ({
          conversations: s.conversations.map((c) => {
            if (c.id !== convId) return c
            const messages = [...c.messages, msg]
            const firstUser = messages.find((m) => m.role === 'user')
            const title = firstUser
              ? (firstUser.blocks.find((b) => b.type === 'text') as any)?.content?.slice(0, 20) || '新对话'
              : c.title
            return { ...c, messages, title, updatedAt: Date.now() }
          }),
        })),

      updateLastAssistantBlocks: (convId, blocks) =>
        set((s) => ({
          conversations: s.conversations.map((c) => {
            if (c.id !== convId) return c
            const messages = [...c.messages]
            const lastIdx = messages.length - 1
            if (lastIdx >= 0 && messages[lastIdx].role === 'assistant') {
              messages[lastIdx] = { ...messages[lastIdx], blocks }
            }
            return { ...c, messages }
          }),
        })),

      chooseOption: (convId, msgId, blockIndex, chosenId) =>
        set((s) => ({
          conversations: s.conversations.map((c) => {
            if (c.id !== convId) return c
            return {
              ...c,
              messages: c.messages.map((m) => {
                if (m.id !== msgId) return m
                const blocks = m.blocks.map((b, i) => {
                  if (i !== blockIndex || b.type !== 'choices') return b
                  return { ...b, chosen: chosenId }
                })
                return { ...m, blocks }
              }),
            }
          }),
        })),

      setPipelineState: (convId, msgId, blockIndex, state) =>
        set((s) => ({
          conversations: s.conversations.map((c) => {
            if (c.id !== convId) return c
            return {
              ...c,
              messages: c.messages.map((m) => {
                if (m.id !== msgId) return m
                const blocks = m.blocks.map((b, i) => {
                  if (i !== blockIndex || b.type !== 'pipeline_intro') return b
                  return { ...b, ...state }
                })
                return { ...m, blocks }
              }),
            }
          }),
        })),

      updateFootageGrid: (convId, msgId, blockIndex, data) =>
        set((s) => ({
          conversations: s.conversations.map((c) => {
            if (c.id !== convId) return c
            return {
              ...c,
              messages: c.messages.map((m) => {
                if (m.id !== msgId) return m
                const blocks = m.blocks.map((b, i) => {
                  if (i !== blockIndex || b.type !== 'footage_grid') return b
                  return { ...b, data }
                })
                return { ...m, blocks }
              }),
            }
          }),
        })),

      isGenerating: false,
      setGenerating: (v) => set({ isGenerating: v }),
    }),
    {
      name: 'vm-chat-store',
      storage: createJSONStorage(() => userScopedStorage),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...normalizePersistedState(persistedState),
      }),
      partialize: (s) => ({ conversations: s.conversations, activeId: s.activeId }),
    }
  )
)

export function makeUserMsg(text: string): ChatMessage {
  return { id: `msg_${Date.now()}`, role: 'user', blocks: [{ type: 'text', content: text }], timestamp: Date.now() }
}
export function makeAssistantMsg(blocks: MessageBlock[]): ChatMessage {
  return { id: `msg_${Date.now()}`, role: 'assistant', blocks, timestamp: Date.now() }
}
