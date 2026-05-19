import { useEffect, useMemo, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Play, Pause, Loader2 } from 'lucide-react'
import { NarrationEditor } from '../NarrationEditor'
import { getToken } from '../../../lib/auth'

type Mode = 'preset' | 'upload' | 'clone'

interface Props {
  mode: Mode
  onSubmit: (message: string) => void
  onClose: () => void
}

interface VoiceOption {
  id: string
  label: string
  desc: string
  gender?: string   // male | female
  category?: string // preset | dialect | language
  accent?: string
}

const CATEGORY_LABELS: Record<string, string> = {
  clone: '我的克隆',
  preset: '普通话',
  dialect: '方言',
  language: '外语',
}
const GENDER_LABELS: Record<string, string> = {
  female: '女声',
  male: '男声',
}

const SPEEDS = ['0.9x', '1.0x', '1.1x', '1.2x']

function formTitle(mode: Mode) {
  if (mode === 'preset') return '配音 · 预设音色'
  if (mode === 'upload') return '配音 · 音频剪辑'
  return '配音 · 克隆声音'
}

function VoiceCard({ voice, selected, playing, loading, onSelect, onPreview }: {
  voice: VoiceOption
  selected: boolean
  playing: boolean
  loading: boolean
  onSelect: () => void
  onPreview: () => void
}) {
  return (
    <div
      onClick={onSelect}
      className={`text-left px-3 py-2 rounded-lg border transition-colors cursor-pointer flex items-start gap-2 ${
        selected ? 'border-[var(--text-2)] bg-[var(--bg-hover)]' : 'border-[var(--border)] hover:bg-[var(--bg-hover)]'
      }`}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onPreview() }}
        className="w-7 h-7 rounded-full bg-[var(--bg-input)] hover:bg-[var(--text)] hover:text-[var(--bg)] text-[var(--text-2)] flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors"
        title="试听"
      >
        {loading ? <Loader2 size={12} className="animate-spin"/> : playing ? <Pause size={12} fill="currentColor"/> : <Play size={12} fill="currentColor" className="ml-0.5"/>}
      </button>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-[var(--text)] flex items-center gap-1.5">
          {voice.label}
          {voice.gender && (
            <span className="text-[10px] text-[var(--text-3)] px-1 py-px rounded bg-[var(--bg-hover)]">
              {GENDER_LABELS[voice.gender] || voice.gender}
            </span>
          )}
        </div>
        <div className="text-xs text-[var(--text-3)] mt-0.5 line-clamp-1">{voice.desc}</div>
      </div>
    </div>
  )
}

export function VoiceForm({ mode, onSubmit, onClose }: Props) {
  const [voiceOptions, setVoiceOptions] = useState<VoiceOption[]>([])
  const [presetLoading, setPresetLoading] = useState(false)
  const [presetError, setPresetError] = useState('')
  const [voice, setVoice] = useState('')
  const [speed, setSpeed] = useState('1.0x')
  const [emotion, setEmotion] = useState('自然')
  const [notes, setNotes] = useState('')
  const [fileName, setFileName] = useState('')
  const [fileObj, setFileObj] = useState<File | null>(null)
  const [cloneName, setCloneName] = useState('')
  const [cloneGender, setCloneGender] = useState<'female' | 'male'>('female')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [myClones, setMyClones] = useState<VoiceOption[]>([])
  const [cloneMaxReached, setCloneMaxReached] = useState(false)
  const [showCloneUpload, setShowCloneUpload] = useState(false)
  const [cleanResult, setCleanResult] = useState<any>(null)
  // tab 过滤: 全部 / 女声(普通话女) / 男声(普通话男) / 方言 / 外语
  const [tabFilter, setTabFilter] = useState<'all' | 'female' | 'male' | 'dialect' | 'language'>('all')
  const [previewPlaying, setPreviewPlaying] = useState<string>('')
  const [previewLoading, setPreviewLoading] = useState<string>('')
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const previewTargetRef = useRef<string>('')

  const togglePreview = async (voiceId: string) => {
    // 当前播放就暂停
    if (previewPlaying === voiceId) {
      audioRef.current?.pause()
      setPreviewPlaying('')
      return
    }
    // 切换音色，先停旧的
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    previewTargetRef.current = voiceId
    setPreviewLoading(voiceId)
    setPreviewPlaying('')

    const url = '/api/proxy?path=' + encodeURIComponent('/api/voice/preview/' + voiceId)

    // 先用 fetch 试探：如果是 audio/wav，直接 Audio 播；如果是 202 JSON，轮询
    for (let i = 0; i < 45; i++) {
      if (previewTargetRef.current !== voiceId) return  // 用户切换了
      try {
        const res = await fetch(url, { cache: 'no-store' })
        const ct = res.headers.get('content-type') || ''
        if (res.ok && ct.includes('audio')) {
          const blob = await res.blob()
          const blobUrl = URL.createObjectURL(blob)
          const audio = new Audio(blobUrl)
          audioRef.current = audio
          setPreviewLoading('')
          setPreviewPlaying(voiceId)
          audio.onended = () => { setPreviewPlaying(''); URL.revokeObjectURL(blobUrl) }
          await audio.play().catch(() => setPreviewPlaying(''))
          return
        }
        if (res.status === 202) {
          // 后台生成中，等 2 秒再试
          await new Promise(r => setTimeout(r, 2000))
          continue
        }
        // 其他错误
        console.error('preview error', res.status, await res.text())
        setPreviewLoading('')
        return
      } catch (e) {
        console.error('preview fetch error', e)
        setPreviewLoading('')
        return
      }
    }
    setPreviewLoading('')
  }

  // 卸载时停掉
  useEffect(() => () => {
    audioRef.current?.pause()
    audioRef.current = null
  }, [])

  const selectedVoice = useMemo(() => voiceOptions.find(v => v.id === voice), [voiceOptions, voice])

  // 按 tab 过滤后再按 category 分组
  // tab 规则:
  //   all      → 所有
  //   female   → 普通话女声 (category=preset & gender=female), 含 cosyvoice 莫小本
  //   male     → 普通话男声 (category=preset & gender=male)
  //   dialect  → 所有方言 (含粤语/川/东北 等)
  //   language → 所有外语
  // 用户克隆 (clone) 始终显示在 "全部" 中,其他 tab 不显示克隆
  const groupedVoices = useMemo(() => {
    const filtered = voiceOptions.filter(v => {
      const cat = v.category || 'preset'
      if (tabFilter === 'all') return true
      if (tabFilter === 'female') return cat === 'preset' && v.gender === 'female'
      if (tabFilter === 'male')   return cat === 'preset' && v.gender === 'male'
      if (tabFilter === 'dialect')  return cat === 'dialect'
      if (tabFilter === 'language') return cat === 'language'
      return true
    })
    const groups: Record<string, VoiceOption[]> = { clone: [], preset: [], dialect: [], language: [] }
    for (const v of filtered) {
      const cat = v.category || 'preset'
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(v)
    }
    return groups
  }, [voiceOptions, tabFilter])

  // 加载用户克隆列表（克隆模式时）
  const loadMyClones = async () => {
    try {
      const res = await fetch('/api/proxy?path=' + encodeURIComponent('/api/voice/my-clones'))
      const data = await res.json()
      const items = Array.isArray(data.items) ? data.items : []
      setMyClones(items.map((it: any) => ({
        id: String(it.key),
        label: String(it.name),
        desc: it.sample_text || '我的克隆',
        gender: it.gender,
        category: 'clone',
      })))
      setCloneMaxReached((data.current_count || 0) >= (data.max_count || 5))
      // 第一次进来如果还没有克隆，直接展开上传
      if (mode === 'clone' && items.length === 0) setShowCloneUpload(true)
    } catch {
      setMyClones([])
    }
  }

  useEffect(() => {
    if (mode === 'clone') {
      loadMyClones()
    }
  }, [mode])

  const deleteClone = async (key: string) => {
    if (!confirm('确认删除这个克隆音色？')) return
    try {
      await fetch('/api/proxy?path=' + encodeURIComponent('/api/voice/clone/' + key), { method: 'DELETE' })
      await loadMyClones()
    } catch (e) { console.error(e) }
  }

  useEffect(() => {
    if (mode !== 'preset') return
    let mounted = true
    setPresetLoading(true)
    setPresetError('')
    fetch('/api/proxy?path=' + encodeURIComponent('/api/voice/presets'))
      .then(async (res) => {
        if (!res.ok) throw new Error(`API ${res.status}`)
        const data = await res.json()
        return Array.isArray(data.items) ? data.items : []
      })
      .then((items: any[]) => {
        if (!mounted) return
        const mapped: VoiceOption[] = items.map((it) => ({
          id: String(it.key || it.id),
          label: String(it.name || '未命名音色'),
          desc: it.sample_text || `${it.engine || ''}${it.accent ? ` · ${it.accent}` : ''}`.replace(/^ · /, '') || '通用音色',
          gender: it.gender,
          category: it.category,
          accent: it.accent,
        }))
        if (mapped.length > 0) {
          setVoiceOptions(mapped)
          setVoice(mapped[0].id)
        }
      })
      .catch(() => {
        if (!mounted) return
        setPresetError('预设音色加载失败，请检查后端服务')
      })
      .finally(() => {
        if (!mounted) return
        setPresetLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [mode])

  const submitPreset = () => {
    // 用 JSON 字符串编码合成参数，useChat 检测到这个前缀直接调合成接口（不走 AI）
    const payload = {
      voice_id: voice,
      voice_label: selectedVoice?.label || voice,
      speed,
      emotion,
      notes: notes.trim(),
    }
    onSubmit(`__synth_voice__${JSON.stringify(payload)}`)
  }

  const submitUpload = async () => {
    if (!fileObj) {
      setUploadError('请先选择音频文件')
      return
    }
    setUploading(true)
    setUploadError('')
    setCleanResult(null)
    try {
      const fd = new FormData()
      fd.append('file', fileObj)
      fd.append('reference_text', notes.trim())
      // 大文件直传后端，绕开 Vercel 4.5MB 限制
      // 生产部署时改 Vercel 环境变量 VITE_DIRECT_API_URL
      const directBase = import.meta.env.VITE_DIRECT_API_URL || 'https://monoi.nat100.top'
      const res = await fetch(directBase + '/api/voice/clean-narration', {
        method: 'POST',
        body: fd,
        headers: { Authorization: `Bearer ${getToken() || ''}` },
      })
      const text = await res.text()
      let data: any
      try { data = JSON.parse(text) } catch { data = { error: text.slice(0, 200) } }
      if (!res.ok || !data.success) {
        setUploadError(data.detail || data.error || `处理失败 (HTTP ${res.status})`)
        return
      }
      // 直传后 audio_url_path 是后端的相对路径，需要补全成完整域名
      if (data.audio_url_path && data.audio_url_path.startsWith('/')) {
        data.audio_url_full = directBase + data.audio_url_path
      }
      setCleanResult(data)
    } catch (e: any) {
      setUploadError(e.message || '处理失败')
    } finally {
      setUploading(false)
    }
  }

  const useCleanedAudio = () => {
    if (!cleanResult) return
    onSubmit(`__cleaned_audio__${JSON.stringify({
      audio_url: cleanResult.audio_url_full || cleanResult.audio_url,
      duration: cleanResult.cleaned_duration,
      original_duration: cleanResult.original_duration,
      transcription: cleanResult.transcription,
    })}`)
  }

  const submitClone = async () => {
    if (!fileObj) {
      setUploadError('请先选择音频文件')
      return
    }
    if (!cloneName.trim()) {
      setUploadError('请填写音色名称')
      return
    }
    setUploading(true)
    setUploadError('')
    try {
      const fd = new FormData()
      fd.append('file', fileObj)
      fd.append('clone_name', cloneName.trim())
      fd.append('transcript', notes.trim())
      fd.append('gender', cloneGender)
      const res = await fetch('/api/proxy?path=' + encodeURIComponent('/api/voice/upload-clone'), {
        method: 'POST',
        body: fd,
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        setUploadError(data.detail || data.error || '上传失败')
        return
      }
      // 上传成功，刷新列表，回到列表视图
      setShowCloneUpload(false)
      setCloneName('')
      setFileObj(null)
      setFileName('')
      setNotes('')
      await loadMyClones()
    } catch (e: any) {
      setUploadError(e.message || '上传失败')
    } finally {
      setUploading(false)
    }
  }

  // 用克隆音色合成（与预设逻辑一致）
  const submitWithClone = (cloneKey: string) => {
    const c = myClones.find(x => x.id === cloneKey)
    const payload = {
      voice_id: cloneKey,
      voice_label: c?.label || cloneKey,
      speed,
      emotion,
      notes: notes.trim(),
    }
    onSubmit(`__synth_voice__${JSON.stringify(payload)}`)
  }

  const onFilePick = (file: File | null) => {
    setFileName(file?.name || '')
    setFileObj(file)
    setUploadError('')
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}/>
      <div className="relative w-[min(680px,100%)] max-h-[85vh] bg-[var(--bg-card)] border border-[var(--border)] rounded-[22px] shadow-ios-lg overflow-hidden flex flex-col sheet-enter">
        <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
          <span className="text-base font-semibold text-[var(--text)]">{formTitle(mode)}</span>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-[var(--bg-hover)] text-[var(--text-2)] flex items-center justify-center hover:text-[var(--text)] cursor-pointer"
            title="关闭"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3 min-h-0">
          {mode === 'preset' && (
            <>
              {/* 分类 tab: 全部 / 女声 / 男声 / 方言 / 外语 */}
              <div className="flex gap-1.5 sticky top-0 bg-[var(--bg-card)] py-1 z-10 flex-wrap">
                {([
                  ['all',      '全部'],
                  ['female',   '女声'],
                  ['male',     '男声'],
                  ['dialect',  '方言'],
                  ['language', '外语'],
                ] as const).map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setTabFilter(k)}
                    className={`px-3 py-1 rounded-full text-xs cursor-pointer border transition-colors ${
                      tabFilter === k
                        ? 'border-[var(--text-2)] bg-[var(--bg-hover)] text-[var(--text)]'
                        : 'border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text)]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* 按 category 分组展示 */}
              <div className="flex flex-col gap-3 pr-1">
                {(['clone', 'preset', 'dialect', 'language'] as const).map(cat => {
                  const items = groupedVoices[cat] || []
                  if (items.length === 0) return null
                  return (
                    <div key={cat} className="flex flex-col gap-1.5">
                      <div className="text-xs text-[var(--text-3)]">{CATEGORY_LABELS[cat]}</div>
                      <div className="grid grid-cols-2 gap-2">
                        {items.map(v => (
                          <VoiceCard
                            key={v.id}
                            voice={v}
                            selected={voice === v.id}
                            playing={previewPlaying === v.id}
                            loading={previewLoading === v.id}
                            onSelect={() => setVoice(v.id)}
                            onPreview={() => togglePreview(v.id)}
                          />
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>

              {presetLoading && <div className="text-xs text-[var(--text-3)]">正在加载预设音色...</div>}
              {presetError && <div className="text-xs text-amber-400">{presetError}</div>}
              <div className="flex gap-2">
                <select
                  value={speed}
                  onChange={e => setSpeed(e.target.value)}
                  className="flex-1 bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:outline-none"
                >
                  {SPEEDS.map(s => <option key={s} value={s}>{`语速 ${s}`}</option>)}
                </select>
                <input
                  value={emotion}
                  onChange={e => setEmotion(e.target.value)}
                  placeholder="情绪（自然/热情/克制）"
                  className="flex-1 bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none"
                />
              </div>
            </>
          )}

          {mode === 'upload' && !cleanResult && (
            <div className="flex flex-col gap-2">
              <input
                type="file"
                accept=".mp3,.wav,.m4a,audio/*"
                onChange={e => onFilePick(e.target.files?.[0] || null)}
                className="text-sm text-[var(--text-2)] file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border file:border-[var(--border)] file:bg-[var(--bg-hover)] file:text-[var(--text)]"
              />
              {fileName && <div className="text-xs text-[var(--text-3)]">已选择：{fileName}</div>}
              <div className="text-xs text-[var(--text-3)] leading-relaxed">
                上传你录好的口播音频，系统自动去掉：<br/>
                · 长时间停顿（&gt; 0.6 秒静音）<br/>
                · 口误重复（说错重念的段落）<br/>
                <br/>
                可选：在下方"补充要求"贴入文案原稿，提升匹配精度。
              </div>
              {uploadError && <div className="text-xs text-red-400">{uploadError}</div>}
            </div>
          )}

          {mode === 'upload' && cleanResult && (
            <NarrationEditor
              data={cleanResult as any}
              apiBase={import.meta.env.VITE_DIRECT_API_URL || 'https://monoi.nat100.top'}
              onCancel={() => { setCleanResult(null); setFileObj(null); setFileName('') }}
              onDone={(audioUrl, duration, transcription) => {
                onSubmit(`__cleaned_audio__${JSON.stringify({
                  audio_url: audioUrl,
                  duration,
                  original_duration: (cleanResult as any).duration,
                  transcription,
                })}`)
              }}
            />
          )}

          {mode === 'clone' && !showCloneUpload && (
            <>
              {/* 已有克隆列表 */}
              <div className="flex items-center justify-between">
                <div className="text-xs text-[var(--text-3)]">我的克隆（{myClones.length}/5）</div>
                {!cloneMaxReached && (
                  <button
                    type="button"
                    onClick={() => { setShowCloneUpload(true); setUploadError('') }}
                    className="text-xs px-2.5 py-1 rounded-lg border border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] cursor-pointer"
                  >
                    + 上传新声音
                  </button>
                )}
              </div>
              {myClones.length === 0 ? (
                <div className="text-xs text-[var(--text-3)] py-4 text-center">还没有克隆声音，上传一段你的录音开始</div>
              ) : (
                <div className="grid grid-cols-1 gap-2">
                  {myClones.map(c => (
                    <div
                      key={c.id}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors cursor-pointer ${
                        voice === c.id
                          ? 'border-[var(--text-2)] bg-[var(--bg-hover)]'
                          : 'border-[var(--border)] hover:bg-[var(--bg-hover)]'
                      }`}
                      onClick={() => setVoice(c.id)}
                    >
                      <button
                        onClick={(e) => { e.stopPropagation(); togglePreview(c.id) }}
                        className="w-7 h-7 rounded-full bg-[var(--bg-input)] hover:bg-[var(--text)] hover:text-[var(--bg)] text-[var(--text-2)] flex items-center justify-center flex-shrink-0 transition-colors"
                        title="试听"
                      >
                        {previewLoading === c.id ? <Loader2 size={12} className="animate-spin"/> : previewPlaying === c.id ? <Pause size={12} fill="currentColor"/> : <Play size={12} fill="currentColor" className="ml-0.5"/>}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-[var(--text)] flex items-center gap-1.5">
                          {c.label}
                          {c.gender && <span className="text-[10px] text-[var(--text-3)] px-1 py-px rounded bg-[var(--bg-hover)]">{GENDER_LABELS[c.gender] || c.gender}</span>}
                        </div>
                        <div className="text-xs text-[var(--text-3)] mt-0.5 line-clamp-1">{c.desc}</div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteClone(c.id) }}
                        className="text-xs px-2 py-1 rounded text-[var(--text-3)] hover:text-red-400 hover:bg-red-950/20 cursor-pointer"
                        title="删除"
                      >
                        删除
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {mode === 'clone' && showCloneUpload && (
            <>
              <div className="flex items-center justify-between">
                <div className="text-xs text-[var(--text-3)]">上传新克隆</div>
                <button
                  type="button"
                  onClick={() => setShowCloneUpload(false)}
                  className="text-xs px-2 py-1 rounded text-[var(--text-3)] hover:text-[var(--text)]"
                >
                  ← 返回列表
                </button>
              </div>
              <input
                type="file"
                accept=".mp3,.wav,audio/mpeg,audio/wav"
                onChange={e => onFilePick(e.target.files?.[0] || null)}
                className="text-sm text-[var(--text-2)] file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border file:border-[var(--border)] file:bg-[var(--bg-hover)] file:text-[var(--text)]"
              />
              {fileName && <div className="text-xs text-[var(--text-3)]">已选择：{fileName}</div>}
              <input
                value={cloneName}
                onChange={e => setCloneName(e.target.value)}
                placeholder="给这个声音起个名字（如：我的声音）"
                className="bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none"
              />
              <div className="flex gap-1.5">
                {(['female', 'male'] as const).map(g => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setCloneGender(g)}
                    className={`px-3 py-1 rounded-full text-xs cursor-pointer border transition-colors ${
                      cloneGender === g ? 'border-[var(--text-2)] bg-[var(--bg-hover)] text-[var(--text)]' : 'border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text)]'
                    }`}
                  >
                    {GENDER_LABELS[g]}
                  </button>
                ))}
              </div>
              <div className="text-xs text-[var(--text-3)]">
                录音建议：5-10 秒，安静环境，自然语速。文件中念的内容填到下方"补充要求"能提升相似度。
              </div>
              {uploadError && <div className="text-xs text-red-400">{uploadError}</div>}
            </>
          )}

          {!(mode === 'upload' && cleanResult) && (
            <textarea
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="补充要求（可选）"
              className="bg-[var(--bg-input)] border border-[var(--border)] rounded-[12px] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none resize-none"
            />
          )}
        </div>

        {/* Footer 固定底部（剪辑器有自己的按钮） */}
        {!(mode === 'upload' && cleanResult) && (
        <div className="px-4 py-2.5 border-t border-[var(--border)] flex justify-end gap-2 bg-[var(--bg-card)]">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-sm text-[var(--text-2)] hover:bg-[var(--bg-hover)] cursor-pointer"
            >
              取消
            </button>
            <button
              disabled={
                uploading ||
                (mode === 'clone' && !showCloneUpload && !voice) ||
                (mode === 'upload' && !cleanResult && !fileObj)
              }
              onClick={() => {
                if (mode === 'preset') submitPreset()
                if (mode === 'upload') {
                  if (cleanResult) useCleanedAudio()
                  else submitUpload()
                }
                if (mode === 'clone') {
                  if (showCloneUpload) submitClone()
                  else if (voice) submitWithClone(voice)
                }
              }}
              className="px-3 py-1.5 rounded-lg text-sm bg-[var(--text)] text-[var(--bg)] hover:opacity-80 cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
            >
              {uploading && <Loader2 size={12} className="animate-spin"/>}
              {mode === 'upload' && !cleanResult && (uploading ? '处理中...' : '开始处理')}
              {mode === 'upload' && cleanResult && '使用这段音频'}
              {mode === 'clone' && showCloneUpload && (uploading ? '上传中...' : '上传')}
              {mode === 'clone' && !showCloneUpload && '使用选中的克隆'}
              {mode === 'preset' && '继续'}
            </button>
        </div>
        )}
      </div>
    </div>,
    document.body
  )
}
