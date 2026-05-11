import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Pause, Play, X, Loader2, Download as DownloadIcon, Music, Upload, Image as ImageIcon } from 'lucide-react'
import type { FootageSentenceItem, VideoAsset } from '../../types'
import { CoverGeneratorForm } from './forms/CoverGeneratorForm'
import { useChatStore, makeAssistantMsg } from '../../store/chatStore'

interface Props {
  videoUrl: string
  segmentTimes: { start: number; end: number }[]
  narrationOssKey?: string         // 没传则不能合成
  items: FootageSentenceItem[]
  selected: Record<number, VideoAsset[]>
  onClose: () => void
}

// PIP 配置 (V1: 全局, 全片统一)
type PipShape = 'none' | 'circle' | 'rounded'
type PipPos = 'tl' | 'tr' | 'bl' | 'br' | 'center'
type PipSize = 'S' | 'M' | 'L'
type FaceY = 'top' | 'center' | 'bottom'  // 人物在 PIP 内的纵向位置
type OutputRatio = '9:16' | '16:9' | '1:1'  // 最终成品比例

const POS_LABEL: Record<PipPos, string> = { tl: '左上', tr: '右上', bl: '左下', br: '右下', center: '居中' }
const SIZE_RATIO: Record<PipSize, number> = { S: 0.20, M: 0.25, L: 0.33 }
const FACE_Y_LABEL: Record<FaceY, string> = { top: '人物靠上', center: '居中', bottom: '人物靠下' }
const FACE_Y_POS: Record<FaceY, string> = { top: '20%', center: '50%', bottom: '80%' }
const RATIO_LABEL: Record<OutputRatio, string> = { '9:16': '竖屏 9:16 (抖音)', '16:9': '横屏 16:9 (B站/YouTube)', '1:1': '方形 1:1' }
const RATIO_CSS: Record<OutputRatio, string> = { '9:16': '9/16', '16:9': '16/9', '1:1': '1/1' }

export function TimelinePreview({ videoUrl, segmentTimes, narrationOssKey, items, selected, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [shape, setShape] = useState<PipShape>('rounded')
  const [pos, setPos] = useState<PipPos>('bl')
  const [size, setSize] = useState<PipSize>('M')
  const [faceY, setFaceY] = useState<FaceY>('top')
  const [outputRatio, setOutputRatio] = useState<OutputRatio>('9:16')
  const [composing, setComposing] = useState(false)
  const [composedUrl, setComposedUrl] = useState<string | null>(null)
  const [composedOssKey, setComposedOssKey] = useState<string | null>(null)
  const [composeError, setComposeError] = useState('')
  const [coverModalOpen, setCoverModalOpen] = useState(false)

  // BGM 状态: 用户上传一个背景音乐 (mp3/wav 等), 合成时跟口播音轨混音 (避免版权)
  const [bgm, setBgm] = useState<{ oss_key: string; name: string; preview_url: string } | null>(null)
  const [bgmVolume, setBgmVolume] = useState(0.3)   // 默认 30%, 不盖过口播
  const [bgmUploading, setBgmUploading] = useState(false)
  const bgmFileRef = useRef<HTMLInputElement>(null)

  const directBase = (import.meta as any).env?.VITE_DIRECT_API_URL || 'https://monoi.nat100.top'
  const chatStore = useChatStore()

  const handleBgmUpload = async (file: File) => {
    if (file.size > 50 * 1024 * 1024) {
      alert('BGM 太大 (>50MB), 建议先压缩')
      return
    }
    setBgmUploading(true)
    try {
      const signRes = await fetch(directBase + '/api/oss/sign-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, content_type: file.type || 'audio/mpeg' }),
      })
      if (!signRes.ok) throw new Error(`签名失败 (${signRes.status})`)
      const { put_url, oss_key, content_type } = await signRes.json()
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.onload = () => { (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error(`PUT ${xhr.status}`)) }
        xhr.onerror = () => reject(new Error('网络错误'))
        xhr.open('PUT', put_url)
        xhr.setRequestHeader('Content-Type', content_type)
        xhr.send(file)
      })
      setBgm({ oss_key, name: file.name, preview_url: URL.createObjectURL(file) })
    } catch (e: any) {
      alert(`BGM 上传失败: ${e.message}`)
    } finally {
      setBgmUploading(false)
    }
  }

  const handleCompose = async () => {
    if (!narrationOssKey) {
      setComposeError('缺少口播视频信息, 无法合成. 请重新走口播剪辑流程.')
      return
    }
    setComposing(true)
    setComposeError('')
    try {
      const shots = segmentTimes.map((seg, i) => ({
        start: seg.start,
        end: seg.end,
        // 过滤掉没真实视频 URL 的 asset (没 preview_url 又没 oss_key 的会拉到 HTML 网页, 让 ffmpeg 挂)
        assets: (selected[i] || [])
          .filter(a => a.oss_key || (a.preview_url && /\.(mp4|mov|webm|mkv)(\?|$)/i.test(a.preview_url)))
          .map(a => ({
            url: a.oss_key ? '' : (a.preview_url || ''),    // oss_key 优先, 没就用 preview_url
            oss_key: a.oss_key,
            duration: a.duration || 0,
          })),
      }))
      const body = {
        narration_oss_key: narrationOssKey,
        shots,
        pip: {
          enabled: shape !== 'none',
          shape: shape === 'none' ? 'rounded' : shape,
          pos, size, face_y: faceY,
        },
        output_ratio: outputRatio,
        bgm_oss_key: bgm?.oss_key || null,
        bgm_volume: bgmVolume,
      }
      const res = await fetch(directBase + '/api/voice/compose-footage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.detail || data.error || `合成失败 (${res.status})`)
      }
      setComposedUrl(data.video_url)
      setComposedOssKey(data.output_oss_key || null)

      // 把成品视频注入对话 (跟"口播剪辑完成"体验一致): 视频 + 提示 + 下一步按钮
      const convId = chatStore.activeId
      if (convId) {
        const msg = makeAssistantMsg([
          {
            type: 'video_player',
            data: {
              video_url: data.video_url,
              duration_ms: data.duration ? Math.round(data.duration * 1000) : undefined,
              audio_label: '一键合成',
              source: 'ai_generated' as const,
              narration_oss_key: data.output_oss_key,   // 给封面/后续模块用
            },
          },
          { type: 'text', content: '成品视频已合成 (口播 + b-roll + PIP + BGM). 下一步?' },
          {
            type: 'choices',
            question: '下一步',
            options: [
              { id: '__form_cover__', label: '生成封面', description: '截帧 + 模板, 输出多比例' },
              { id: '帮我生成各平台的发布文案', label: '生成发布文案', description: '抖音/小红书/视频号/B站' },
              { id: '保留这段视频, 暂不做下一步', label: '保留视频', description: '稍后再决定' },
            ],
          },
        ])
        chatStore.addMessage(convId, msg)
      }
    } catch (e: any) {
      setComposeError(e.message || '合成失败')
    } finally {
      setComposing(false)
    }
  }

  // 当前镜头索引: currentTime 落在哪个 segment 时间段
  const currentShotIdx = segmentTimes.findIndex(s => currentTime >= s.start && currentTime < s.end)

  // 该镜头用户选了哪些素材 (多个素材按时长平均切)
  const currentShotAssets: VideoAsset[] = currentShotIdx >= 0 ? (selected[currentShotIdx] || []) : []
  const currentBroll: VideoAsset | null = (() => {
    if (currentShotIdx < 0 || currentShotAssets.length === 0) return null
    const seg = segmentTimes[currentShotIdx]
    const segLen = seg.end - seg.start
    const sliceLen = segLen / currentShotAssets.length
    const subIdx = Math.min(Math.floor((currentTime - seg.start) / sliceLen), currentShotAssets.length - 1)
    return currentShotAssets[subIdx] || null
  })()

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onTime = () => setCurrentTime(v.currentTime)
    const onMeta = () => setDuration(v.duration || 0)
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    v.addEventListener('timeupdate', onTime)
    v.addEventListener('loadedmetadata', onMeta)
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    return () => {
      v.removeEventListener('timeupdate', onTime)
      v.removeEventListener('loadedmetadata', onMeta)
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
    }
  }, [])

  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) v.play()
    else v.pause()
  }

  const seekTo = (t: number) => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = Math.max(0, Math.min(t, duration))
  }

  // PIP 样式 (CSS 预览, 跟最终 ffmpeg 合成保持一致)
  const pipStyle: React.CSSProperties = (() => {
    const pad = 12
    const s: React.CSSProperties = { position: 'absolute', overflow: 'hidden' }
    if (pos === 'tl') { s.top = pad; s.left = pad }
    else if (pos === 'tr') { s.top = pad; s.right = pad }
    else if (pos === 'bl') { s.bottom = pad; s.left = pad }
    else if (pos === 'br') { s.bottom = pad; s.right = pad }
    else { s.top = '50%'; s.left = '50%'; s.transform = 'translate(-50%, -50%)' }
    s.borderRadius = shape === 'circle' ? '50%' : '12px'
    s.boxShadow = '0 4px 16px rgba(0,0,0,0.4)'
    return s
  })()

  const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`

  const modal = (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative bg-[var(--bg-card)] border border-[var(--border)] rounded-[22px] shadow-ios-lg w-full max-w-4xl max-h-[92vh] flex flex-col sheet-enter overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div className="text-base font-semibold text-[var(--text)]">预览效果 · 双轨合成示意</div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-[var(--text-2)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors">
            <X size={16}/>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          {/* 预览画面: 按最终成品比例展示 (默认 9:16 抖音). video 元素始终存在 (避免切换时重新加载) */}
          <div className="flex items-center justify-center bg-black/40 rounded-xl p-2" style={{ maxHeight: '50vh' }}>
            <div
              className="relative bg-black rounded-lg overflow-hidden mx-auto"
              style={{ aspectRatio: RATIO_CSS[outputRatio], height: '46vh', maxWidth: '100%' }}
            >
              {/* 底层 b-roll 缩略图 (有素材时显示), 实际合成会播视频 */}
              {currentBroll && (
                <img src={currentBroll.thumbnail} alt="" className="absolute inset-0 w-full h-full object-cover" />
              )}
              {/* 口播 video 元素 — 始终在 DOM 里; shape='none' 时变全屏看不见 (但音轨在播) */}
              <video
                ref={videoRef}
                src={videoUrl}
                playsInline
                style={!currentBroll ? {
                  // 没素材的镜头: video 全屏
                  position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
                } : shape === 'none' ? {
                  // 无 PIP 模式: video 缩到 1px 隐藏 (保留音频), b-roll 全屏
                  position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none',
                } : {
                  // PIP 模式
                  ...pipStyle,
                  width: `${SIZE_RATIO[size] * 100}%`,
                  aspectRatio: shape === 'circle' ? '1/1' : '16/9',
                  objectFit: 'cover',
                  objectPosition: `center ${FACE_Y_POS[faceY]}`,
                }}
              />
            </div>
          </div>

          {/* 控制栏 */}
          <div className="flex items-center gap-3 px-1">
            <button onClick={togglePlay} className="w-10 h-10 rounded-full bg-[var(--text)] text-[var(--bg)] flex items-center justify-center hover:opacity-80 cursor-pointer transition-opacity flex-shrink-0">
              {playing ? <Pause size={16}/> : <Play size={16} className="ml-0.5"/>}
            </button>
            <div className="flex-1">
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={currentTime}
                onChange={(e) => seekTo(Number(e.target.value))}
                className="w-full accent-current cursor-pointer"
              />
            </div>
            <div className="text-xs text-[var(--text-3)] font-mono flex-shrink-0">
              {fmt(currentTime)} / {fmt(duration)}
            </div>
          </div>

          {/* 双轨道时间轴 */}
          <div className="border border-[var(--border)] rounded-xl overflow-hidden">
            {/* 上轨: b-roll 缩略图条 (按 segment 时长占比) */}
            <div className="flex h-12 bg-[var(--bg-hover)] relative">
              {duration > 0 && segmentTimes.map((seg, i) => {
                const widthPct = ((seg.end - seg.start) / duration) * 100
                const assets = selected[i] || []
                const isCurrent = i === currentShotIdx
                return (
                  <div
                    key={i}
                    onClick={() => seekTo(seg.start)}
                    className={`flex-shrink-0 border-r border-[var(--border)] cursor-pointer hover:opacity-80 transition-opacity overflow-hidden flex ${isCurrent ? 'ring-2 ring-inset ring-[var(--text)]' : ''}`}
                    style={{ width: `${widthPct}%` }}
                    title={`镜 ${i + 1}: ${items[i]?.text?.slice(0, 30)}`}
                  >
                    {assets.length > 0 ? (
                      assets.map((a, j) => (
                        <img key={`${a.source}-${a.id}-${j}`} src={a.thumbnail} className="h-full object-cover flex-1" alt="" />
                      ))
                    ) : (
                      <div className="flex-1 flex items-center justify-center text-[10px] text-[var(--text-3)]">未选</div>
                    )}
                  </div>
                )
              })}
              {/* 时间游标 */}
              {duration > 0 && (
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-red-500 pointer-events-none"
                  style={{ left: `${(currentTime / duration) * 100}%` }}
                />
              )}
            </div>
            {/* 下轨: 原视频示意条 (灰色 + 文案预览) */}
            <div className="flex h-8 bg-[var(--bg-input)] border-t border-[var(--border)] relative">
              {duration > 0 && segmentTimes.map((seg, i) => {
                const widthPct = ((seg.end - seg.start) / duration) * 100
                return (
                  <div
                    key={i}
                    className="flex-shrink-0 border-r border-[var(--border)] flex items-center px-2 overflow-hidden"
                    style={{ width: `${widthPct}%` }}
                  >
                    <span className="text-[10px] text-[var(--text-3)] truncate">{items[i]?.text}</span>
                  </div>
                )
              })}
              {duration > 0 && (
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-red-500 pointer-events-none"
                  style={{ left: `${(currentTime / duration) * 100}%` }}
                />
              )}
            </div>
          </div>

          {/* PIP 配置 */}
          <div className="border border-[var(--border)] rounded-xl p-3 flex flex-col gap-3">
            <div className="text-xs font-medium text-[var(--text-2)]">画中画样式 (口播小窗)</div>

            <div className="flex items-center gap-3">
              <span className="text-xs text-[var(--text-3)] w-16">输出比例</span>
              <div className="flex gap-2 flex-wrap">
                {(['9:16', '16:9', '1:1'] as OutputRatio[]).map(r => (
                  <button
                    key={r}
                    onClick={() => setOutputRatio(r)}
                    className={`px-3 py-1.5 rounded-lg text-xs border transition-all cursor-pointer ${outputRatio === r ? 'bg-[var(--text)] text-[var(--bg)] border-[var(--text)]' : 'bg-[var(--bg-card)] text-[var(--text-2)] border-[var(--border)] hover:border-[var(--text-3)]'}`}
                  >
                    {RATIO_LABEL[r]}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs text-[var(--text-3)] w-16">形状</span>
              <div className="flex gap-2 flex-wrap">
                {(['none', 'rounded', 'circle'] as PipShape[]).map(s => (
                  <button
                    key={s}
                    onClick={() => setShape(s)}
                    className={`px-3 py-1.5 rounded-lg text-xs border transition-all cursor-pointer ${shape === s ? 'bg-[var(--text)] text-[var(--bg)] border-[var(--text)]' : 'bg-[var(--bg-card)] text-[var(--text-2)] border-[var(--border)] hover:border-[var(--text-3)]'}`}
                  >
                    {s === 'none' ? '× 无小窗' : s === 'circle' ? '○ 圆形' : '▢ 圆角矩形'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs text-[var(--text-3)] w-16">位置</span>
              <div className="flex gap-2">
                {(['tl', 'tr', 'bl', 'br', 'center'] as PipPos[]).map(p => (
                  <button
                    key={p}
                    onClick={() => setPos(p)}
                    className={`px-3 py-1.5 rounded-lg text-xs border transition-all cursor-pointer ${pos === p ? 'bg-[var(--text)] text-[var(--bg)] border-[var(--text)]' : 'bg-[var(--bg-card)] text-[var(--text-2)] border-[var(--border)] hover:border-[var(--text-3)]'}`}
                  >
                    {POS_LABEL[p]}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs text-[var(--text-3)] w-16">大小</span>
              <div className="flex gap-2">
                {(['S', 'M', 'L'] as PipSize[]).map(sz => (
                  <button
                    key={sz}
                    onClick={() => setSize(sz)}
                    className={`px-3 py-1.5 rounded-lg text-xs border transition-all cursor-pointer ${size === sz ? 'bg-[var(--text)] text-[var(--bg)] border-[var(--text)]' : 'bg-[var(--bg-card)] text-[var(--text-2)] border-[var(--border)] hover:border-[var(--text-3)]'}`}
                  >
                    {sz}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs text-[var(--text-3)] w-16">人物位置</span>
              <div className="flex gap-2">
                {(['top', 'center', 'bottom'] as FaceY[]).map(y => (
                  <button
                    key={y}
                    onClick={() => setFaceY(y)}
                    className={`px-3 py-1.5 rounded-lg text-xs border transition-all cursor-pointer ${faceY === y ? 'bg-[var(--text)] text-[var(--bg)] border-[var(--text)]' : 'bg-[var(--bg-card)] text-[var(--text-2)] border-[var(--border)] hover:border-[var(--text-3)]'}`}
                  >
                    {FACE_Y_LABEL[y]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <p className="text-[11px] text-[var(--text-3)] leading-relaxed">
            这是预览示意图. 当前 PIP 样式 / 位置 / 大小会在最终合成时按这个布局生效.
            点上方时间轴上的镜头可跳转, 同步看到对应 b-roll. 多素材按时长平均切.
          </p>

          {/* BGM 配置 */}
          <div className="border border-[var(--border)] rounded-xl p-3 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-[var(--text-2)] flex items-center gap-1.5">
                <Music size={12}/> 背景音乐 (BGM)
              </div>
              <span className="text-[10px] text-[var(--text-3)]">建议自己上传无版权音乐 (mp3/wav, ≤50MB)</span>
            </div>

            {bgm ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between bg-[var(--bg-hover)] rounded-lg px-3 py-2">
                  <span className="text-xs text-[var(--text)] truncate flex-1">{bgm.name}</span>
                  <button
                    onClick={() => { if (bgm.preview_url) URL.revokeObjectURL(bgm.preview_url); setBgm(null) }}
                    className="text-[11px] text-[var(--text-3)] hover:text-red-400 px-2 py-1 cursor-pointer"
                  >
                    移除
                  </button>
                </div>
                <audio src={bgm.preview_url} controls className="w-full" style={{ height: 32 }}/>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-[var(--text-3)] w-16">音量</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={bgmVolume}
                    onChange={(e) => setBgmVolume(Number(e.target.value))}
                    className="flex-1 accent-current cursor-pointer"
                  />
                  <span className="text-xs text-[var(--text-3)] font-mono w-10 text-right">{Math.round(bgmVolume * 100)}%</span>
                </div>
              </div>
            ) : (
              <button
                onClick={() => bgmFileRef.current?.click()}
                disabled={bgmUploading}
                className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-dashed border-[var(--border)] text-xs text-[var(--text-2)] hover:bg-[var(--bg-hover)] hover:border-[var(--text-3)] cursor-pointer disabled:opacity-50 transition-all"
              >
                {bgmUploading ? <><Loader2 size={14} className="animate-spin"/> 上传中...</> : <><Upload size={14}/> 上传 BGM (可选)</>}
              </button>
            )}
            <input
              ref={bgmFileRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleBgmUpload(f)
                if (bgmFileRef.current) bgmFileRef.current.value = ''
              }}
            />
          </div>
        </div>

        {/* 合成结果区 (合成完显示) */}
        {(composedUrl || composeError) && (
          <div className="px-5 pb-2">
            {composeError && (
              <div className="text-xs text-red-400 bg-red-950/20 border border-red-900/30 rounded-lg px-3 py-2">
                {composeError}
              </div>
            )}
            {composedUrl && (
              <div className="flex flex-col gap-2">
                <video src={composedUrl} controls className="w-full rounded-lg max-h-[40vh] bg-black"/>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={composedUrl}
                    download="monoi-composed.mp4"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-[var(--text)] text-[var(--bg)] text-sm rounded-lg hover:opacity-80 cursor-pointer"
                  >
                    <DownloadIcon size={14}/> 下载成品 mp4
                  </a>
                  {composedOssKey && (
                    <button
                      onClick={() => setCoverModalOpen(true)}
                      className="inline-flex items-center justify-center gap-1.5 px-4 py-2 border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--bg-hover)] text-sm rounded-lg cursor-pointer transition-colors"
                    >
                      <ImageIcon size={14}/> 生成封面
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--border)]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-[var(--text-2)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors cursor-pointer"
          >
            关闭
          </button>
          <button
            onClick={handleCompose}
            disabled={composing || !narrationOssKey}
            title={!narrationOssKey ? '缺少口播视频, 走口播剪辑流程后再试' : '后端 ffmpeg 合成, 5-30 秒'}
            className={`px-4 py-2 text-sm rounded-lg transition-all inline-flex items-center gap-2 ${
              composing || !narrationOssKey
                ? 'bg-[var(--bg-hover)] text-[var(--text-3)] cursor-not-allowed'
                : 'bg-[var(--text)] text-[var(--bg)] hover:opacity-80 cursor-pointer'
            }`}
          >
            {composing ? <><Loader2 size={14} className="animate-spin"/> 合成中...</> : (composedUrl ? '重新合成' : '一键合成')}
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <>
      {createPortal(modal, document.body)}
      {coverModalOpen && composedOssKey && composedUrl && (
        <CoverGeneratorForm
          defaultVideoOssKey={composedOssKey}
          defaultVideoUrl={composedUrl}
          onClose={() => setCoverModalOpen(false)}
        />
      )}
    </>
  )
}
