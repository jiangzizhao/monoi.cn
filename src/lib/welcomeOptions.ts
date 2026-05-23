// 共享菜单 — WelcomeMessage (新对话首屏) + useChat (用户打"你好"等问候时) 都用这份.
// 改一次, 两处同步.

export interface WelcomeOption {
  id: string
  label: string
  desc: string
}

export const WELCOME_OPTIONS: WelcomeOption[] = [
  { id: '__form_original__',   label: '原创文案',   desc: '按平台/风格生成专属文案' },
  { id: '__form_rewrite__',    label: '仿写文案',   desc: '基于原文改写, 降重优化' },
  { id: '__form_paste__',      label: '我有现成文案', desc: '直接粘贴文案继续后面流程' },
  { id: '__voice_preset__',    label: '配音',       desc: '用预设音色或克隆声音' },
  { id: '__narration_video__', label: '口播剪辑',   desc: '上传自录视频进行词级修剪' },
  { id: '__digital_human__',   label: '数字人',     desc: '上传形象生成对口型视频' },
  { id: '__form_footage__',    label: '素材匹配',   desc: '按文案自动搜索视频片段' },
  { id: '__form_cover__',      label: '封面生成',   desc: '自动生成各平台封面' },
  { id: '__form_cutout__',     label: '人物抠图',   desc: 'AI 抠去背景, 透明 PNG 可下载' },
  { id: '__form_publish__',    label: '自动发布',   desc: '一键发布到小红书 / 抖音' },
]

// 用户打这些词都当成"打招呼" / "求介绍", 前端直接给菜单, 不走 AI (DeepSeek 对这种短句经常抽风返空)
const GREETING_PATTERNS = [
  '你好', '您好', '嗨', 'hi', 'hello', '在吗', '在不在', '在么',
  '你能干什么', '你能做什么', '你能帮我什么', '帮我做什么', '能做什么', '能帮我什么',
  '介绍', '介绍一下', '介绍下', '怎么用', '怎么开始', '从哪开始', '从哪里开始',
  '有什么功能', '功能有哪些', '都有什么', '都能做啥',
  '?', '？',  // 单纯一个问号也兜进来 — 没说啥, 给个引导
]

export function isGreetingOrHelp(text: string): boolean {
  const t = text.trim().toLowerCase()
  if (!t || t.length > 20) return false  // 太长的不算, 多半是真问题
  if (t.startsWith('__') || t.startsWith('【')) return false  // sentinel 跳过
  return GREETING_PATTERNS.some(p => t === p.toLowerCase() || t.includes(p.toLowerCase()))
}
