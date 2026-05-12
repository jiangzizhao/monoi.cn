import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Loader2, Download as DownloadIcon, Upload, Image as ImageIcon } from 'lucide-react'
import { useChatStore, makeAssistantMsg } from '../../../store/chatStore'

interface Props {
  // 从对话最近的合成视频或口播视频拿
  defaultVideoOssKey?: string
  defaultVideoUrl?: string         // 用来播放选时间点
  onClose: () => void
}

type Template = 'youtube' | 'douyin' | 'xhs' | 'bilibili' | 'minimal'
type Ratio = '9:16' | '16:9' | '3:4' | '1:1'

// 模板 UI 已去掉, 后端固定走 youtube (基础布局: 画面 + 顶部文字 + 描边阴影)
// 用户用下方"自定义参数"调颜色/位置/字号, 完全自由

const RATIOS: { id: Ratio; label: string }[] = [
  { id: '9:16', label: '9:16' },
  { id: '16:9', label: '16:9' },
  { id: '3:4',  label: '3:4' },
  { id: '1:1',  label: '1:1' },
]

export function CoverGeneratorForm({ defaultVideoOssKey, defaultVideoUrl, onClose }: Props) {
  const [mode, setMode] = useState<'generate' | 'upload'>('generate')
  const videoRef = useRef<HTMLVideoElement>(null)
  const [videoDuration, setVideoDuration] = useState(0)
  const [frameTime, setFrameTime] = useState(1.0)
  const [title, setTitle] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const template: Template = 'youtube'   // 写死 (UI 去掉模板选择, 用自定义参数调)
  const [ratios, setRatios] = useState<Ratio[]>(['9:16', '16:9'])
  const [generating, setGenerating] = useState(false)
  const [results, setResults] = useState<{ ratio: string; url: string }[]>([])
  const [error, setError] = useState('')
  const [fonts, setFonts] = useState<{ file: string; label: string; tag: string }[]>([])
  const [fontTitle, setFontTitle] = useState<string>('')
  const [fontSubtitle, setFontSubtitle] = useState<string>('')
  // 默认 黑白黑: 字体黑 / 描边白 / 副标题黑 (跟后端 youtube 模板对齐)
  const [colorFill, setColorFill] = useState<string>('#000000')
  const [colorStroke, setColorStroke] = useState<string>('#FFFFFF')
  const [colorSubFill, setColorSubFill] = useState<string>('#000000')
  const [position, setPosition] = useState<string>('')          // 9 宫格 id: tl/tc/tr/cl/cc/cr/bl/bc/br, 空走默认
  const [fontScale, setFontScale] = useState<number>(1.0)

  // 自传图作为源 (代替视频截帧, 但仍走相同叠字流程)
  const [uploadedCover, setUploadedCover] = useState<{ name: string; url: string; oss_key: string } | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const directBase = (import.meta as any).env?.VITE_DIRECT_API_URL || 'https://monoi.nat100.top'
  const chatStore = useChatStore()

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

  // 拉 server 上可用字体 + 用 FontFace API 注入到浏览器, 让下面卡片能用真字体显示
  useEffect(() => {
    fetch(directBase + '/api/voice/cover-fonts')
      .then(r => r.json())
      .then((d: any) => {
        const list = d.fonts || []
        setFonts(list)
        // 异步并发加载所有字体到浏览器 (字体大, 国内网慢, 加载完会闪一下从默认字体切到真字体 = FOUT)
        list.forEach((f: any) => {
          const family = `monoi-cover-${f.file.replace(/[^\w]/g, '')}`
          const url = `${directBase}/api/voice/cover-font-file/${encodeURIComponent(f.file)}`
          try {
            const ff = new FontFace(family, `url(${url})`)
            ff.load().then(loaded => (document as any).fonts.add(loaded)).catch(() => {})
          } catch {}
        })
      })
      .catch(() => setFonts([]))
  }, [directBase])

  const fontFamilyFor = (file: string) => `monoi-cover-${file.replace(/[^\w]/g, '')}`

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
    // 自传图优先, 否则用视频截帧
    if (!uploadedCover && !defaultVideoOssKey) {
      setError('请上传图作为源, 或先合成/剪辑一段视频')
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
      const body: any = {
        frame_time: frameTime,
        title: title.trim(),
        subtitle: subtitle.trim(),
        template,
        output_ratios: ratios,
        font_title: fontTitle || null,
        font_subtitle: fontSubtitle || null,
        color_fill: colorFill || null,
        color_stroke: colorStroke || null,
        color_sub_fill: colorSubFill || null,
        position: position || null,
        font_scale: fontScale,
      }
      if (uploadedCover) {
        body.source_image_oss_key = uploadedCover.oss_key
      } else {
        body.source_oss_key = defaultVideoOssKey
      }
      const res = await fetch(directBase + '/api/voice/generate-cover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.detail || data.error || `生成失败 (${res.status})`)
      }
      const covers = data.covers || []
      setResults(covers)
      // covers 空 = 后端说成功但所有比例都被跳过 (大概率是图源坏掉或 Pillow 渲染失败)
      // 不能静默, 否则用户看不到为啥没结果
      if (covers.length === 0) {
        throw new Error('后端返回 0 张封面, 检查图源/字体/比例是否有问题 (打开 Windows voice-server 日志看)')
      }
      // 把封面注入对话流 (跟合成完成体验一致)
      const convId = chatStore.activeId
      if (convId) {
        const msg = makeAssistantMsg([
          { type: 'cover_result', data: { covers } },
          { type: 'text', content: `封面已生成 ${covers.length} 张` },
          {
            type: 'choices',
            question: '下一步',
            options: [
              { id: '__form_publish__', label: '去发布', description: '弹起 Edge 自动上传到小红书/抖音' },
              { id: '帮我生成各平台的发布文案', label: '先生成发布文案', description: 'AI 给每平台写标题/描述/标签' },
              { id: '保留封面, 暂不做下一步', label: '保留封面', description: '稍后再决定' },
            ],
          },
        ])
        chatStore.addMessage(convId, msg)
      }
      // 立刻关弹窗 (跟合成完成的行为对齐, 不再等 1 秒)
      onClose()
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
      // 上传成功: 把图设为新 source (替代视频截帧), 用户照样能输入标题/调字体生成
      setUploadedCover({ name: file.name, url: URL.createObjectURL(file), oss_key })
    } catch (e: any) {
      alert(`上传失败: ${e.message}`)
    } finally {
      setUploading(false)
    }
  }

  const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`

  const modal = (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
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
            <ImageIcon size={14} className="inline mr-1.5"/> 视频截帧作底
          </button>
          <button
            onClick={() => setMode('upload')}
            className={`flex-1 py-2.5 text-sm cursor-pointer transition-colors ${mode === 'upload' ? 'text-[var(--text)] border-b-2 border-[var(--text)]' : 'text-[var(--text-3)]'}`}
          >
            <Upload size={14} className="inline mr-1.5"/> 自传图作底
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          {/* 源选择: 视频截帧 OR 自传图 */}
          {mode === 'generate' && (
            <>
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
                  没找到源视频. 请先在对话里完成口播剪辑或合成, 或切换"自传图作底" 上传图.
                </div>
              )}
            </>
          )}
          {mode === 'upload' && (
            <div className="flex flex-col gap-2">
              {uploadedCover ? (
                <>
                  <div className="text-xs text-[var(--text-2)]">已上传图作为封面底图</div>
                  <img src={uploadedCover.url} alt="" className="w-full rounded-lg max-h-[35vh] object-contain bg-black"/>
                  <div className="flex items-center justify-between bg-[var(--bg-hover)] rounded-lg px-3 py-2">
                    <span className="text-xs text-[var(--text)] truncate">{uploadedCover.name}</span>
                    <button onClick={() => setUploadedCover(null)} className="text-[11px] text-[var(--text-3)] hover:text-red-400 px-2 py-1 cursor-pointer">移除重传</button>
                  </div>
                </>
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

          {/* 共享区 (两个 tab 都用): 标题 + 自定义参数 + 字体 + 比例 */}
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


              {/* 颜色 / 位置 / 字号 自定义 (留空走模板默认) */}
              <div className="flex flex-col gap-3 border border-[var(--border)] rounded-xl p-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-[var(--text-2)]">自定义参数</div>
                  <button
                    onClick={() => { setColorFill('#000000'); setColorStroke('#FFFFFF'); setColorSubFill('#000000'); setPosition(''); setFontScale(1.0) }}
                    className="text-[10px] text-[var(--text-3)] hover:text-[var(--text)] cursor-pointer"
                  >全部恢复默认</button>
                </div>

                {/* 颜色 picker × 3 */}
                <div className="grid grid-cols-3 gap-2">
                  <label className="flex flex-col gap-1 cursor-pointer">
                    <span className="text-[10px] text-[var(--text-3)]">字体颜色</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={colorFill}
                        onChange={(e) => setColorFill(e.target.value)}
                        className="w-8 h-8 rounded cursor-pointer border border-[var(--border)]"
                      />
                      <span className="text-[11px] text-[var(--text-2)] font-mono">{colorFill}</span>
                    </div>
                  </label>
                  <label className="flex flex-col gap-1 cursor-pointer">
                    <span className="text-[10px] text-[var(--text-3)]">描边颜色</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={colorStroke}
                        onChange={(e) => setColorStroke(e.target.value)}
                        className="w-8 h-8 rounded cursor-pointer border border-[var(--border)]"
                      />
                      <span className="text-[11px] text-[var(--text-2)] font-mono">{colorStroke}</span>
                    </div>
                  </label>
                  <label className="flex flex-col gap-1 cursor-pointer">
                    <span className="text-[10px] text-[var(--text-3)]">副标题颜色</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={colorSubFill}
                        onChange={(e) => setColorSubFill(e.target.value)}
                        className="w-8 h-8 rounded cursor-pointer border border-[var(--border)]"
                      />
                      <span className="text-[11px] text-[var(--text-2)] font-mono">{colorSubFill}</span>
                    </div>
                  </label>
                </div>

                {/* 位置 9 宫格 (只对 youtube / minimal 模板生效) */}
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] text-[var(--text-3)]">位置 (YouTube/极简 模板生效)</span>
                  <div className="grid grid-cols-3 gap-1 w-fit">
                    {['tl', 'tc', 'tr', 'cl', 'cc', 'cr', 'bl', 'bc', 'br'].map(p => (
                      <button
                        key={p}
                        onClick={() => setPosition(p === position ? '' : p)}
                        className={`w-8 h-8 rounded border text-xs transition-all cursor-pointer ${
                          position === p
                            ? 'bg-[var(--text)] text-[var(--bg)] border-[var(--text)]'
                            : 'bg-[var(--bg-card)] text-[var(--text-3)] border-[var(--border)] hover:border-[var(--text-3)]'
                        }`}
                        title={p}
                      >●</button>
                    ))}
                  </div>
                </div>

                {/* 字号倍数滑块 */}
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-[var(--text-3)] w-12">字号</span>
                  <input
                    type="range"
                    min={0.5}
                    max={2.0}
                    step={0.1}
                    value={fontScale}
                    onChange={(e) => setFontScale(Number(e.target.value))}
                    className="flex-1 accent-current cursor-pointer"
                  />
                  <span className="text-[11px] text-[var(--text-3)] font-mono w-10 text-right">{fontScale.toFixed(1)}x</span>
                </div>
              </div>

              {/* 字体选择: 卡片网格, 每张卡片用对应字体写示例字 (FontFace API 加载) */}
              {fonts.length > 0 && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-[var(--text-2)]">主标题字体</div>
                    {fontTitle && <button onClick={() => setFontTitle('')} className="text-[10px] text-[var(--text-3)] hover:text-[var(--text)] cursor-pointer">恢复默认</button>}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                    {/* 默认卡片 */}
                    <button
                      onClick={() => setFontTitle('')}
                      className={`flex flex-col items-start gap-1 px-3 py-2 rounded-lg border text-left transition-all cursor-pointer ${
                        !fontTitle ? 'border-[var(--text)] bg-[var(--bg-hover)]' : 'border-[var(--border)] hover:border-[var(--text-3)]'
                      }`}
                    >
                      <span className="text-[10px] text-[var(--text-3)]">默认 (模板预设)</span>
                      <span className="text-base text-[var(--text)]">爆款标题样字</span>
                    </button>
                    {fonts.map(f => (
                      <button
                        key={f.file}
                        onClick={() => setFontTitle(f.file)}
                        className={`flex flex-col items-start gap-1 px-3 py-2 rounded-lg border text-left transition-all cursor-pointer ${
                          fontTitle === f.file ? 'border-[var(--text)] bg-[var(--bg-hover)]' : 'border-[var(--border)] hover:border-[var(--text-3)]'
                        }`}
                      >
                        <span className="text-[10px] text-[var(--text-3)]">{f.label} · {f.tag}</span>
                        <span className="text-base text-[var(--text)] truncate w-full" style={{ fontFamily: fontFamilyFor(f.file) }}>
                          爆款标题样字
                        </span>
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center justify-between mt-1">
                    <div className="text-xs text-[var(--text-2)]">副标题字体</div>
                    {fontSubtitle && <button onClick={() => setFontSubtitle('')} className="text-[10px] text-[var(--text-3)] hover:text-[var(--text)] cursor-pointer">恢复默认</button>}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                    <button
                      onClick={() => setFontSubtitle('')}
                      className={`flex flex-col items-start gap-1 px-3 py-2 rounded-lg border text-left transition-all cursor-pointer ${
                        !fontSubtitle ? 'border-[var(--text)] bg-[var(--bg-hover)]' : 'border-[var(--border)] hover:border-[var(--text-3)]'
                      }`}
                    >
                      <span className="text-[10px] text-[var(--text-3)]">默认 (模板预设)</span>
                      <span className="text-sm text-[var(--text-2)]">副标题样字</span>
                    </button>
                    {fonts.map(f => (
                      <button
                        key={f.file}
                        onClick={() => setFontSubtitle(f.file)}
                        className={`flex flex-col items-start gap-1 px-3 py-2 rounded-lg border text-left transition-all cursor-pointer ${
                          fontSubtitle === f.file ? 'border-[var(--text)] bg-[var(--bg-hover)]' : 'border-[var(--border)] hover:border-[var(--text-3)]'
                        }`}
                      >
                        <span className="text-[10px] text-[var(--text-3)]">{f.label}</span>
                        <span className="text-sm text-[var(--text-2)] truncate w-full" style={{ fontFamily: fontFamilyFor(f.file) }}>
                          副标题样字
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

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
          {(() => {
            // 两个 tab 都用同一个生成按钮: generate tab 需要 defaultVideoOssKey, upload tab 需要 uploadedCover
            const sourceReady = mode === 'generate' ? !!defaultVideoOssKey : !!uploadedCover
            const disabled = generating || !title.trim() || !sourceReady
            return (
              <button
                onClick={handleGenerate}
                disabled={disabled}
                className={`px-4 py-2 text-sm rounded-lg transition-all inline-flex items-center gap-2 ${
                  disabled
                    ? 'bg-[var(--bg-hover)] text-[var(--text-3)] cursor-not-allowed'
                    : 'bg-[var(--text)] text-[var(--bg)] hover:opacity-80 cursor-pointer'
                }`}
              >
                {generating ? <><Loader2 size={14} className="animate-spin"/> 生成中...</> : (results.length > 0 ? '重新生成' : '生成封面')}
              </button>
            )
          })()}
        </div>
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}
