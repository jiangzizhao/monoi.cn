import { useEffect, useMemo, useState } from 'react'

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
  if (mode === 'upload') return '配音 · 上传录音'
  return '配音 · 克隆声音'
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
  const [sampleSec, setSampleSec] = useState('')
  const [genderFilter, setGenderFilter] = useState<'all' | 'female' | 'male'>('all')

  const selectedVoice = useMemo(() => voiceOptions.find(v => v.id === voice), [voiceOptions, voice])

  // 按 gender 过滤后再按 category 分组
  const groupedVoices = useMemo(() => {
    const filtered = voiceOptions.filter(v => genderFilter === 'all' || v.gender === genderFilter)
    const groups: Record<string, VoiceOption[]> = { preset: [], dialect: [], language: [] }
    for (const v of filtered) {
      const cat = v.category || 'preset'
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(v)
    }
    return groups
  }, [voiceOptions, genderFilter])

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

  const submitUpload = () => {
    const msg =
      `【配音-上传录音】文件：${fileName || '未命名音频'}，` +
      `格式要求：MP3/WAV，补充要求：${notes.trim() || '无'}。` +
      `请继续告诉我下一步如何对齐文案和节奏。`
    onSubmit(msg)
  }

  const submitClone = () => {
    const seconds = Number(sampleSec || '0')
    const msg =
      `【配音-克隆声音】样本文件：${fileName || '未命名音频'}，样本时长：${seconds || 0}秒，` +
      `用途：用于后续文案TTS。请给我克隆前检查清单和下一步操作。`
    onSubmit(msg)
  }

  const onFilePick = (file: File | null) => {
    setFileName(file?.name || '')
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose}/>
      <div className="fixed left-1/2 top-1/2 z-50 w-[min(680px,calc(100vw-2rem))] max-h-[90vh] -translate-x-1/2 -translate-y-1/2 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden flex flex-col">
        <div className="px-4 py-2.5 border-b border-[var(--border)]">
          <span className="text-xs text-[var(--text-3)]">{formTitle(mode)}</span>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3 min-h-0">
          {mode === 'preset' && (
            <>
              {/* 性别筛选 */}
              <div className="flex gap-1.5 sticky top-0 bg-[var(--bg-card)] py-1 z-10">
                {(['all', 'female', 'male'] as const).map(g => (
                  <button
                    key={g}
                    onClick={() => setGenderFilter(g)}
                    className={`px-3 py-1 rounded-full text-xs cursor-pointer border transition-colors ${
                      genderFilter === g
                        ? 'border-[var(--text-2)] bg-[var(--bg-hover)] text-[var(--text)]'
                        : 'border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text)]'
                    }`}
                  >
                    {g === 'all' ? '全部' : GENDER_LABELS[g]}
                  </button>
                ))}
              </div>

              {/* 按 category 分组展示 */}
              <div className="flex flex-col gap-3 pr-1">
                {(['preset', 'dialect', 'language'] as const).map(cat => {
                  const items = groupedVoices[cat] || []
                  if (items.length === 0) return null
                  return (
                    <div key={cat} className="flex flex-col gap-1.5">
                      <div className="text-xs text-[var(--text-3)]">{CATEGORY_LABELS[cat]}</div>
                      <div className="grid grid-cols-2 gap-2">
                        {items.map(v => (
                          <button
                            key={v.id}
                            onClick={() => setVoice(v.id)}
                            className={`text-left px-3 py-2 rounded-lg border transition-colors cursor-pointer ${
                              voice === v.id
                                ? 'border-[var(--text-2)] bg-[var(--bg-hover)]'
                                : 'border-[var(--border)] hover:bg-[var(--bg-hover)]'
                            }`}
                          >
                            <div className="text-sm text-[var(--text)] flex items-center gap-1.5">
                              {v.label}
                              {v.gender && (
                                <span className="text-[10px] text-[var(--text-3)] px-1 py-px rounded bg-[var(--bg-hover)]">
                                  {GENDER_LABELS[v.gender] || v.gender}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-[var(--text-3)] mt-0.5 line-clamp-1">{v.desc}</div>
                          </button>
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

          {mode !== 'preset' && (
            <div className="flex flex-col gap-2">
              <input
                type="file"
                accept=".mp3,.wav,audio/mpeg,audio/wav"
                onChange={e => onFilePick(e.target.files?.[0] || null)}
                className="text-sm text-[var(--text-2)] file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border file:border-[var(--border)] file:bg-[var(--bg-hover)] file:text-[var(--text)]"
              />
              {fileName && <div className="text-xs text-[var(--text-3)]">已选择：{fileName}</div>}
            </div>
          )}

          {mode === 'clone' && (
            <input
              value={sampleSec}
              onChange={e => setSampleSec(e.target.value.replace(/[^\d]/g, ''))}
              placeholder="样本时长（秒，建议 >= 30）"
              className="bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none"
            />
          )}

          <textarea
            rows={2}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="补充要求（可选）"
            className="bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none resize-none"
          />
        </div>

        {/* Footer 固定底部 */}
        <div className="px-4 py-2.5 border-t border-[var(--border)] flex justify-end gap-2 bg-[var(--bg-card)]">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-sm text-[var(--text-2)] hover:bg-[var(--bg-hover)] cursor-pointer"
            >
              取消
            </button>
            <button
              onClick={() => {
                if (mode === 'preset') submitPreset()
                if (mode === 'upload') submitUpload()
                if (mode === 'clone') submitClone()
              }}
              className="px-3 py-1.5 rounded-lg text-sm bg-[var(--text)] text-[var(--bg)] hover:opacity-80 cursor-pointer"
            >
              继续
            </button>
        </div>
      </div>
    </>
  )
}
