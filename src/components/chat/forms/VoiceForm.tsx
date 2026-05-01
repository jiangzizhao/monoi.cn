import { useEffect, useMemo, useState } from 'react'

type Mode = 'preset' | 'upload' | 'clone'

interface Props {
  mode: Mode
  onSubmit: (message: string) => void
  onClose: () => void
}

const VOICES = [
  { id: 'warm_female', label: '温柔女声', desc: '适合情感、生活方式' },
  { id: 'steady_male', label: '沉稳男声', desc: '适合知识、商业表达' },
  { id: 'young_female', label: '活力女声', desc: '适合种草、快节奏短视频' },
  { id: 'narrator_male', label: '旁白男声', desc: '适合故事与纪录感内容' },
]

const SPEEDS = ['0.9x', '1.0x', '1.1x', '1.2x']

function formTitle(mode: Mode) {
  if (mode === 'preset') return '配音 · 预设音色'
  if (mode === 'upload') return '配音 · 上传录音'
  return '配音 · 克隆声音'
}

export function VoiceForm({ mode, onSubmit, onClose }: Props) {
  const [voiceOptions, setVoiceOptions] = useState(VOICES)
  const [presetLoading, setPresetLoading] = useState(false)
  const [presetError, setPresetError] = useState('')
  const [voice, setVoice] = useState(VOICES[0].id)
  const [speed, setSpeed] = useState('1.0x')
  const [emotion, setEmotion] = useState('自然')
  const [notes, setNotes] = useState('')
  const [fileName, setFileName] = useState('')
  const [sampleSec, setSampleSec] = useState('')

  const selectedVoice = useMemo(() => voiceOptions.find(v => v.id === voice), [voiceOptions, voice])

  useEffect(() => {
    if (mode !== 'preset') return
    let mounted = true
    setPresetLoading(true)
    setPresetError('')
    fetch('/api/voice/presets')
      .then(async (res) => {
        if (!res.ok) throw new Error(`API ${res.status}`)
        const data = await res.json()
        return Array.isArray(data.items) ? data.items : []
      })
      .then((items: any[]) => {
        if (!mounted) return
        const mapped = items.map((it) => ({
          id: String(it.key || it.id),
          label: String(it.name || '未命名音色'),
          desc: `${it.engine || ''}${it.accent ? ` · ${it.accent}` : ''}${it.emotion ? ` · ${it.emotion}` : ''}`.replace(/^ · /, '') || '通用音色',
        }))
        if (mapped.length > 0) {
          setVoiceOptions(mapped)
          setVoice(mapped[0].id)
        }
      })
      .catch(() => {
        if (!mounted) return
        setPresetError('预设音色加载失败，已使用本地默认列表')
        setVoiceOptions(VOICES)
        setVoice(VOICES[0].id)
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
    const msg =
      `【配音-预设音色】音色：${selectedVoice?.label}，语速：${speed}，情绪：${emotion}` +
      `${notes.trim() ? `，补充要求：${notes.trim()}` : ''}`
    onSubmit(msg)
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
      <div className="fixed inset-0 z-40" onClick={onClose}/>
      <div className="fixed left-1/2 top-1/2 z-50 w-[min(680px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-[var(--border)]">
          <span className="text-xs text-[var(--text-3)]">{formTitle(mode)}</span>
        </div>

        <div className="px-4 py-3 flex flex-col gap-3">
          {mode === 'preset' && (
            <>
              <div className="grid grid-cols-2 gap-2">
                {voiceOptions.map(v => (
                  <button
                    key={v.id}
                    onClick={() => setVoice(v.id)}
                    className={`text-left px-3 py-2 rounded-lg border transition-colors cursor-pointer ${
                      voice === v.id
                        ? 'border-[var(--text-2)] bg-[var(--bg-hover)]'
                        : 'border-[var(--border)] hover:bg-[var(--bg-hover)]'
                    }`}
                  >
                    <div className="text-sm text-[var(--text)]">{v.label}</div>
                    <div className="text-xs text-[var(--text-3)] mt-0.5">{v.desc}</div>
                  </button>
                ))}
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

          <div className="flex justify-end gap-2 pt-1">
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
      </div>
    </>
  )
}
