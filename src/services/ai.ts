import type { MessageBlock, ChatMessage } from '../types'
import { jsonrepair } from 'jsonrepair'

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
模块3：口播视频
━━━━━━━━━━━━━━━━━━━━━━━━━━
引导用户选择出镜方式：
- 自录上传：用户自己录口播视频(MP4)上传, 系统支持后续词级剪辑
- 数字人：上传形象图/视频驱动 (HeyGem 模型, 配音+形象生成视频, 单条数字人按套餐配额扣)
- AI 生成视频：暂未上线 (V2 接 CogVideo/Wan)

━━━━━━━━━━━━━━━━━━━━━━━━━━
模块4：口播剪辑 (词级)
━━━━━━━━━━━━━━━━━━━━━━━━━━
- 自动 whisper 识别口播视频, 词级时间戳
- 用户可以直接在文字界面 删气口/重复词/口误, 系统按词级别精准剪掉对应视频片段
- 输出剪辑后的口播视频 (画质无损), 后续步骤用这个剪辑过的版本

━━━━━━━━━━━━━━━━━━━━━━━━━━
模块5：素材匹配
━━━━━━━━━━━━━━━━━━━━━━━━━━
- 按句子拆解剪辑后的口播视频
- 每句提炼画面描述 + 中英双语搜索关键词
- 用关键词匹配 Pexels / Pixabay 视频 b-roll 素材
- 用户也能自传素材库视频
- 每句的推荐时长按朗读节奏估

━━━━━━━━━━━━━━━━━━━━━━━━━━
模块6：一键合成成品
━━━━━━━━━━━━━━━━━━━━━━━━━━
- 选好每镜素材后, 一键合成最终视频:
  口播音频 (master) + b-roll (按句切换) + 可选口播 PIP 小窗 + 可选 BGM
- PIP 支持圆形/圆角矩形/圆角方块, 4 个角位置可选
- 输出比例: 9:16 / 16:9 / 3:4 / 1:1
- 用户也可以导出剪映草稿 (3 轨道分段, Chrome/Edge 自动落到剪映目录, 切到剪映直接微调)

━━━━━━━━━━━━━━━━━━━━━━━━━━
模块7：封面生成
━━━━━━━━━━━━━━━━━━━━━━━━━━
- 5 个内置模板: YouTube 爆款 / 抖音 / 小红书 / B站 / 极简
- 4 个比例同时出: 9:16 / 16:9 / 3:4 / 1:1
- 可自定义: 字体 (11 种内置), 主标/副标颜色, 主标/副标字号, 主标/副标位置 9 宫格
- 视频截帧 OR 用户自传图作为底图

━━━━━━━━━━━━━━━━━━━━━━━━━━
模块8：发布文案 + 自动发布
━━━━━━━━━━━━━━━━━━━━━━━━━━
- 生成发布文案: 抖音/小红书/视频号/B站 各平台标题/描述/标签 (按各自风格)
- 自动发布: 本机弹出 Edge 浏览器 (持久 profile), 自动登录小红书/抖音填好表单, 用户审稿点发布
- (V2: 接 微信视频号 / B站 自动发布)

━━━━━━━━━━━━━━━━━━━━━━━━━━
范围限定（最重要规则，必须严格执行）
━━━━━━━━━━━━━━━━━━━━━━━━━━
你只回答跟"短视频口播创作"相关的问题。允许的话题范围：
- monoi 工具本身的使用方法 (怎么生成文案、怎么配音、怎么剪辑、怎么合成、怎么导出剪映/自动发布等)
- 创作思路 (黄金三秒、钩子、爆款结构、文案技巧、口播技巧)
- 文案 / 配音 / 口播视频 / 口播剪辑 / 素材匹配 / 一键合成 / 封面 / 发布文案 / 自动发布
- 相关行业知识 (抖音/小红书/视频号/B站/YouTube 平台规则、AI 配音、视频素材版权等)

如果用户问的不在以上范围（例如：天气、新闻、闲聊、写代码、解数学题、查资料、做饭、情感问题等），
你必须只输出以下固定 JSON，不要回答原问题，不要解释，不要自由发挥：

{"blocks":[
  {"type":"text","content":"我只负责短视频口播创作流程，这个问题不在我的范围里。下面这些是我能帮你的："},
  {"type":"choices","question":"想做什么？","options":[
    {"id":"我想写一篇文案","label":"写文案","description":"原创 / 仿写 / 你自己已有的文案"},
    {"id":"我想给文案配音","label":"配音","description":"预设音色 / 克隆声音 / 自己录"},
    {"id":"我想做口播视频","label":"口播视频","description":"自录剪辑 / 数字人对口型"},
    {"id":"我想给视频找素材","label":"找素材","description":"按文案自动搜视频片段"}
  ]}
]}

判断模糊时，宁可拒绝也不要勉强回答。

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

{"type":"platform_copy","data":{"douyin":{"title":"标题示例(12字内, 加钩子/emoji)","description":"描述示例(80字内, 含话题#)","tags":["tag1","tag2","tag3"]},"xiaohongshu":{"title":"标题示例(20字内, 强烈引人点击)","body":"正文示例(分行口语化, 含#话题)","tags":["话题1","话题2","话题3"]},"shipinhao":{"title":"标题示例(20字内)","description":"描述示例(简短直接)"},"bilibili":{"title":"标题示例(40字内, 信息量大)","description":"描述示例(可长一些, 100-200 字)","tags":["分区","tag1","tag2"]},"cover":{"main_title":"封面主标(6-10字, 抓眼球)","subtitle":"副标(可选)","color_suggestion":"配色建议如'黑底黄字'"}}}

【重要】上面 platform_copy schema 里的"标题示例""描述示例"是**占位符提示你格式**, 你**必须根据对话中已有的文案/视频主题**写真正的标题、描述、标签内容, 绝对不要原样输出这些占位字符串.

用户消息是「帮我生成各平台的发布文案」或类似 → 基于对话中最近的文案/视频主题, 输出一个 platform_copy block, 每个平台 (抖音/小红书/视频号/B站) 都按各自风格真填内容:
- 抖音: 短钩子, 强情绪, 12字内标题
- 小红书: 种草感, 20字内标题, body 分行用 emoji
- 视频号: 偏正式, 不夸张
- B站: 标题信息量大可以长

输出 platform_copy 之后, **必须再补一个 choices block**, 让用户继续往下. **两个 block 一起放在 blocks 数组里, 不要拼成一个 block 也不要省略外层 blocks 包装**:

正确示例 (两 block 都在 blocks 数组里):
{"blocks":[
  {"type":"platform_copy","data":{"douyin":{"title":"...","description":"...","tags":["..."]},"xiaohongshu":{"title":"...","body":"...","tags":["..."]},"shipinhao":{"title":"...","description":"..."},"bilibili":{"title":"...","description":"...","tags":["..."]},"cover":{"main_title":"...","subtitle":"...","color_suggestion":"..."}}},
  {"type":"choices","question":"下一步","options":[{"id":"__form_publish__","label":"去发布","description":"上传到小红书 / 抖音"},{"id":"再改一版发布文案","label":"重新生成","description":"风格不满意可以再来一版"}]}
]}

错误示例 (这种格式前端解析不了):
{"type":"platform_copy","data":{...},"type":"choices",...}    ← 缺 blocks 数组
{"type":"platform_copy",...}{"type":"choices",...}            ← 两个对象拼一起不合法 JSON

【输出 platform_copy 之前再 self-check 一遍】每个字符串引号成对闭合, 每个对象的大括号成对闭合, 数组方括号也成对. 字符串里不要混入双引号字符 (描述里如果要引用某个词, 用「」代替).

一条回复可以包含多个block。绝对不要返回blocks数组以外的任何内容，不要有markdown代码块包裹。`

interface AIMessage { role: 'user' | 'assistant'; content: string }

export function isScriptPrompt(text: string) {
  return text.startsWith('【原创文案】') || text.startsWith('【仿写文案】')
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchWithRetry(input: RequestInfo | URL, init: RequestInit, retries = 2): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch (error) {
    if (init.signal?.aborted || retries <= 0) throw error
    await wait((3 - retries) * 800)
    return fetchWithRetry(input, init, retries - 1)
  }
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
  const res = await fetchWithRetry('/api/chat', {
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

function buildScriptSystemPrompt(mode: 'original' | 'rewrite' | 'dialect') {
  const common = [
    '你的回复必须只包含最终文案正文。',
    '禁止输出 JSON、代码、Markdown、代码块、字段名、解释、标题推荐、标签、分析、前后缀说明。',
    '不要出现 ```、{、}、"type"、"blocks"、"script_card"、const、function、return、JSON.stringify 等代码或结构化字段。',
    '每一行是一句独立语义，形成自然停顿。',
  ]
  const rewrite = [
    '你是 monoi 的中文短视频口播文案写手。',
    '文案要口语化，适合直接给 AI 配音朗读。',
    '这是仿写任务：保留参考原文约 50% 的叙事结构，案例素材置换 80%，重复率控制在 30% 以下。',
    '不要复述任务要求，不要点评原文，只输出改写后的口播文案。',
  ]
  const original = [
    '你是 monoi 的中文短视频口播文案写手。',
    '文案要口语化，适合直接给 AI 配音朗读。',
    '这是原创任务：根据用户提供的平台、风格、字数、行业和目标用户，直接创作一篇口播文案。',
    '不要询问补充信息，只输出完整口播文案。',
    '【字数严格控制】',
    '- "短篇" = 必须 150-300 字（中文字符，标点不算）',
    '- "中篇" = 必须 300-600 字',
    '- "长篇" = 必须 600-1200 字',
    '- "不限" = 自由发挥（300-800 字之间最佳）',
    '写完后自己默数一遍中文字数，不在范围内就重写到达标为止。宁可少 10 字也不要超 1 字。',
    '不要为了凑字数加废话、重复、口水句。也不要因为内容不够就随便结尾。',
  ]
  const dialect = [
    '你是一个精通中国各地方言以及日语、英语、韩语的本地化口播文案专家。',
    '你的任务是把普通话短视频文案"本地化"成目标语种/方言版本。不是字面翻译，而是用目标语种/方言的母语者实际会说的话来重写。',
    '严格要求：',
    '1. 不要保留普通话的标准表达——必须替换成目标方言/语言的等价说法',
    '2. 不要写"翻译腔"——避免生硬直译，要像母语者随口说出来的样子',
    '3. 不要混用其他语种（除非任务明确要求双语）',
    '4. 短视频口播节奏：每行短句，节奏紧凑，有钩子',
    '5. 字数尽量贴近原文，保留情绪和卖点',
  ]
  if (mode === 'dialect') return [...common, ...dialect].join('\n')
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

function extractStringArrayContent(value: string) {
  const lines: string[] = []
  const pattern = /"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|`([\s\S]*?)`/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(value))) {
    const content = match[1] ?? match[2] ?? match[3] ?? ''
    const decoded = decodeStringLiteral(content).trim()
    if (decoded) lines.push(decoded)
  }
  return lines.join('\n')
}

function extractScriptLikeContent(text: string) {
  const patterns = [
    /["']script["']\s*:\s*"((?:\\.|[^"\\])*)"/,
    /["']script["']\s*:\s*'((?:\\.|[^'\\])*)'/,
    /["']script["']\s*:\s*`([\s\S]*?)`/,
    /\bscript\s*:\s*"((?:\\.|[^"\\])*)"/,
    /\bscript\s*:\s*'((?:\\.|[^'\\])*)'/,
    /\bscript\s*:\s*`([\s\S]*?)`/,
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

  const arrayPatterns = [
    /["']script["']\s*:\s*\[([\s\S]*?)\]\s*(?:\.join\s*\([^)]*\))?/,
    /\bscript\s*:\s*\[([\s\S]*?)\]\s*(?:\.join\s*\([^)]*\))?/,
    /(?:const|let|var)\s+\w*(?:script|copy|text|content|文案)\w*\s*=\s*\[([\s\S]*?)\]\s*(?:\.join\s*\([^)]*\))?/i,
    /return\s+\[([\s\S]*?)\]\s*(?:\.join\s*\([^)]*\))?/i,
  ]
  for (const pattern of arrayPatterns) {
    const match = text.match(pattern)
    if (match?.[1]?.trim()) {
      const content = extractStringArrayContent(match[1])
      if (content.trim()) return content
    }
  }

  return text
}

function stripCodeArtifactLines(text: string) {
  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()
      const quoted = trimmed.match(/^["'`]([\s\S]*?)["'`]\s*,?$/)
      return quoted ? decodeStringLiteral(quoted[1]) : line
    })
    .filter((line) => {
      const trimmed = line.trim()
      if (!trimmed) return true
      if (/^(?:import|export|interface|type|function|const|let|var|return|if|else|try|catch)\b/.test(trimmed)) return false
      if (/^(?:JSON\.|Object\.|Array\.|console\.|new\s+)/.test(trimmed)) return false
      if (/^(?:\{|\}|\[|\]|\),?|\};?|,\s*)$/.test(trimmed)) return false
      if (/^["']?(?:type|blocks|data|script|original|analysis|titles|tags|douyin|xiaohongshu|shipinhao)["']?\s*:/.test(trimmed)) return false
      if (/^(?:\]\.join|\)\.join)/.test(trimmed)) return false
      if (/^(?:```|\/\/|\/\*|\*\/)/.test(trimmed)) return false
      return true
    })
    .join('\n')
}

function looksLikeCodeArtifact(text: string) {
  return /```|["']?(?:blocks|script_card|type|data)["']?\s*:|(?:const|let|var|function|return)\b|JSON\.stringify|=>/.test(text)
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

  const cleaned = stripCodeArtifactLines(stripMarkdownFence(text))
    .replace(/^\s*(?:最终文案|文案正文|口播文案)\s*[:：]\s*/i, '')
    .replace(/^\s*json\s*/i, '')
    .replace(/^\s*(?:const|let|var)\s+\w+\s*=\s*/i, '')
    .replace(/```/g, '')
    .trim()

  if (looksLikeCodeArtifact(cleaned)) {
    const lines = cleaned
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !looksLikeCodeArtifact(line))
    if (lines.length > 0) return lines.join('\n')
  }

  return cleaned
}

export async function callScriptAI(
  prompt: string,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
  modeOverride?: 'original' | 'rewrite' | 'dialect'
): Promise<string> {
  const mode = modeOverride ?? (prompt.startsWith('【仿写文案】') ? 'rewrite' : 'original')
  const res = await fetchWithRetry('/api/chat', {
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

export interface FootageSentence {
  text: string
  scene: string
  search_en: string[]
  search_cn: string[]
  duration: number
}

const FOOTAGE_SYSTEM_PROMPT = `你是短视频素材匹配助手. 用户给你一段口播文案, 你按句子拆开, 每句生成视频素材搜索关键词.

【输出格式严格遵守】
只输出 JSON, 不要任何解释 / markdown / 代码块包裹. 格式:
{"sentences":[{"text":"原句子","scene":"画面描述","search_en":["keyword1","keyword2","keyword3"],"search_cn":["关键词1","关键词2"],"duration":3}]}

【关键: search_en 必须是"画面化英文搜索词"】
不是字面翻译, 而是"这句话拍出来画面里有什么". 优先 (主体 + 动作 + 场景):
- "减肥失败不是没毅力" → ["frustrated woman gym", "tired exercise", "exhausted workout"]
  (不要写 "weight loss failure willpower" — 太抽象, Pexels 搜不到)
- "其实这才是减脂最牛的信号" → ["body transformation", "fit body mirror", "weight loss progress"]
- "每天少吃 300 大卡" → ["healthy meal portion", "calorie counting food", "diet plate"]

【规则】
1. 一个 segment 的 sentence: 按完整语义拆 (不要按逗号拆得太碎). 大约 8-25 字一句.
2. search_en 给 2-4 个候选 (Pexels/Pixabay 多次搜)
3. search_cn 给 1-2 个 (兜底, 中文搜命中率低但偶尔命中本土素材)
4. duration: 这句话朗读估算秒数 (中文按 4 字/秒)
5. scene: 一句话中文描述画面, 帮用户理解
6. 不要输出空的 sentences[]

【画面词技巧】
- 抽象概念 → 具象画面 ("成功" → "winner trophy celebration")
- 主语别忘了 (人/物/场景)
- 用通用词 (woman / man / business / nature), 别用太专业的`

// segments 模式: 输入已经按句拆好的 [{text, duration}], AI 只生成 search_en/cn/scene, 不再拆句
const FOOTAGE_BY_SEGMENTS_PROMPT = `你给一个口播视频里已经拆好的句子列表, 每句生成画面化英文搜索词 (谁/在哪/干什么).

【输出格式严格遵守】
只输出 JSON, 不要任何解释/markdown/代码块. 数组长度必须跟输入一一对应:
{"keywords":[{"scene":"画面描述","search_en":["kw1","kw2","kw3"],"search_cn":["关键词"]}]}

【关键: search_en 是"画面化英文搜索词"】
不是字面翻译, 而是这句话拍出来画面里有什么. 优先 (主体+动作+场景):
- "减肥失败不是没毅力" → ["frustrated woman gym", "exhausted workout", "tired exercise"]
  (不要 "weight loss failure willpower" — 太抽象, Pexels 搜不到)
- "其实这才是减脂最牛的信号" → ["body transformation", "fit body progress", "weight loss success"]

【规则】
- 每条 search_en 给 2-4 个候选词组 (Pexels/Pixabay 多次搜)
- 每条 search_cn 给 1-2 个 (中文搜兜底)
- scene 一句中文画面描述
- 用通用词 (woman/man/business/nature), 别用太专业的
- 数组长度严格等于输入 segments 数量, 不要漏不要多`

export interface FootageKeywords {
  scene: string
  search_en: string[]
  search_cn: string[]
}

export async function callFootageAIBySegments(
  segments: { text: string; duration: number }[],
  signal?: AbortSignal
): Promise<FootageKeywords[]> {
  const userMsg = `已拆好的 ${segments.length} 句:\n` +
    segments.map((s, i) => `${i + 1}. (${s.duration.toFixed(1)}s) ${s.text}`).join('\n')

  // 用 json_mode (DeepSeek response_format) + 非流式, 大幅降低 JSON 解析失败概率
  // 失败时用 jsonrepair 兜底再 parse 一次, 还失败就重试 1 次
  const callOnce = async (): Promise<any> => {
    const r = await fetchWithRetry('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system: FOOTAGE_BY_SEGMENTS_PROMPT,
        messages: [{ role: 'user', content: userMsg }],
        stream: false,
        json_mode: true,
      }),
      signal,
    })
    if (!r.ok) throw new Error(`API ${r.status}`)
    const data = await r.json()
    const content = data?.choices?.[0]?.message?.content || ''
    return tryParseJsonLoose(content)
  }

  let obj: any
  try {
    obj = await callOnce()
  } catch (e) {
    // 重试 1 次
    obj = await callOnce()
  }
  if (!Array.isArray(obj?.keywords) || obj.keywords.length === 0) {
    throw new Error('AI 返回的 keywords 为空')
  }
  while (obj.keywords.length < segments.length) {
    obj.keywords.push({ scene: '', search_en: [], search_cn: [] })
  }
  return obj.keywords.slice(0, segments.length) as FootageKeywords[]
}

// 宽松 JSON 解析: 先去掉 markdown fence, 再 parse, 失败再用启发式修复 (常见: 末尾被截断 / 多余逗号)
function tryParseJsonLoose(raw: string): any {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {}
  // 尝试取最外层 {...}
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (match) {
    try { return JSON.parse(match[0]) } catch {}
    // 修复 1: 去掉末尾多余逗号 (e.g. "...,]" "...,}")
    const fixed = match[0].replace(/,\s*([}\]])/g, '$1')
    try { return JSON.parse(fixed) } catch {}
    // 修复 2: AI 可能在最后一个数组项截断, 找最后一个完整 } 截到那
    const lastBrace = match[0].lastIndexOf('}')
    if (lastBrace > 0) {
      // 往前找完整的 keywords 数组结束
      const truncated = match[0].slice(0, lastBrace + 1) + ']}'
      try { return JSON.parse(truncated) } catch {}
    }
  }
  throw new Error(`AI 返回的 JSON 解析失败: ${cleaned.slice(0, 200)}...`)
}

export async function callFootageAI(
  script: string,
  signal?: AbortSignal
): Promise<FootageSentence[]> {
  const res = await fetchWithRetry('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system: FOOTAGE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: script }],
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
        if (text) full += text
      } catch {}
    }
  }
  // 解析 JSON
  const cleaned = full.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('AI 没返回有效 JSON')
  const obj = JSON.parse(match[0])
  if (!Array.isArray(obj?.sentences) || obj.sentences.length === 0) {
    throw new Error('AI 返回的 sentences 为空')
  }
  return obj.sentences as FootageSentence[]
}

export function parseBlocks(raw: string): MessageBlock[] {
  // 去掉 markdown 代码块包裹（```json ... ``` 或 ``` ... ```）
  let cleaned = raw.trim()
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()

  // 尝试提取最外层 JSON 对象
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (!match) return [{ type: 'text', content: raw }]

  // 第一道: 严格 parse
  try {
    const parsed = JSON.parse(match[0])
    if (Array.isArray(parsed.blocks) && parsed.blocks.length > 0) {
      return parsed.blocks as MessageBlock[]
    }
  } catch {}

  // 第二道: AI 漏了 blocks 包装且返回多个 {...} 拼一起 (`{...},{...}` 或 `{...}{...}`)
  // 必须先于"jsonrepair 当单 block 处理"——否则只能拿到第一个 block
  try {
    const repaired = jsonrepair(`[${match[0]}]`)
    const parsed = JSON.parse(repaired)
    if (Array.isArray(parsed) && parsed.length > 1 && parsed.every((b: any) => b && typeof b === 'object' && b.type)) {
      console.warn('[parseBlocks] AI 漏了 blocks 包装且返回多 block, 当数组处理')
      return parsed as MessageBlock[]
    }
  } catch {}

  // 第三道: jsonrepair 修常见 LLM 错误 (缺引号 / 缺逗号 / 缺右括号)
  try {
    const repaired = jsonrepair(match[0])
    const parsed = JSON.parse(repaired)
    if (Array.isArray(parsed.blocks) && parsed.blocks.length > 0) {
      console.warn('[parseBlocks] 用 jsonrepair 修了 AI 的 JSON 错误')
      return parsed.blocks as MessageBlock[]
    }
    // 兜底: AI 漏了 blocks 包装, 把 type/data 当成一个 block 直接塞数组
    if (parsed && typeof parsed === 'object' && parsed.type) {
      console.warn('[parseBlocks] AI 漏了 blocks 包装, 当单 block 处理')
      return [parsed as MessageBlock]
    }
  } catch (e) {
    console.warn('[parseBlocks] jsonrepair 也修不了:', e)
  }

  // 第四道: 强行塞回 {"blocks": [...]} 让 jsonrepair 修 — 多 block + 没 wrapper + 边界畸形 也能救
  try {
    const repaired = jsonrepair(`{"blocks":[${match[0]}]}`)
    const parsed = JSON.parse(repaired)
    if (Array.isArray(parsed.blocks) && parsed.blocks.length > 0) {
      console.warn('[parseBlocks] 第四道兜底成功 (强塞 blocks 包装)')
      return parsed.blocks as MessageBlock[]
    }
  } catch {}

  // 全部失败 — 打到 console 让生产环境能看到真实 AI 输出, 方便 debug
  console.error('[parseBlocks] 所有解析都失败, raw 内容 (前 500 字):', raw.slice(0, 500))

  // 兜底：把内容当纯文本显示，去掉 JSON 语法字符
  const textOnly = cleaned
    .replace(/^\s*\{[\s\S]*?"blocks"\s*:\s*\[/, '')
    .replace(/\]\s*\}\s*$/, '')
    .replace(/\{\s*"type"\s*:\s*"text"\s*,\s*"content"\s*:\s*"/g, '')
    .replace(/"\s*\}/g, '')
    .trim()
  return [{ type: 'text', content: textOnly || raw }]
}
