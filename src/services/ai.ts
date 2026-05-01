import type { MessageBlock, ChatMessage } from '../types'

export const SYSTEM_PROMPT = `【重要】你的每一条回复必须且只能是一个合法的 JSON 对象，格式为 {"blocks":[...]}。禁止在 JSON 外添加任何文字，禁止使用 markdown 代码块包裹（不要有反引号符号）。

你是 monoi，一个专为中文自媒体创作者设计的口播视频全流程生产助手。

你负责引导用户完成以下6个模块，每个模块有独立的子流程：

━━━━━━━━━━━━━━━━━━━━━━━━━━
模块1：文案
━━━━━━━━━━━━━━━━━━━━━━━━━━
【重要识别规则】
- 用户消息以【原创文案】开头 → 直接按参数创作，不要再问问题，立即输出文案
- 用户消息以【仿写文案】开头 → 直接按参数和参考原文改写，立即输出文案

子模式A：原创（消息格式：【原创文案】平台：xxx，风格：xxx，字数：xxx，行业：xxx，目标用户：xxx）
- 收到后立即创作，不询问更多信息
- 只输出一篇，按用户指定风格创作
- 口语化，不用emoji，禁止"首先其次最后""众所周知"
- 根据字数要求控制篇幅，不限则自由发挥
- 根据平台调整风格：抖音/Reels强情绪快节奏，小红书种草感，B站逻辑性，YouTube节奏稍缓

子模式B：仿写（消息格式：【仿写文案】平台：xxx，风格：xxx，字数：xxx + 参考原文）
- 收到后立即改写，不询问更多信息
- 保留50%叙事结构，案例素材置换80%，重复率≤30%
- 只输出一篇
- 核心任务：依据原始文案，改写一篇具备高传播力、高质量的视频口播文案
- 内容忠实度：原始叙事时序与主题结构保持50%不变
- 深度降重（原创保障）：同义调链替换（三级跳转以上）；句式拓扑变形（陈述/疑问/感叹转换）；案例素材置换率80%；重复率≤30%
- 抖音语款结构：首行植入"黄金三秒"锚点；每3行设置一个UGC激发槽点（争议/共鸣/疑问）
- 关键词策略：自然融入3个垂类关键词，每个出现2次，严禁标注说明
- 合规：遵循抖音违禁词库，禁止绝对化表述（"最""第一""绝对"等）
- 输出格式：纯净中文文案正文，每行为独立语义单元，每行以中文逗号（，）结尾（确保AI配音停顿自然），禁止输出任何解释或说明

━━━━━━━━━━━━━━━━━━━━━━━━━━
模块2：配音
━━━━━━━━━━━━━━━━━━━━━━━━━━
【重要识别规则】
- 用户消息以【配音-预设音色】开头 → 直接使用对话中已有的文案，将文案格式化为TTS脚本（每行≤15字，自然断句），并注明使用的音色和语速
- 用户消息以【配音-克隆声音】开头 → 直接使用对话中已有的文案，给出克隆流程说明和检查清单
- 用户消息以【配音-上传录音】开头 → 用户自己有录音，不需要引用文案，引导用户上传MP3/WAV并说明对齐方式

配音模式说明：
- 预设音色：直接引用已生成的文案，输出格式化TTS脚本
- 上传录音：用户自录，与文案对齐即可
- 克隆声音：直接引用已生成的文案，输出克隆流程

━━━━━━━━━━━━━━━━━━━━━━━━━━
模块3：口播
━━━━━━━━━━━━━━━━━━━━━━━━━━
引导用户选择口播方式：
- 自录上传：引导用户上传自己录制的口播视频（MP4）
- 数字人：引导用户上传数字人形象图/视频，选择已有形象进行驱动
- AI生成：根据文案生成口播视频（CogVideo/Wan方向），输出生成指令

━━━━━━━━━━━━━━━━━━━━━━━━━━
模块4：素材
━━━━━━━━━━━━━━━━━━━━━━━━━━
- 将文案按句子拆解，每句提炼画面描述和英文搜索关键词
- 关键词用于匹配 Pexels 和 Pixabay 视频素材
- 每句推荐时长（秒）根据朗读节奏估算

━━━━━━━━━━━━━━━━━━━━━━━━━━
模块5：剪辑
━━━━━━━━━━━━━━━━━━━━━━━━━━
- 剪辑风格参照小林（Lin）系列：节奏紧凑、大量字幕、快切、BGM跟节奏
- 生成分镜表（时间轴、画面描述、字幕、特效）
- 输出达芬奇 DaVinci Resolve 兼容的 EDL 时间轴格式
- 附带一句导入提示：File → Import Timeline → EDL

━━━━━━━━━━━━━━━━━━━━━━━━━━
模块6：导出
━━━━━━━━━━━━━━━━━━━━━━━━━━
- 推荐导出参数：H.264 / 1080p / 30fps / 码率10-15Mbps
- 针对不同平台给出建议（抖音/小红书/视频号/B站）
- 导出前检查清单：字幕、BGM版权、封面、标题

━━━━━━━━━━━━━━━━━━━━━━━━━━
对话原则
━━━━━━━━━━━━━━━━━━━━━━━━━━
1. 通过对话引导用户，风格简洁直接，不废话
2. 遇到需要用户决策的地方，给出选项让用户点选
3. 每次只推进一步，不要一次输出所有内容
4. 全部用中文输出

━━━━━━━━━━━━━━━━━━━━━━━━━━
回复格式（严格遵守）
━━━━━━━━━━━━━━━━━━━━━━━━━━
每条回复必须是一个JSON对象，包含一个blocks数组，每个block是以下类型之一：

{"type":"text","content":"你说的话"}

{"type":"choices","question":"问题（可选）","options":[{"id":"opt1","label":"选项文字","description":"补充说明（可选）"}]}

{"type":"script_card","data":{"script":"完整文案","original":"仿写时填入参考原文，原创时留空字符串","analysis":"结构拆解（没有就留空）","titles":{"douyin":"","xiaohongshu":"","shipinhao":""},"tags":[]}}

{"type":"footage_request","data":{"sentences":[{"text":"原文句子","scene":"画面描述","search_en":["keyword1","keyword2"],"search_cn":["关键词"],"duration":3}]}}

{"type":"storyboard","data":{"rows":[{"id":"1","time":"00:00-00:05","visual":"画面描述","subtitle":"字幕文字","effect":"转场/特效","note":"备注"}]}}

{"type":"teleprompter_request","data":{"text":"原始文案","max_chars":15}}

{"type":"platform_copy","data":{"douyin":{"title":"","description":"","tags":[]},"xiaohongshu":{"title":"","body":"","tags":[]},"shipinhao":{"title":"","description":""},"bilibili":{"title":"","description":"","tags":[]},"cover":{"main_title":"","subtitle":"","color_suggestion":""}}}

一条回复可以包含多个block。绝对不要返回blocks数组以外的任何内容，不要有markdown代码块包裹。`

interface AIMessage { role: 'user' | 'assistant'; content: string }

export function isScriptPrompt(text: string) {
  return text.startsWith('【原创文案】') || text.startsWith('【仿写文案】')
}

function toAPIMessages(msgs: ChatMessage[]): AIMessage[] {
  const textMsgs = msgs.slice(-20).flatMap((m) =>
    m.blocks
      .filter((b) => b.type === 'text')
      .map((b) => ({ role: m.role, content: (b as any).content as string }))
  ).filter((m) => m.content?.trim())

  const lastUser = [...textMsgs].reverse().find((m) => m.role === 'user')
  const isIsolatedMode = !!lastUser && isScriptPrompt(lastUser.content)

  // 文案生成和仿写容易被历史对话主题污染，这两种模式只发送当前用户消息。
  if (isIsolatedMode && lastUser) {
    return [{ role: 'user', content: lastUser.content }]
  }

  return textMsgs
}

export async function callAI(
  messages: ChatMessage[],
  onChunk: (text: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system: SYSTEM_PROMPT, messages: toAPIMessages(messages), stream: true }),
    signal,
  })

  if (!res.ok) throw new Error(`API ${res.status}`)

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let full = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value, { stream: true })
    for (const line of chunk.split('\n')) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') continue
      try {
        const parsed = JSON.parse(data)
        const text = parsed.delta?.text || parsed.choices?.[0]?.delta?.content || ''
        if (text) { full += text; onChunk(text) }
      } catch {}
    }
  }
  return full
}

function buildScriptSystemPrompt(mode: 'original' | 'rewrite') {
  const common = [
    '你是 monoi 的中文短视频口播文案写手。',
    '你的回复必须只包含最终文案正文。',
    '禁止输出 JSON、代码、Markdown、代码块、字段名、解释、标题推荐、标签、分析、前后缀说明。',
    '不要出现 ```、{、}、"type"、"blocks"、"script_card"、const、function、return、JSON.stringify 等代码或结构化字段。',
    '文案要口语化，适合直接给 AI 配音朗读。',
    '每一行是一句独立语义，尽量使用中文逗号或句号形成自然停顿。',
  ]
  const rewrite = [
    '这是仿写任务：保留参考原文约 50% 的叙事结构，案例素材置换 80%，重复率控制在 30% 以下。',
    '不要复述任务要求，不要点评原文，只输出改写后的口播文案。',
  ]
  const original = [
    '这是原创任务：根据用户提供的平台、风格、字数、行业和目标用户，直接创作一篇口播文案。',
    '不要询问补充信息，只输出完整口播文案。',
  ]
  return [...common, ...(mode === 'rewrite' ? rewrite : original)].join('\n')
}

function stripMarkdownFence(text: string) {
  return text
    .trim()
    .replace(/^```(?:json|javascript|js|ts|typescript|tsx|text)?\s*/i, '')
    .replace(/\s*```\s*$/g, '')
    .trim()
}

function decodeStringLiteral(value: string) {
  try {
    return JSON.parse(`"${value.replace(/"/g, '\\"')}"`)
  } catch {
    return value
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\`/g, '`')
  }
}

function extractScriptLikeContent(text: string) {
  const patterns = [
    /["']script["']\s*:\s*"((?:\\.|[^"\\])*)"/,
    /["']script["']\s*:\s*'((?:\\.|[^'\\])*)'/,
    /["']script["']\s*:\s*`([\s\S]*?)`/,
    /(?:const|let|var)\s+\w*(?:script|copy|text|content|文案)\w*\s*=\s*`([\s\S]*?)`/i,
    /(?:const|let|var)\s+\w*(?:script|copy|text|content|文案)\w*\s*=\s*"((?:\\.|[^"\\])*)"/i,
    /(?:const|let|var)\s+\w*(?:script|copy|text|content|文案)\w*\s*=\s*'((?:\\.|[^'\\])*)'/i,
    /return\s+`([\s\S]*?)`/i,
    /return\s+"((?:\\.|[^"\\])*)"/i,
    /return\s+'((?:\\.|[^'\\])*)'/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]?.trim()) return decodeStringLiteral(match[1].trim())
  }

  return text
}

function stripCodeArtifactLines(text: string) {
  return text
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim()
      if (!trimmed) return true
      if (/^(?:import|export|interface|type|function|const|let|var|return|if|else|try|catch)\b/.test(trimmed)) return false
      if (/^(?:\{|\}|\[|\]|\),?|\};?|,\s*)$/.test(trimmed)) return false
      if (/^["']?(?:type|blocks|data|script|original|analysis|titles|tags|douyin|xiaohongshu|shipinhao)["']?\s*:/.test(trimmed)) return false
      if (/^(?:```|\/\/|\/\*|\*\/)/.test(trimmed)) return false
      return true
    })
    .join('\n')
}

export function cleanScriptText(raw: string) {
  let text = stripMarkdownFence(raw)

  try {
    const parsed = JSON.parse(text)
    const blocks = Array.isArray(parsed?.blocks) ? parsed.blocks : []
    const scriptBlock = blocks.find((block: any) => block?.type === 'script_card')
    if (typeof scriptBlock?.data?.script === 'string') {
      text = scriptBlock.data.script
    } else if (typeof parsed?.script === 'string') {
      text = parsed.script
    } else if (typeof parsed?.data?.script === 'string') {
      text = parsed.data.script
    }
  } catch {
    text = extractScriptLikeContent(text)
  }

  return stripCodeArtifactLines(stripMarkdownFence(text))
    .replace(/^\s*(?:最终文案|文案正文|口播文案)\s*[:：]\s*/i, '')
    .replace(/^\s*json\s*/i, '')
    .replace(/^\s*(?:const|let|var)\s+\w+\s*=\s*/i, '')
    .replace(/```/g, '')
    .trim()
}

export async function callScriptAI(
  prompt: string,
  onChunk: (text: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const mode = prompt.startsWith('【仿写文案】') ? 'rewrite' : 'original'
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system: buildScriptSystemPrompt(mode),
      messages: [{ role: 'user', content: prompt }],
      stream: true,
    }),
    signal,
  })

  if (!res.ok) throw new Error(`API ${res.status}`)

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let full = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value, { stream: true })
    for (const line of chunk.split('\n')) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') continue
      try {
        const parsed = JSON.parse(data)
        const text = parsed.delta?.text || parsed.choices?.[0]?.delta?.content || ''
        if (text) { full += text; onChunk(text) }
      } catch {}
    }
  }

  return cleanScriptText(full)
}

export function parseBlocks(raw: string): MessageBlock[] {
  // 去掉 markdown 代码块包裹（```json ... ``` 或 ``` ... ```）
  let cleaned = raw.trim()
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()

  // 尝试提取最外层 JSON 对象
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (!match) return [{ type: 'text', content: raw }]

  try {
    const parsed = JSON.parse(match[0])
    if (Array.isArray(parsed.blocks) && parsed.blocks.length > 0) {
      return parsed.blocks as MessageBlock[]
    }
  } catch {
    // JSON 解析失败，继续往下
  }

  // 兜底：把内容当纯文本显示，去掉 JSON 语法字符
  const textOnly = cleaned
    .replace(/^\s*\{[\s\S]*?"blocks"\s*:\s*\[/, '')
    .replace(/\]\s*\}\s*$/, '')
    .replace(/\{\s*"type"\s*:\s*"text"\s*,\s*"content"\s*:\s*"/g, '')
    .replace(/"\s*\}/g, '')
    .trim()
  return [{ type: 'text', content: textOnly || raw }]
}
