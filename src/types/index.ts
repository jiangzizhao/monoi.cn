export interface ChoiceOption {
  id: string
  label: string
  description?: string
  icon?: string
}

export interface ScriptResult {
  script: string
  original?: string  // 仿写时的原文
  analysis?: string
  titles: { douyin: string; xiaohongshu: string; shipinhao: string }
  tags: string[]
}

export interface FootageSentenceItem {
  text: string
  scene: string
  search_en: string[]
  search_cn: string[]
  duration: number
  assets?: VideoAsset[]
  loadingAssets?: boolean
  editingKeyword?: boolean
  customKeyword?: string
}

export interface VideoAsset {
  id: number | string
  thumbnail: string
  preview_url?: string
  source_url: string
  source: 'pexels' | 'pixabay'
  duration: number
  selected?: boolean
}

export interface StoryboardRowItem {
  id: string
  time: string
  visual: string
  subtitle: string
  effect: string
  note?: string
}

export interface PlatformCopyResult {
  douyin:      { title: string; description: string; tags: string[] }
  xiaohongshu: { title: string; body: string; tags: string[] }
  shipinhao:   { title: string; description: string }
  bilibili:    { title: string; description: string; tags: string[] }
  cover?:      { main_title: string; subtitle: string; color_suggestion: string }
}

export type MessageBlock =
  | { type: 'text';           content: string; streaming?: boolean }
  | { type: 'choices';        question?: string; options: ChoiceOption[]; chosen?: string }
  | { type: 'script_card';    data: ScriptResult }
  | { type: 'footage_grid';   data: FootageSentenceItem[] }
  | { type: 'storyboard';     data: StoryboardRowItem[] }
  | { type: 'teleprompter';   data: string }
  | { type: 'platform_copy';  data: PlatformCopyResult }
  | { type: 'loading';             label: string }
  | { type: 'error';               message: string }
  | { type: 'footage_request';     data: { sentences: FootageSentenceItem[] } }
  | { type: 'teleprompter_request';data: { text: string; max_chars?: number } }

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  blocks: MessageBlock[]
  timestamp: number
}

export interface Conversation {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}
