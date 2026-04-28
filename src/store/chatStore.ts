import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Conversation, ChatMessage, MessageBlock } from '../types'

function newConvId() { return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` }

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
