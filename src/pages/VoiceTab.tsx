// 闪说 tab — 语音口述写文案 (Phase 2 funasr 真实时).
// 浏览器麦克风 → AudioContext + ScriptProcessor 抓 PCM → 降采样 16kHz int16
// → WebSocket 推 voice-server 的 /ws/asr → funasr 推 partial/final 文字回来.

import { useEffect, useRef, useState } from 'react'
import { Mic, Square, Trash2, Languages, Type, AlertCircle, Copy, Check } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export default function VoiceTab() {
  const nav = useNavigate()
  const [isListening, setIsListening] = useState(false)
  const [finalText, setFinalText] = useState('')      // 已确定的文字
  const [error, setError] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [copied, setCopied] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle')
  // 翻译状态
  const [translatedText, setTranslatedText] = useState('')
  const [translating, setTranslating] = useState(false)

  // 录音 + ASR 资源 refs (用户停止时全部释放)
  const wsRef = useRef<WebSocket | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)

  // elapsed 计时
  useEffect(() => {
    if (!isListening) { setElapsed(0); return }
    const start = Date.now()
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => clearInterval(id)
  }, [isListening])

  /** 启动录音 + WebSocket 流式 ASR. */
  const startListening = async () => {
    setError('')
    setConnectionStatus('connecting')

    // 1. 拿麦克风
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 },
      })
      streamRef.current = stream
    } catch (e: any) {
      setError(`麦克风获取失败: ${e?.name === 'NotAllowedError' ? '你拒绝了麦克风权限' : e?.message || e}`)
      setConnectionStatus('error')
      return
    }

    // 2. 连 WebSocket — voice-server /ws/asr
    const directBase = (import.meta as any).env?.VITE_DIRECT_API_URL || 'https://monoi.nat100.top'
    const wsUrl = directBase.replace(/^https/, 'wss').replace(/^http/, 'ws') + '/ws/asr'
    const ws = new WebSocket(wsUrl)
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws

    ws.onopen = () => {
      setConnectionStatus('connected')
      // 启动音频管道
      startAudioPipeline(stream)
      setIsListening(true)
    }

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data)
        if (msg.type === 'partial' || msg.type === 'final') {
          // funasr 返的是累积全文 (因为 cache 共享), 直接覆盖 finalText
          setFinalText(msg.text || '')
        } else if (msg.type === 'error') {
          setError(`ASR 错误: ${msg.message}`)
        }
      } catch (e) { console.warn('[asr ws] parse fail', e) }
    }

    ws.onerror = (e) => {
      console.error('[asr ws] error', e)
      setError('WebSocket 连接失败. 检查后端 voice-server 跑着 + NATAPP 通')
      setConnectionStatus('error')
      stopListening()
    }

    ws.onclose = () => {
      setConnectionStatus('idle')
    }
  }

  /** 启动音频 pipeline: AudioContext → MediaStreamSource → ScriptProcessor → 抓 PCM → 降采样 → WS */
  const startAudioPipeline = (stream: MediaStream) => {
    // 浏览器原生采样率一般 48000, 这里我们让 AudioContext 用默认值, 抓完手动降采样到 16000
    const audioContext = new AudioContext()
    audioContextRef.current = audioContext
    const sourceRate = audioContext.sampleRate  // 一般 48000
    const targetRate = 16000
    const downsampleRatio = sourceRate / targetRate

    const source = audioContext.createMediaStreamSource(stream)
    sourceRef.current = source
    // 4096 samples per processing chunk (~85ms @ 48000)
    const processor = audioContext.createScriptProcessor(4096, 1, 1)
    processorRef.current = processor

    processor.onaudioprocess = (e) => {
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      const input = e.inputBuffer.getChannelData(0)  // Float32 [-1, 1]
      // 降采样 sourceRate → 16000 (简单丢点, 语音用足够)
      const outLen = Math.floor(input.length / downsampleRatio)
      const out = new Int16Array(outLen)
      for (let i = 0; i < outLen; i++) {
        const v = input[Math.floor(i * downsampleRatio)]
        out[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32768)))
      }
      ws.send(out.buffer)
    }

    source.connect(processor)
    processor.connect(audioContext.destination)  // 必须 connect 才会触发 onaudioprocess
  }

  /** 停止录音 + 关连接 + 释放所有资源 */
  const stopListening = () => {
    setIsListening(false)
    setConnectionStatus('idle')

    // 关音频管道
    try { processorRef.current?.disconnect() } catch {}
    try { sourceRef.current?.disconnect() } catch {}
    try { audioContextRef.current?.close() } catch {}
    processorRef.current = null
    sourceRef.current = null
    audioContextRef.current = null

    // 关麦克风
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null

    // 关 WebSocket (服务器收到 disconnect 后会做最终推理)
    try { wsRef.current?.close() } catch {}
    wsRef.current = null
  }

  const clearAll = () => {
    setFinalText('')
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

  // 卸载停掉所有 (麦克风 / WebSocket / 音频管道)
  useEffect(() => () => {
    try { processorRef.current?.disconnect() } catch {}
    try { sourceRef.current?.disconnect() } catch {}
    try { audioContextRef.current?.close() } catch {}
    streamRef.current?.getTracks().forEach(t => t.stop())
    try { wsRef.current?.close() } catch {}
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
          {connectionStatus === 'connecting' && (
            <div className="text-sm text-[var(--text-3)] bg-[var(--bg-card)] border border-[var(--border)] rounded-lg px-3 py-2">
              连接 funasr 服务... (第一次用 voice-server 要加载 ~500MB 模型, 等 30 秒)
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
              value={finalText}
              onChange={(e) => setFinalText(e.target.value)}
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
            <button onClick={startListening} disabled={connectionStatus === 'connecting'}
              className="flex items-center gap-2 px-6 py-3 rounded-full bg-red-500 hover:bg-red-600 text-white font-medium text-base cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-lg transition-colors">
              <Mic size={18}/> {connectionStatus === 'connecting' ? '连接中...' : '开始说'}
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
