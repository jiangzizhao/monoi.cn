// 闪说 tab — 语音口述写文案. Phase 2 MVP 用浏览器 Web Speech API (中文 ASR 免费立即可用).
// 后续升级 funasr 走 WebSocket (准确度更高, 自部署免费).
//
// 用 chat-style 布局跟创作 tab 对齐: 头部 monoi 头像 + 引导, 主区域显示转写文字, 底部录音控制.

import { useEffect, useRef, useState } from 'react'
import { Mic, Square, Trash2, Languages, Type, AlertCircle, Copy, Check } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

// Web Speech API 在 Chrome 是 webkitSpeechRecognition, Safari/Edge 也类似
type SpeechRecognitionResult = {
  isFinal: boolean
  [index: number]: { transcript: string; confidence: number }
}
type SpeechRecognitionEvent = {
  resultIndex: number
  results: { [index: number]: SpeechRecognitionResult; length: number }
}
type SpeechRecognitionInstance = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: SpeechRecognitionEvent) => void) | null
  onerror: ((e: any) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

export default function VoiceTab() {
  const nav = useNavigate()
  const [isListening, setIsListening] = useState(false)
  const [finalText, setFinalText] = useState('')      // 已确定的文字 (final results 拼接)
  const [interimText, setInterimText] = useState('')  // 实时部分结果 (灰色显示, 说话时变化)
  const [error, setError] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [copied, setCopied] = useState(false)
  // 翻译状态
  const [translatedText, setTranslatedText] = useState('')
  const [translating, setTranslating] = useState(false)

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const wasListeningRef = useRef(false)  // 标记是不是用户主动停 (区分自动断 → 重连)

  // 检测浏览器支持
  const SpeechRecognition = typeof window !== 'undefined'
    ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
    : null
  const isSupported = !!SpeechRecognition

  // elapsed 计时
  useEffect(() => {
    if (!isListening) { setElapsed(0); return }
    const start = Date.now()
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => clearInterval(id)
  }, [isListening])

  const startListening = () => {
    setError('')
    if (!SpeechRecognition) {
      setError('你的浏览器不支持语音识别. 请用 PC 的 Chrome / Edge, 或 Mac 的 Safari')
      return
    }
    try {
      const rec: SpeechRecognitionInstance = new SpeechRecognition()
      rec.lang = 'zh-CN'
      rec.continuous = true      // 不打断, 持续听
      rec.interimResults = true  // 边说边出 partial 文字

      rec.onresult = (event) => {
        let interim = ''
        let finalAdd = ''
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i]
          const transcript = result[0].transcript
          if (result.isFinal) finalAdd += transcript
          else interim += transcript
        }
        if (finalAdd) {
          setFinalText(prev => prev + finalAdd)
        }
        setInterimText(interim)
      }

      rec.onerror = (e: any) => {
        const err = e?.error || 'unknown'
        if (err === 'no-speech') return  // 静音, 不报错
        if (err === 'not-allowed') {
          setError('麦克风权限被拒. 浏览器地址栏锁图标 → 麦克风 → 允许')
          wasListeningRef.current = false
          setIsListening(false)
          return
        }
        if (err === 'aborted') return  // 用户主动停
        console.warn('[asr] error', err, e)
        setError(`识别出错: ${err}. 可以点重新开始`)
      }

      rec.onend = () => {
        // Web Speech API 经常自动断 (没说话几秒), 如果用户没主动停, 自动重连保持持续
        if (wasListeningRef.current) {
          try { rec.start() } catch {
            setIsListening(false)
            wasListeningRef.current = false
          }
        } else {
          setIsListening(false)
        }
      }

      recognitionRef.current = rec
      wasListeningRef.current = true
      setIsListening(true)
      rec.start()
    } catch (e: any) {
      setError(`启动失败: ${e?.message || e}`)
    }
  }

  const stopListening = () => {
    wasListeningRef.current = false
    recognitionRef.current?.stop()
    setIsListening(false)
    setInterimText('')
  }

  const clearAll = () => {
    setFinalText('')
    setInterimText('')
    setTranslatedText('')
  }

  const copyText = async () => {
    if (!finalText) return
    try {
      await navigator.clipboard.writeText(finalText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  // 翻译成英文 — 调 DeepSeek (走 monoi 现有 /api/chat 端点)
  const translateToEnglish = async () => {
    if (!finalText.trim()) return
    setTranslating(true)
    setTranslatedText('')
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: '你是中英翻译, 把用户的中文翻译成自然地道的英文. 只输出翻译结果, 不要解释.',
          messages: [{ role: 'user', content: finalText }],
          stream: false,
        }),
      })
      const data = await res.json()
      const translated = data.choices?.[0]?.message?.content || data.text || data.content || ''
      setTranslatedText(translated.trim())
    } catch (e: any) {
      setError(`翻译失败: ${e?.message || e}`)
    } finally {
      setTranslating(false)
    }
  }

  // 把转写文字送进 monoi 文案流程 (走 __paste_script__ sentinel, useChat 自动转 script_card)
  const sendToScript = () => {
    if (!finalText.trim()) return
    // 通过 localStorage 把文字传给 chat tab 的 ChatInput
    localStorage.setItem('pending_prompt', `__paste_script__${finalText.trim()}`)
    nav('/app/chat')
  }

  // 卸载停掉 recognition
  useEffect(() => () => {
    wasListeningRef.current = false
    try { recognitionRef.current?.stop() } catch {}
  }, [])

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[var(--bg-chat)]">
      {/* 上半: 主内容区 */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-8 flex flex-col gap-4">

          {/* 头像 + 引导 (跟创作 tab WelcomeMessage 一致风格) */}
          <div className="flex items-start gap-3 msg-enter">
            <img src="/logo.png" alt="monoi" className="w-8 h-8 rounded-xl object-contain flex-shrink-0 mt-0.5"/>
            <div className="flex-1 min-w-0 flex flex-col gap-1.5 pt-1">
              <p className="text-[var(--text)] leading-relaxed">
                你好! 闪说功能给你**对着麦克风说**, 实时转成文字写脚本. 录完一键进文案 / 配音 / 合成流程.
              </p>
              <p className="text-sm text-[var(--text-3)]">
                点下面大麦克风开始. 中文识别, 边说边出字, 错的可以改.
              </p>
            </div>
          </div>

          {/* 错误 / 不支持提示 */}
          {error && (
            <div className="text-sm text-red-400 bg-red-950/20 border border-red-900/30 rounded-lg px-3 py-2 flex items-start gap-2">
              <AlertCircle size={14} className="mt-0.5 flex-shrink-0"/>
              <span className="leading-relaxed">{error}</span>
            </div>
          )}
          {!isSupported && (
            <div className="text-sm text-amber-500 bg-amber-50 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-900/50 rounded-lg px-3 py-2 flex items-start gap-2">
              <AlertCircle size={14} className="mt-0.5 flex-shrink-0"/>
              <span className="leading-relaxed">你的浏览器不支持 Web Speech API. 请用 PC Chrome / Edge / Mac Safari. (后续 funasr 上线后所有浏览器都能用)</span>
            </div>
          )}

          {/* 转写文字框 */}
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 min-h-[200px] flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-[var(--text-2)] flex items-center gap-1.5">
                <Type size={12}/> 转写文字 {finalText && `· ${finalText.replace(/\s/g, '').length} 字`}
              </div>
              {finalText && (
                <div className="flex gap-1">
                  <button onClick={copyText}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs text-[var(--text-2)] hover:bg-[var(--bg-hover)] cursor-pointer">
                    {copied ? <><Check size={12}/> 已复制</> : <><Copy size={12}/> 复制</>}
                  </button>
                  <button onClick={clearAll}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs text-red-400 hover:bg-red-950/20 cursor-pointer">
                    <Trash2 size={12}/> 清空
                  </button>
                </div>
              )}
            </div>
            <textarea
              value={finalText + (interimText ? `​${interimText}` : '')}  // ZWSP 区分但不影响视觉
              onChange={(e) => setFinalText(e.target.value.replace(/​.*$/, ''))}
              placeholder={isListening ? '正在听...说点啥' : '点下面麦克风开始录, 或直接打字'}
              className="flex-1 bg-[var(--bg-input)] border border-[var(--border)] rounded-lg p-3 text-sm text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none focus:border-[var(--text-3)] resize-none leading-relaxed"
              style={{ minHeight: '160px' }}
            />
          </div>

          {/* 翻译结果 */}
          {(translatedText || translating) && (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 flex flex-col gap-2">
              <div className="text-xs font-medium text-[var(--text-2)] flex items-center gap-1.5">
                <Languages size={12}/> 英文翻译
              </div>
              {translating ? (
                <div className="text-sm text-[var(--text-3)]">翻译中...</div>
              ) : (
                <div className="text-sm text-[var(--text-2)] leading-relaxed whitespace-pre-wrap">{translatedText}</div>
              )}
            </div>
          )}

          {/* 用这段文字 → 跳 monoi 流程 */}
          {finalText && !isListening && (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 flex flex-col gap-2">
              <div className="text-xs font-medium text-[var(--text-2)]">下一步</div>
              <div className="flex flex-wrap gap-2">
                <button onClick={sendToScript}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[var(--text)] text-[var(--bg)] text-sm hover:opacity-80 cursor-pointer">
                  用这段文字 → 进文案流程
                </button>
                <button onClick={translateToEnglish} disabled={translating}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-[var(--border)] text-[var(--text-2)] text-sm hover:bg-[var(--bg-hover)] cursor-pointer disabled:opacity-50">
                  <Languages size={14}/> 翻译成英文
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 下半: 底部录音控制条 (跟 ChatInput 一致) */}
      <div className="border-t border-[var(--border)] bg-[var(--bg-chat)] px-4 pt-3 pb-4">
        <div className="max-w-3xl mx-auto flex items-center justify-center">
          {!isListening ? (
            <button onClick={startListening} disabled={!isSupported}
              className="flex items-center gap-2 px-6 py-3 rounded-full bg-red-500 hover:bg-red-600 text-white font-medium text-base cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-lg transition-colors">
              <Mic size={18}/> 开始说
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 bg-red-500 text-white px-4 py-2 rounded-full text-sm font-medium">
                <span className="w-2 h-2 rounded-full bg-white animate-pulse"/>
                录音中 {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
              </div>
              <button onClick={stopListening}
                className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-[var(--text)] text-[var(--bg)] text-sm font-medium hover:opacity-80 cursor-pointer">
                <Square size={14} fill="currentColor"/> 停止
              </button>
            </div>
          )}
        </div>
        <p className="text-[10px] text-[var(--text-3)] text-center mt-2">
          浏览器原生中文识别 (Web Speech API). 边说边出字, 错别字可以在上方文字框直接改.
        </p>
      </div>
    </div>
  )
}
