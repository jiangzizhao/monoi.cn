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
  source: 'pexels' | 'pixabay' | 'upload' | 'mine'   // upload = 临时自传; mine = 个人素材库
  duration: number
  selected?: boolean
  oss_key?: string                          // upload/mine 类型必有, 后端用这个从 OSS 拉
  media_type?: 'image' | 'video'            // mine 素材区分图片/视频 (合成时图片转静帧片段)
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

export interface AudioResult {
  audio_url: string
  duration_seconds?: number
  preset_key?: string
  voice_label?: string
  text_preview?: string
  speed?: string
  engine?: string
  // V2: 去人声 BGM 接入 (TimelinePreview 能从历史选)
  oss_key?: string                          // 后端原 OSS key, 给 /compose-footage 用作 bgm_oss_key
  source?: 'voice' | 'vocal_removed_bgm'    // 'vocal_removed_bgm' = 这是去人声生成的 BGM, BGM 选择器扫这种
}

export interface KeptSegmentLite {
  start: number
  end: number
  text: string
  words?: { start: number; end: number; word: string }[]
}

export interface JianyingDraftPayload {
  narration_oss_key: string
  output_ratio: string                       // '9:16' / '16:9' / '3:4' / '1:1'
  shots: {
    start: number
    end: number
    text: string                              // 该镜对应字幕
    assets: { url: string; oss_key?: string; duration: number }[]
  }[]
}

export interface VideoResult {
  video_url: string         // 完整 URL 或形如 /api/digital-human/video/xxx
  duration_ms?: number
  width?: number
  height?: number
  audio_label?: string      // 用了什么音频(如"莫小本 1.0x")
  source?: 'digital_human' | 'upload' | 'ai_generated'
  text_preview?: string
  kept_segments?: KeptSegmentLite[]   // 剪辑后视频的 segments (口播视频专用, 用于自动匹配素材)
  narration_oss_key?: string          // 剪辑后口播视频的 OSS key (合成时后端用)
  narration_clean?: any               // 口播剪辑的原始清洗数据 (CleanResponse), 给结果卡"重新剪辑"复用
  jianying_payload?: JianyingDraftPayload  // 有此字段 → VideoPlayer 显示"导出剪映草稿"按钮
}

export interface PipelineStep {
  label: string     // 步骤名, 如 "写文案"
  desc: string      // 短描述, 不带积分数字
}

export type MessageBlock =
  | { type: 'text';           content: string; streaming?: boolean }
  | { type: 'choices';        question?: string; options: ChoiceOption[]; chosen?: string }
  | { type: 'script_card';    data: ScriptResult }
  | { type: 'footage_grid';   data: FootageSentenceItem[]; video_url?: string; segment_times?: { start: number; end: number }[]; narration_oss_key?: string }
  | { type: 'storyboard';     data: StoryboardRowItem[] }
  | { type: 'teleprompter';   data: string }
  | { type: 'platform_copy';  data: PlatformCopyResult }
  | { type: 'audio_player';   data: AudioResult }
  | { type: 'video_player';   data: VideoResult }
  | { type: 'loading';             label: string }
  | { type: 'error';               message: string }
  | { type: 'footage_request';     data: { sentences: FootageSentenceItem[] } }
  | { type: 'teleprompter_request';data: { text: string; max_chars?: number } }
  | { type: 'cover_result';        data: { covers: { ratio: string; url: string }[] } }
  | { type: 'pipeline_intro';      data: { steps: PipelineStep[] }; started?: boolean; dismissed?: boolean }

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
