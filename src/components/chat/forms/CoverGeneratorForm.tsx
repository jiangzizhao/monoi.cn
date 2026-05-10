import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Loader2, Download as DownloadIcon, Upload, Image as ImageIcon } from 'lucide-react'

interface Props {
  // 从对话最近的合成视频或口播视频拿
  defaultVideoOssKey?: string
  defaultVideoUrl?: string         // 用来播放选时间点
  onClose: () => void
}

type Template = 'youtube' | 'douyin' | 'xhs' | 'bilibili' | 'minimal'
type Ratio = '9:16' | '16:9' | '3:4' | '1:1'

const TEMPLATES: { id: Template; label: string; desc: string }[] = [
  { id: 'youtube',  label: 'YouTube 大标题', desc: '黄字红描边, 上方大标题 (人脸特写型)' },
  { id: 'douyin',   label: '抖音爆款',       desc: '上下黑底, 中间画面 + 黑底白字' },
  { id: 'xhs',      label: '小红书干货',     desc: '顶部彩色块 + 主副两行标题' },
  { id: 'bilibili', label: 'B站知识',        desc: '左下角白色卡片 + 标题' },
  { id: 'minimal',  label: '极简',           desc: '底部一行小字, 不抢画面' },
]

const RATIOS: { id: Ratio; label: string }[] = [
  { id: '9:16', label: '竖屏 9:16 (抖音/快手)' },
  { id: '16:9', label: '横屏 16:9 (B站/YouTube)' },
  { id: '3:4',  label: '小红书 3:4' },
  { id: '1:1',  label: '方形 1:1 (微博/朋友圈)' },
]

export function CoverGeneratorForm({ defaultVideoOssKey, defaultVideoUrl, onClose }: Props) {
  const [mode, setMode] = useState<'generate' | 'upload'>('generate')
  const videoRef = useRef<HTMLVideoElement>(null)
  const [videoDuration, setVideoDuration] = useState(0)
  const [frameTime, setFrameTime] = useState(1.0)
  const [title, setTitle] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [template, setTemplate] = useState<Template>('youtube')
  const [ratios, setRatios] = useState<Ratio[]>(['9:16', '16:9'])
  const [generating, setGenerating] = useState(false)
  const [results, setResults] = useState<{ ratio: string; url: string }[]>([])
  const [error, setError] = useState('')

  // 自传通道
  const [uploadedCover, setUploadedCover] = useState<{ name: string; url: string } | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const directBase = (import.meta as any).env?.VITE_DIRECT_API_URL || 'https://monoi.nat100.top'

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onMeta = () => {
      setVideoDuration(v.duration || 0)
      setFrameTime(Math.min(1.0, (v.duration || 1) / 4))
    }
    v.addEventListener('loadedmetadata', onMeta)
    return () => v.removeEventListener('loadedmetadata', onMeta)
  }, [])

  // 拖时间轴时同步 video 显示对应帧
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = frameTime
  }, [frameTime])

  const toggleRatio = (r: Ratio) => {
    setRatios(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r])
  }

  const handleGenerate = async () => {
    if (!defaultVideoOssKey) {
      setError('没找到源视频, 请先合成或剪辑一段视频')
      return
    }
    if (!title.trim()) {
      setError('标题不能为空')
      return
    }
    if (ratios.length === 0) {
      setError('至少选一个输出比例')
      return
    }
    setGenerating(true)
    setError('')
    try {
      const res = await fetch(directBase + '/api/voice/generate-cover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_oss_key: defaultVideoOssKey,
          frame_time: frameTime,
          title: title.trim(),
          subtitle: subtitle.trim(),
          template,
          output_ratios: ratios,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.detail || data.error || `生成失败 (${res.status})`)
      }
      setResults(data.covers || [])
    } catch (e: any) {
      setError(e.message || '生成失败')
    } finally {
      setGenerating(false)
    }
  }

  const handleUploadFile = async (file: File) => {
    if (!file.type.startsWith('image/')) { alert('请选图片文件 (jpg/png/webp)'); return }
    if (file.size > 10 * 1024 * 1024) { alert('图片太大 (>10MB)'); return }
    setUploading(true)
    try {
      const signRes = await fetch(directBase + '/api/oss/sign-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, content_type: file.type }),
      })
      if (!signRes.ok) throw new Error('签名失败')
      const { put_url, oss_key, content_type } = await signRes.json()
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.onload = () => { (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error(`PUT ${xhr.status}`)) }
        xhr.onerror = () => reject(new Error('网络错误'))
        xhr.open('PUT', put_url)
        xhr.setRequestHeader('Content-Type', content_type)
        xhr.send(file)
      })
      setUploadedCover({ name: file.name, url: URL.createObjectURL(file) })
      // 自传不调后端模板, 直接展示用户的
      setResults([{ ratio: 'original', url: URL.createObjectURL(file) }])
    } catch (e: any) {
      alert(`上传失败: ${e.message}`)
    } finally {
      setUploading(false)
    }
  }

  const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`

  const modal = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative bg-[var(--bg-card)] border border-[var(--border)] rounded-[22px] shadow-ios-lg w-full max-w-3xl max-h-[92vh] flex flex-col sheet-enter overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div className="text-base font-semibold text-[var(--text)]">封面 · 生成或上传</div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-[var(--text-2)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors">
            <X size={16}/>
          </button>
        </div>

        <div className="flex border-b border-[var(--border)]">
          <button
            onClick={() => setMode('generate')}
            className={`flex-1 py-2.5 text-sm cursor-pointer transition-colors ${mode === 'generate' ? 'text-[var(--text)] border-b-2 border-[var(--text)]' : 'text-[var(--text-3)]'}`}
          >
            <ImageIcon size={14} className="inline mr-1.5"/> 截帧 + 模板生成
          </button>
          <button
            onClick={() => setMode('upload')}
            className={`flex-1 py-2.5 text-sm cursor-pointer transition-colors ${mode === 'upload' ? 'text-[var(--text)] border-b-2 border-[var(--text)]' : 'text-[var(--text-3)]'}`}
          >
            <Upload size={14} className="inline mr-1.5"/> 上传我自己的封面
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          {mode === 'generate' && (
            <>
              {/* 时间点选择 + 视频预览 */}
              {defaultVideoUrl && (
                <div className="flex flex-col gap-2">
                  <div className="text-xs text-[var(--text-2)]">选取作为封面的时间点</div>
                  <video ref={videoRef} src={defaultVideoUrl} className="w-full rounded-lg bg-black max-h-[35vh] object-contain"/>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={0}
                      max={videoDuration || 0}
                      step={0.1}
                      value={frameTime}
                      onChange={(e) => setFrameTime(Number(e.target.value))}
                      className="flex-1 accent-current cursor-pointer"
                    />
                    <span className="text-xs text-[var(--text-3)] font-mono w-20 text-right">
                      {fmt(frameTime)} / {fmt(videoDuration)}
                    </span>
                  </div>
                </div>
              )}
              {!defaultVideoUrl && (
                <div className="text-xs text-[var(--text-3)] bg-[var(--bg-hover)] rounded-lg px-3 py-2">
                  没找到源视频. 请先在对话里完成口播剪辑或合成, 才能截帧.
                </div>
              )}

              {/* 标题 */}
              <div className="flex flex-col gap-2">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="主标题 (必填, 建议 4-15 字)"
                  className="bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none focus:border-[var(--text-3)]"
                />
                <input
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                  placeholder="副标题 (可选)"
                  className="bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none focus:border-[var(--text-3)]"
                />
              </div>

              {/* 模板选择 */}
              <div className="flex flex-col gap-2">
                <div className="text-xs text-[var(--text-2)]">模板</div>
                <div className="grid grid-cols-1 gap-1.5">
                  {TEMPLATES.map(t => (
                    <button
                      key={t.id}
                      onClick={() => setTemplate(t.id)}
                      className={`flex items-center justify-between px-3 py-2 rounded-lg border text-left transition-all cursor-pointer ${
                        template === t.id
                          ? 'bg-[var(--text)] border-[var(--text)] text-[var(--bg)]'
                          : 'bg-[var(--bg-card)] border-[var(--border)] text-[var(--text-2)] hover:border-[var(--text-3)]'
                      }`}
                    >
                      <span className="text-sm font-medium">{t.label}</span>
                      <span className="text-[11px] opacity-70 truncate ml-2">{t.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* 输出比例 */}
              <div className="flex flex-col gap-2">
                <div className="text-xs text-[var(--text-2)]">输出比例 (可多选)</div>
                <div className="flex flex-wrap gap-2">
                  {RATIOS.map(r => (
                    <button
                      key={r.id}
                      onClick={() => toggleRatio(r.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs border transition-all cursor-pointer ${
                        ratios.includes(r.id)
                          ? 'bg-[var(--text)] border-[var(--text)] text-[var(--bg)]'
                          : 'bg-[var(--bg-card)] border-[var(--border)] text-[var(--text-2)] hover:border-[var(--text-3)]'
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              {error && (
                <div className="text-xs text-red-400 bg-red-950/20 border border-red-900/30 rounded-lg px-3 py-2">{error}</div>
              )}
            </>
          )}

          {mode === 'upload' && (
            <div className="flex flex-col gap-3">
              {uploadedCover ? (
                <div className="flex flex-col gap-2">
                  <img src={uploadedCover.url} alt="" className="w-full rounded-lg max-h-[40vh] object-contain bg-black"/>
                  <div className="flex items-center justify-between bg-[var(--bg-hover)] rounded-lg px-3 py-2">
                    <span className="text-xs text-[var(--text)] truncate">{uploadedCover.name}</span>
                    <button onClick={() => setUploadedCover(null)} className="text-[11px] text-[var(--text-3)] hover:text-red-400 px-2 py-1 cursor-pointer">移除</button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center justify-center gap-2 px-4 py-12 rounded-lg border border-dashed border-[var(--border)] text-sm text-[var(--text-2)] hover:bg-[var(--bg-hover)] hover:border-[var(--text-3)] cursor-pointer transition-all"
                >
                  {uploading ? <><Loader2 size={16} className="animate-spin"/> 上传中...</> : <><Upload size={16}/> 选图片 (jpg/png/webp, ≤10MB)</>}
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleUploadFile(f)
                  if (fileRef.current) fileRef.current.value = ''
                }}
              />
            </div>
          )}

          {/* 结果展示 */}
          {results.length > 0 && (
            <div className="flex flex-col gap-2 mt-2">
              <div className="text-xs font-medium text-[var(--text-2)]">生成结果 ({results.length} 张)</div>
              <div className="grid grid-cols-2 gap-2">
                {results.map((r, i) => (
                  <div key={i} className="flex flex-col gap-1.5 border border-[var(--border)] rounded-lg p-2">
                    <img src={r.url} alt="" className="w-full rounded bg-black max-h-[30vh] object-contain"/>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-[var(--text-3)]">{r.ratio}</span>
                      <a
                        href={r.url}
                        download={`cover-${r.ratio.replace(':', 'x')}.jpg`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-[var(--text)] hover:opacity-80 cursor-pointer"
                      >
                        <DownloadIcon size={11}/> 下载
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--border)]">
          <button onClick={onClose} className="px-4 py-2 text-sm text-[var(--text-2)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors cursor-pointer">关闭</button>
          {mode === 'generate' && (
            <button
              onClick={handleGenerate}
              disabled={generating || !title.trim() || !defaultVideoOssKey}
              className={`px-4 py-2 text-sm rounded-lg transition-all inline-flex items-center gap-2 ${
                generating || !title.trim() || !defaultVideoOssKey
                  ? 'bg-[var(--bg-hover)] text-[var(--text-3)] cursor-not-allowed'
                  : 'bg-[var(--text)] text-[var(--bg)] hover:opacity-80 cursor-pointer'
              }`}
            >
              {generating ? <><Loader2 size={14} className="animate-spin"/> 生成中...</> : (results.length > 0 ? '重新生成' : '生成封面')}
            </button>
          )}
        </div>
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}
