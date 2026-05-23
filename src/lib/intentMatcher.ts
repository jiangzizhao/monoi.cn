// intentMatcher — 关键词硬规则匹配用户输入意图. 用于 Agentic AI 第一道闸:
// 用户输入 → 命中工具关键词 → 前端直接 push chip 提示 "要打开 X 弹窗吗?"
// 0 命中走 AI 正常对话; 1 命中弹单确认; ≥2 命中弹二选一 (避免误判).
//
// 设计原则:
// - 不靠 AI 自评 confidence (大模型经常瞎自信), 靠关键词
// - 命中数 ≥ 3 只展示 top 2, 第 3 个不显示 (避免选择瘫痪)
// - score 越高 = 关键词越精确专属 (如 "抠图" 是 95, "做视频" 是 70 — 含糊)
// - prefill 字段留给将来 multi-step pipeline 用 (AI 第二轮 prefill 上一步结果)

export type IntentForm =
  | '__form_original__'
  | '__form_rewrite__'
  | '__form_paste__'
  | '__voice_preset__'
  | '__voice_upload__'
  | '__voice_clone__'
  | '__digital_human__'
  | '__narration_video__'
  | '__form_footage__'
  | '__form_cover__'
  | '__form_publish__'
  | '__form_cutout__'

export interface IntentEntry {
  form: IntentForm
  label: string        // chip 上显示的人话, 如 "数字人合成视频"
  keywords: string[]   // 命中任意一个就算匹配
  score: number        // 0-1, 关键词越精确越高
}

const INTENTS: IntentEntry[] = [
  // 文案 — 用户主动说"写"才命中, 别把"我要做视频"也卷进来
  { form: '__form_original__', label: '原创文案', score: 0.9,
    keywords: ['写文案', '写一篇文案', '原创文案', '帮我想标题', '想个脚本', '写脚本', '写口播稿'] },
  { form: '__form_rewrite__', label: '仿写文案', score: 0.9,
    keywords: ['仿写', '改写文案', '改写一下', '参考改写', '模仿这篇'] },
  { form: '__form_paste__', label: '我有文案', score: 0.85,
    keywords: ['我有文案', '我自己写好了文案', '粘贴文案', '已有文案'] },

  // 配音
  { form: '__voice_preset__', label: '预设音色配音', score: 0.9,
    keywords: ['预设音色', '选个音色', '用音色配音', '内置音色'] },
  { form: '__voice_clone__', label: '克隆声音', score: 0.95,
    keywords: ['克隆声音', '克隆我的声音', '复刻声音', '声音克隆'] },
  { form: '__voice_upload__', label: '上传录音剪辑', score: 0.85,
    keywords: ['上传录音', '我自己录的', '去气口', '去口误'] },

  // 口播视频
  { form: '__narration_video__', label: '口播剪辑', score: 0.9,
    keywords: ['口播剪辑', '剪口播', '剪我录的视频', '词级剪辑'] },
  { form: '__digital_human__', label: '数字人合成视频', score: 0.95,
    keywords: ['数字人', '数字人视频', '数字人合成', 'AI 数字人', 'AI数字人', '虚拟人对口型'] },

  // 素材匹配
  { form: '__form_footage__', label: '智能匹配素材', score: 0.85,
    keywords: ['配画面', '配素材', '匹配素材', '找视频片段', '智能匹配', 'b-roll'] },

  // 封面
  { form: '__form_cover__', label: '生成封面', score: 0.95,
    keywords: ['生成封面', '做封面', '封面生成', '出封面图', '弄封面'] },

  // 抠图 — '去背景' 太宽容易跟"去背景音乐"撞, 改成"抠掉背景/去除背景"等更精确
  { form: '__form_cutout__', label: '人物抠图', score: 0.95,
    keywords: ['抠图', '抠人物', '抠出人物', '抠掉背景', '去除背景', '透明背景', '透明 png', '透明PNG'] },

  // 发布
  { form: '__form_publish__', label: '自动发布', score: 0.9,
    keywords: ['一键发布', '自动发布', '发抖音', '发小红书', '发布到抖音', '发布到小红书'] },
]

export type MatchAction = 'none' | 'confirm' | 'disambiguate'

export interface IntentMatch {
  entry: IntentEntry
  hitKeyword: string  // 命中的具体那个词, 调试用
}

export interface MatchResult {
  matches: IntentMatch[]    // 已按 score desc + 关键词长度 desc 排好, top-2
  topScore: number
  action: MatchAction
}

// 问句词表 — 含这些词的输入认为用户在"问问题", 不是在"下命令", 跳过意图匹配
// 例: "数字人怎么用" "封面多少钱" "抠图能商用吗" 都不应该弹 chip
const QUESTION_MARKERS = [
  '怎么', '怎样', '如何', '啥', '什么', '多少', '为啥', '为什么',
  '能不能', '可以吗', '行不行', '可不可以', '有没有', '是不是',
  '?', '？', '麻烦', '请问',
]

/** 主入口: 用户输入 → 匹配结果. 没命中返 action='none'. */
export function matchIntent(userInput: string): MatchResult {
  const text = userInput.trim().toLowerCase()
  if (!text || text.length < 2) return { matches: [], topScore: 0, action: 'none' }

  // 用户消息以 sentinel/__form_*__ 开头的 (来自表单提交), 不要重新匹配
  if (text.startsWith('__') || text.startsWith('【')) {
    return { matches: [], topScore: 0, action: 'none' }
  }

  // 问句直接放行给 AI — 用户在问问题不是要打开弹窗
  for (const q of QUESTION_MARKERS) {
    if (text.includes(q)) return { matches: [], topScore: 0, action: 'none' }
  }

  const hits: IntentMatch[] = []
  for (const entry of INTENTS) {
    for (const kw of entry.keywords) {
      if (text.includes(kw.toLowerCase())) {
        hits.push({ entry, hitKeyword: kw })
        break  // 同一 form 只算一次, 不重复
      }
    }
  }

  if (hits.length === 0) return { matches: [], topScore: 0, action: 'none' }

  // 排序: score 高的在前, score 同的关键词长的在前 (更精确)
  hits.sort((a, b) => {
    if (b.entry.score !== a.entry.score) return b.entry.score - a.entry.score
    return b.hitKeyword.length - a.hitKeyword.length
  })

  const top2 = hits.slice(0, 2)
  const action: MatchAction = top2.length >= 2 ? 'disambiguate' : 'confirm'

  return { matches: top2, topScore: top2[0].entry.score, action }
}

/** 生成 chip 的 ChoiceOption.id, 编码 form + prefill JSON.
 * 解析端 (useChat.chooseOption / ChatInput.pickModuleOption) 看到 __autoopen__: 前缀就走新逻辑.
 * prefill 用 base64 避免特殊字符破坏 id 解析. */
export function encodeAutoOpenId(form: IntentForm, prefill?: Record<string, unknown>): string {
  if (!prefill || Object.keys(prefill).length === 0) {
    return `__autoopen__:${form}`
  }
  try {
    const payload = btoa(unescape(encodeURIComponent(JSON.stringify(prefill))))
    return `__autoopen__:${form}:${payload}`
  } catch {
    return `__autoopen__:${form}`
  }
}

/** 解析 chip option id, 返回 { form, prefill } 或 null. */
export function decodeAutoOpenId(id: string): { form: IntentForm; prefill?: Record<string, unknown> } | null {
  if (!id.startsWith('__autoopen__:')) return null
  const parts = id.slice('__autoopen__:'.length).split(':')
  const form = parts[0] as IntentForm
  if (!form) return null
  if (parts.length < 2) return { form }
  try {
    const json = decodeURIComponent(escape(atob(parts.slice(1).join(':'))))
    return { form, prefill: JSON.parse(json) }
  } catch {
    return { form }
  }
}

/** "取消" / "都不是" chip 的 sentinel id, useChat 看到这个就走原文给 AI. */
export const AUTOOPEN_DISMISS_ID = '__autoopen_dismiss__'
