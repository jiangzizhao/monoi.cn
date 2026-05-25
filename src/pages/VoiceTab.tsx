// 闪说 tab — 语音口述写文案 (Phase 2 funasr 真实时).
// 浏览器麦克风 → AudioContext + ScriptProcessor 抓 PCM → 降采样 16kHz int16
// → WebSocket 推 voice-server 的 /ws/asr → funasr 推 partial/final 文字回来.

import { useEffect, useRef, useState } from 'react'
import { Mic, Square, Trash2, Languages, Type, AlertCircle, Copy, Check, Save, History } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { listMyAsrRecords, saveMyAsrRecord, deleteMyAsrRecord, type MyAsrRecord } from '../services/asr'

export default function VoiceTab() {
  const nav = useNavigate()
  const [isListening, setIsListening] = useState(false)
  const [finalText, setFinalText] = useState('')      // 已确定的文字
  const [error, setError] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [copied, setCopied] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle')
  const [micLabel, setMicLabel] = useState<string>('')  // 实际用的麦克风名字
  const [audioLevel, setAudioLevel] = useState<number>(0)  // 0-100 实时音量 (调试用, 让用户能看到麦克风有没有进音)
  const [availableMics, setAvailableMics] = useState<MediaDeviceInfo[]>([])
  const [selectedMicId, setSelectedMicId] = useState<string>('')  // 空 = 系统默认
  // 翻译状态
  const [translatedText, setTranslatedText] = useState('')
  const [translating, setTranslating] = useState(false)
  // 我的闪说历史
  const [myRecords, setMyRecords] = useState<MyAsrRecord[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedJustNow, setSavedJustNow] = useState(false)

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

  // 列出所有麦克风设备 (挂载时拉一次, 给用户选). 未授权时 label 是空, 授权后能看到名字
  const refreshMics = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      setAvailableMics(devices.filter(d => d.kind === 'audioinput'))
    } catch {}
  }
  useEffect(() => {
    refreshMics()
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshMics)
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', refreshMics)
  }, [])

  /** 启动录音 + WebSocket 流式 ASR. */
  const startListening = async () => {
    setError('')
    setConnectionStatus('connecting')

    // 1. 拿麦克风 — 不写死 sampleRate, 让浏览器选 (一般 48000), 客户端再降采样到 16k
    //    selectedMicId 空 = 用系统默认; 有值 = 用用户在下拉里选的那个
    let stream: MediaStream
    try {
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: true, noiseSuppression: true, autoGainControl: true,
      }
      if (selectedMicId) audioConstraints.deviceId = { exact: selectedMicId }
      stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints })
      streamRef.current = stream
      // 诊断: 列出实际拿到的音轨 + label
      const audioTracks = stream.getAudioTracks()
      console.log('[voicetab] 拿到音轨', audioTracks.length, '个:',
        audioTracks.map(t => ({ label: t.label, enabled: t.enabled, muted: t.muted, settings: t.getSettings() })))
      if (audioTracks.length === 0) {
        setError('系统没给出音频轨道. 检查麦克风设备是否正常 + 浏览器是否选了正确的输入')
        setConnectionStatus('error')
        return
      }
      setMicLabel(audioTracks[0].label || '默认麦克风')
      if (audioTracks[0].muted) {
        setError(`麦克风被静音了 (${audioTracks[0].label}). 物理静音按钮 / 系统静音都查一下`)
      }
      // 授权后重新枚举一次, 拿到设备 label (浏览器隐私规则: 没授权时 label 是空)
      await refreshMics()
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
      // 算 RMS 显示音量条 (帮用户判断麦克风有没有进音)
      let sumSq = 0
      for (let i = 0; i < input.length; i++) sumSq += input[i] * input[i]
      const rms = Math.sqrt(sumSq / input.length)
      // RMS 0.01 = 安静背景, 0.1 = 普通说话, 0.3 = 大声
      setAudioLevel(Math.min(100, Math.round(rms * 500)))
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
    setAudioLevel(0)
    setMicLabel('')

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

  // 保存当前转写到"我的闪说"
  const saveCurrent = async () => {
    if (!finalText.trim() || saving) return
    setSaving(true); setError('')
    try {
      await saveMyAsrRecord({
        text: finalText.trim(),
        language: 'zh',
        duration_sec: elapsed,
        title: finalText.trim().slice(0, 30),
      })
      setSavedJustNow(true)
      setTimeout(() => setSavedJustNow(false), 2000)
      // 如果历史面板开着, 顺便刷新
      if (showHistory) refreshHistory()
    } catch (e: any) {
      setError('保存失败: ' + (e?.message || e))
    } finally {
      setSaving(false)
    }
  }

  // 拉历史
  const refreshHistory = async () => {
    try {
      const r = await listMyAsrRecords()
      setMyRecords(r.records || [])
    } catch (e: any) {
      console.warn('[asr] list mine failed:', e?.message || e)
    }
  }
  useEffect(() => {
    if (showHistory) refreshHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHistory])

  // 用某条历史填到当前文本框 (替换/追加都行, 这里直接替换)
  const loadHistoryRecord = (r: MyAsrRecord) => {
    setFinalText(r.text)
    setShowHistory(false)
  }

  // 删历史
  const removeHistory = async (id: number) => {
    if (!confirm('删除这条? 不可恢复.')) return
    try {
      await deleteMyAsrRecord(id)
      setMyRecords(prev => prev.filter(r => r.id !== id))
    } catch (e: any) {
      alert('删除失败: ' + (e?.message || e))
    }
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
                  <button onClick={saveCurrent} disabled={saving || !finalText.trim()}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs text-[var(--text-2)] hover:bg-[var(--bg-hover)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    title="存到'我的闪说', 之后可以回来取">
                    {savedJustNow ? <><Check size={12} className="text-green-500"/> 已存</> : <><Save size={12}/> {saving ? '存中...' : '保存'}</>}
                  </button>
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
            {/* 录音时显示用的哪个麦 + 实时音量条 (帮排查麦克风没进音问题) */}
            {isListening && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 text-[11px] text-[var(--text-3)]">
                  <Mic size={11}/>
                  <span className="truncate flex-1" title={micLabel}>{micLabel || '默认麦克风'}</span>
                  <span className={`font-mono ${audioLevel > 10 ? 'text-green-500' : 'text-amber-500'}`}>
                    {audioLevel > 10 ? '有声音 ✓' : audioLevel > 2 ? '声音小' : '静音 / 没采到'}
                  </span>
                </div>
                {/* 音量条: 绿色填充, 越多越响. 完全空 = 麦克风没进音 */}
                <div className="h-1.5 rounded-full bg-[var(--bg-hover)] overflow-hidden">
                  <div
                    className={`h-full transition-all ${audioLevel > 10 ? 'bg-green-500' : 'bg-amber-500'}`}
                    style={{ width: `${audioLevel}%` }}/>
                </div>
              </div>
            )}
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

          {/* 我的闪说 — 折叠面板, 展开可载入历史转写到当前文本框 */}
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden">
            <button onClick={() => setShowHistory(s => !s)}
              className="w-full flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-[var(--bg-hover)] transition-colors">
              <div className="flex items-center gap-2">
                <History size={14} className="text-[var(--text-3)]"/>
                <span className="text-sm text-[var(--text-2)] font-medium">我的闪说</span>
                {myRecords.length > 0 && (
                  <span className="text-[10px] text-[var(--text-3)]">({myRecords.length})</span>
                )}
              </div>
              <span className="text-[10px] text-[var(--text-3)]">{showHistory ? '收起' : '展开'}</span>
            </button>
            {showHistory && (
              <div className="border-t border-[var(--border)] px-3 py-2 max-h-64 overflow-y-auto">
                {myRecords.length === 0 ? (
                  <div className="text-xs text-[var(--text-3)] text-center py-4">还没保存过. 转写完点上面 "保存" 存到这里.</div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {myRecords.map(r => {
                      const date = new Date(r.created_at * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
                      const preview = r.text.slice(0, 60) + (r.text.length > 60 ? '...' : '')
                      return (
                        <div key={r.id} className="flex items-start gap-2 px-2 py-2 rounded-lg hover:bg-[var(--bg-hover)] group">
                          <div className="flex-1 min-w-0 cursor-pointer" onClick={() => loadHistoryRecord(r)}>
                            <div className="text-xs text-[var(--text)] leading-snug whitespace-pre-wrap break-words">{preview}</div>
                            <div className="text-[10px] text-[var(--text-3)] mt-1">{date} · {r.text.length} 字</div>
                          </div>
                          <button onClick={() => loadHistoryRecord(r)}
                            className="opacity-0 group-hover:opacity-100 text-[10px] text-blue-500 hover:underline cursor-pointer flex-shrink-0">
                            载入
                          </button>
                          <button onClick={() => removeHistory(r.id)}
                            className="opacity-0 group-hover:opacity-100 text-[10px] text-red-400 hover:bg-red-950/20 p-1 rounded cursor-pointer flex-shrink-0">
                            <Trash2 size={11}/>
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

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
        <div className="max-w-3xl mx-auto flex flex-col items-center gap-2">
          {/* 录音前: 麦克风选择下拉 (有 ≥ 2 个 + 未授权时 label 是空时不显示) */}
          {!isListening && availableMics.length > 0 && availableMics.some(m => m.label) && (
            <div className="w-full max-w-md flex items-center gap-2 text-xs">
              <Mic size={12} className="text-[var(--text-3)] flex-shrink-0"/>
              <select value={selectedMicId} onChange={e => setSelectedMicId(e.target.value)}
                className="flex-1 bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-xs text-[var(--text)] cursor-pointer">
                <option value="">系统默认麦克风</option>
                {availableMics.map(m => (
                  <option key={m.deviceId} value={m.deviceId}>{m.label || `设备 ${m.deviceId.slice(0, 8)}`}</option>
                ))}
              </select>
            </div>
          )}
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
      </div>
    </div>
  )
}
