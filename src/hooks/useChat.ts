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
  cantonese: `把下面这段普通话文案改写成**地道香港粤语**口播版本（不是粤普，不是直译）。

【必用替换】
- 不/没 → 唔；是 → 係；的 → 嘅；东西 → 嘢；这样 → 咁；那 → 嗰；哪里 → 邊度
- 我们 → 我哋；他/她 → 佢；是的 → 係呀
- 干嘛/做什么 → 做乜；什么 → 乜嘢/咩
- 现在 → 而家；先 → 先；已经 → 已經
- 来了 → 嚟咗；去了 → 去咗；吃了 → 食咗
- 知道 → 知/識；告诉 → 話畀；给 → 畀

【必用句末助词】啦、咯、嘛、㗎、喎、囉、咩、噃

【对照示例】
- 普通话"我等你呢"→ 粤语"我喺度等緊你"
- 普通话"你怎么了"→ 粤语"你做乜啊"
- 普通话"很好看"→ 粤语"好靚啊"
- 普通话"不要这样"→ 粤语"唔好咁啦"

【避免】
- 写成"普通话词+粤语助词"的假粤语
- 用"了"、"的"、"什么"、"哪里" 这种普通话词
- 翻译腔、书面语

每行短句，符合 TVB 主持人口语节奏。`,

  sichuan: `把下面这段普通话文案改写成**地道川渝方言**口播版本（成都/重庆话风格）。

【必用替换】
- 不 → 不；什么 → 啥子/撒子；怎么 → 咋个；为什么 → 咋个；好/行 → 要得
- 我 → 我；你 → 你；他 → 他；我们 → 我们/俺们
- 干嘛 → 做啥子；干啥 → 爪子/搞啥子；知道 → 晓得
- 别 → 莫；舒服 → 巴适；爽 → 安逸；累 → 拐了
- 弄/做 → 整；很 → 嘿（重庆）/好（成都）
- 厉害 → 凶；棒 → 巴适得板

【必用句末助词】嘞、嘛、撒、哦、噢、嗨呀、咯

【对照示例】
- 普通话"今天好热啊"→ 川渝"今天嘿热嘞"
- 普通话"你在干啥"→ 川渝"你爪子嘞"
- 普通话"特别好吃"→ 川渝"巴适得板"
- 普通话"有点意思"→ 川渝"有点儿意思嘛"

【避免】
- 把"普通话+嘞"当成川渝话
- 漏掉"嘞/嘛/撒"等关键尾音
- 写得太书面

风格：泼辣、生活化、火锅味儿，像龙门阵摆给你听。`,

  henan: `把下面这段普通话文案改写成**地道河南方言**口播版本（豫中/郑州话风格）。

【必用替换】
- 行/可以 → 中；不行 → 不中
- 怎么 → 咋；什么 → 啥；为啥 → 咋；为什么 → 咋着
- 你 → 你；那 → 恁；很 → 可（强调时） / 老
- 喜欢 → 爱；干啥 → 弄啥嘞；舒服 → 得劲
- 不少 → 不老儿；找 → 寻；想 → 寻思
- 走 → 走；快 → 麻溜；棒 → 美得很

【必用句末助词】哩、嘞、咧、啊

【对照示例】
- 普通话"行不行"→ 河南"中不中"
- 普通话"怎么了"→ 河南"咋了哩"
- 普通话"特别好吃"→ 河南"美得很咧"
- 普通话"你在干啥"→ 河南"你弄啥嘞"

【避免】
- 把"普通话+哩"硬贴当河南话
- 漏掉"中/咋/恁/嘞"这些核心词

风格：朴实、亲切、带点幽默感，像老乡跟你拉家常。`,

  northeast: `把下面这段普通话文案改写成**地道东北方言**口播版本（沈阳/铁岭/哈尔滨风格）。

【必用替换】
- 是的 → 嗯呐；很/特别 → 贼；干嘛 → 嘎哈
- 怎么 → 咋地；聊天 → 唠嗑；想 → 寻思
- 弄/做 → 整；喜欢 → 稀罕；舒服/爽 → 得劲
- 厉害 → 杠杠的；漂亮 → 老带劲了；多 → 老多了
- 不行 → 不中/不行；倒霉 → 玩完
- 家伙、可劲儿、嗷嗷的、贼啦

【必用句末助词】呗、呢、啊、嘞、哈、的呀

【对照示例】
- 普通话"你干啥呢"→ 东北"你嘎哈呢"
- 普通话"特别好吃"→ 东北"贼好吃"
- 普通话"很厉害"→ 东北"杠杠的"
- 普通话"我去看看"→ 东北"我寻思去看看哈"

【避免】
- 只在末尾加"呗"就当东北话
- 漏掉"贼/嘎哈/老/嗷嗷"等核心词

风格：豪爽、幽默、带烧烤摊味儿，像跟兄弟唠嗑。`,

  japanese: `Rewrite the following Mandarin Chinese script into natural, native Japanese for short-form video voiceover. Output Japanese only.

Requirements:
- Native-level Japanese — NOT machine translation, NOT direct word-for-word translation
- Casual conversational tone for short video (TikTok/YouTube Shorts/Reels Japan)
- Mix だ/だよ/ね/よ/んだ etc. for natural flow; avoid stiff です/ます unless tone demands it
- Use 短い文 — 1 line = 1 short clause, ending with 、or 。
- Keep the same hook (the first 3 seconds attention grabber) and emotional beats
- Approximate the same length (in moras, not characters)
- Use natural Japanese idioms instead of literal Chinese-style expressions
- Output ONLY Japanese, no Chinese, no English, no explanations, no headers

Example mapping:
- "你练了三个月，体重没掉一斤" → "三ヶ月もトレーニングしたのに、体重一キロも落ちないの"
- "其实这才是减脂最牛的信号" → "これ、実は脂肪が落ちてる最高のサインなんだよ"`,

  english: `Rewrite the following Mandarin Chinese script into natural, native English for short-form video voiceover. Output English only.

Requirements:
- Native-level American English — NOT machine translation
- Casual, conversational, short-video tone (TikTok/YouTube Shorts/Reels)
- Use contractions (you're, don't, can't, it's), natural slang where it fits
- Avoid academic/formal vocabulary
- Each line = one short punchy clause ending with comma or period
- Keep the same hook (first 3 seconds) and emotional beats
- Approximate the same length and pacing
- Output ONLY English, no Chinese, no explanations, no headers

Example mapping:
- "你练了三个月" → "You've been training for three months,"
- "体重没掉一斤" → "and the scale hasn't moved at all,"
- "其实这才是减脂最牛的信号" → "but here's the thing — that's actually the BEST sign you're losing fat."`,

  tianjin: `把下面这段普通话文案改写成**地道天津方言**口播版本。
- 用天津话词汇语气（嘛、介、倍儿、哏儿、贫嘴、闹爷们儿、哏儿都、瞎掰、胡掰、嘛玩意儿、得劲）
- 句末助词：哎、呀、嘞、咧、哏儿
- 风格：贫、爽利、带点幽默感，像茶馆相声
- 字数贴近原文，每行短句`,
  taiwanese: `把下面这段普通话文案改写成**地道台湾国语**口播版本（不是闽南语，是台式国语）。
- 用台湾国语词汇（蛮、超、有点、哦、欸、好啦、酱、酱子、啦、啰、嘛）
- 句末助词：啦、嘛、欸、捏、耶
- 避免大陆词（"特别、肯定、视频"→"超、绝对、影片"）
- 风格：温和、亲切、有点撒娇感，台北/台中年轻人风`,
  hunan: `把下面这段普通话文案改写成**地道湖南方言**口播版本（长沙话/湖南话风格）。
- 用湖南话词汇（恰、霸蛮、要得、嫑（不要）、咯、耍、蛮、几、蛮恰惯、堂客（老婆）、巴适等）
- 句末助词：咧、咯、嗯、哒、哦
- 风格：辣、爽快、自带搞笑包袱，长沙人语调
- 字数贴近原文，每行短句`,
  french: `Réécris le script chinois suivant en français natif et naturel pour voiceover de vidéo courte.
- Niveau natif, style conversationnel et casual
- Garde le hook (3 premières secondes) et le rythme original
- Une ligne = une courte phrase, terminée par , ou .
- Sors UNIQUEMENT le français, pas de chinois ni d'explication`,
  german: `Schreibe das folgende chinesische Skript in natürliches, muttersprachliches Deutsch für Kurzvideo-Voiceover um.
- Konversationston, casual, kein steifes Hochdeutsch
- Behalte den Hook und Rhythmus
- Eine Zeile = ein kurzer Satz mit , oder .
- NUR Deutsch ausgeben, kein Chinesisch, keine Erklärungen`,
  spanish: `Reescribe el siguiente guion chino en español natural y nativo para voiceover de video corto.
- Tono conversacional, casual
- Mantén el hook y el ritmo original
- Una línea = una frase corta, terminando con , o .
- SOLO español, nada de chino ni explicaciones`,
  italian: `Riscrivi il seguente script cinese in italiano naturale e madrelingua per voiceover di video breve.
- Tono colloquiale, casual
- Mantieni il hook e il ritmo
- Una riga = una frase breve con , o .
- SOLO italiano, niente cinese né spiegazioni`,
  russian: `Перепиши следующий китайский сценарий на естественный, родной русский для короткого видео-войсовера.
- Разговорный, неформальный тон
- Сохраняй хук и ритм оригинала
- Одна строка = одна короткая фраза с , или .
- Только русский, без китайского и объяснений`,
  thai: `เขียนสคริปต์จีนต่อไปนี้ใหม่เป็นภาษาไทยธรรมชาติแบบเจ้าของภาษาสำหรับวิดีโอสั้น
- ใช้ภาษาพูด สบาย ๆ
- รักษาฮุค (3 วินาทีแรก) และจังหวะ
- หนึ่งบรรทัด = ประโยคสั้น ๆ จบด้วย , หรือ .
- ส่งออกเฉพาะภาษาไทย ไม่มีภาษาจีนหรือคำอธิบาย`,
  vietnamese: `Viết lại kịch bản tiếng Trung dưới đây thành tiếng Việt tự nhiên, bản ngữ cho voiceover video ngắn.
- Giọng văn hội thoại, thân mật
- Giữ hook (3 giây đầu) và nhịp điệu
- Mỗi dòng = một câu ngắn, kết thúc bằng , hoặc .
- Chỉ xuất tiếng Việt, không tiếng Trung không giải thích`,
  indonesian: `Tulis ulang skrip Mandarin berikut menjadi Bahasa Indonesia yang natural untuk voiceover video pendek.
- Nada percakapan, casual
- Pertahankan hook dan ritme
- Satu baris = satu kalimat pendek diakhiri , atau .
- HANYA Bahasa Indonesia, tanpa Mandarin atau penjelasan`,
  malay: `Tulis semula skrip Mandarin berikut dalam Bahasa Melayu semula jadi untuk voiceover video pendek.
- Nada perbualan, santai
- Kekalkan hook dan ritma
- Satu baris = satu ayat pendek diakhiri , atau .
- HANYA Bahasa Melayu, tiada Mandarin atau penjelasan`,
  filipino: `Isulat muli ang sumusunod na script sa Mandarin sa natural at native na Filipino para sa short video voiceover.
- Conversational, casual na tono
- Panatilihin ang hook at ritmo
- Isang linya = isang maikling pangungusap na nagtatapos sa , o .
- Filipino lang, walang Mandarin o paliwanag`,
  korean: `다음 중국어 스크립트를 자연스러운 한국어 숏폼 영상 보이스오버로 다시 써주세요. 한국어만 출력합니다.

요구사항:
- 원어민 수준의 자연스러운 한국어 — 기계번역 금지, 직역 금지
- 짧은 영상에 어울리는 친근한 구어체 (반말 또는 친근한 존댓말)
- 한국어 숏폼/유튜브 쇼츠/릴스에서 실제로 쓰이는 표현
- 한 줄 = 짧은 한 문장, 쉼표 또는 마침표로 끝맺음
- 원본의 훅(첫 3초)과 감정 흐름 유지
- 길이와 리듬 비슷하게
- 한국어만 출력, 중국어/영어/설명 금지

예시:
- "你练了三个月" → "삼 개월 동안 운동했는데"
- "体重没掉一斤" → "몸무게는 그대로야"
- "其实这才是减脂最牛的信号" → "근데 이게 사실 진짜 살 빠지고 있다는 신호거든"`,
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
    if (text.startsWith('__cleaned_audio__')) {
      try {
        const p = JSON.parse(text.slice('__cleaned_audio__'.length))
        displayText = `音频剪辑：${p.original_duration?.toFixed(1)}s → ${p.duration?.toFixed(1)}s`
      } catch { /* keep raw */ }
    }
    if (text.startsWith('__digital_human_video__')) {
      try {
        const p = JSON.parse(text.slice('__digital_human_video__'.length))
        const dur = p.duration_ms ? `${(p.duration_ms / 1000).toFixed(1)}s` : ''
        displayText = `数字人视频${dur ? ` · ${dur}` : ''}`
      } catch { /* keep raw */ }
    }
    if (text.startsWith('__dialect__')) {
      const m = text.match(/^__dialect__(\w+)__/)
      const labelMap: Record<string, string> = {
        cantonese: '粤语', sichuan: '川渝', northeast: '东北', tianjin: '天津',
        taiwanese: '台湾', hunan: '湖南', henan: '河南',
        japanese: '日语', english: '英语', korean: '韩语',
        french: '法语', german: '德语', spanish: '西语', italian: '意语',
        russian: '俄语', thai: '泰语', vietnamese: '越南语',
        indonesian: '印尼语', malay: '马来语', filipino: '菲语',
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
        }, ctrl.signal, 'dialect')
        store.updateLastAssistantBlocks(convId, [makeScriptCard(newScript)])
        return
      }

      // 数字人视频生成完成: 直接展示视频
      if (text.startsWith('__digital_human_video__')) {
        const p = JSON.parse(text.slice('__digital_human_video__'.length))
        store.updateLastAssistantBlocks(convId, [{
          type: 'video_player',
          data: {
            video_url: p.video_url,
            duration_ms: p.duration_ms,
            width: p.width,
            height: p.height,
            audio_label: p.audio_label || '数字人',
            source: 'digital_human',
            text_preview: p.text_preview,
          },
        }])
        return
      }

      // 音频剪辑：直接展示清洗后的音频
      if (text.startsWith('__cleaned_audio__')) {
        const p = JSON.parse(text.slice('__cleaned_audio__'.length))
        store.updateLastAssistantBlocks(convId, [{
          type: 'audio_player',
          data: {
            audio_url: p.audio_url,
            duration_seconds: p.duration,
            voice_label: '剪辑后录音',
            engine: 'narration',
            text_preview: p.transcription?.slice(0, 80),
          },
        }])
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

        // 阿里云长文本是异步任务，需要轮询（前端对用户不暴露引擎名）
        if (data.engine === 'aliyun' && data.task_id) {
          store.updateLastAssistantBlocks(convId, [{ type: 'loading', label: '正在合成音频...' }])
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
              store.updateLastAssistantBlocks(convId, [{ type: 'error', message: td.message || '合成失败' }])
              return
            }
            store.updateLastAssistantBlocks(convId, [{ type: 'loading', label: `正在合成音频...（${(i + 1) * 2}s）` }])
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
