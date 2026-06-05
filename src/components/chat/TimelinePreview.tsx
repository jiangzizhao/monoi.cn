import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Pause, Play, X, Loader2, Music, Upload, Sparkles, Library } from 'lucide-react'
import type { FootageSentenceItem, VideoAsset } from '../../types'
import { useChatStore, makeAssistantMsg } from '../../store/chatStore'
import { humanizeNetworkError } from '../../lib/errorHumanize'
import { VocalRemoverDialog } from '../VocalRemoverDialog'
import { listBgmLibrary, type BgmTrack } from '../../services/audio'
import { getToken } from '../../lib/auth'
import { subtitleTranscribe, subtitleBurn, type SubSeg } from '../../services/subtitle'
import { loadFont, fontFamily } from '../../utils/coverFonts'

// 字幕样式选项 (跟独立「加字幕」编辑器一致)
const SUB_COLORS: [string, string][] = [
  ['#FFFFFF', '白'], ['#000000', '黑'], ['#FFE14D', '黄'], ['#FF4D4D', '红'],
  ['#FF8C1A', '橙'], ['#3B9EFF', '蓝'], ['#34C759', '绿'], ['#FF6FB5', '粉'],
]
const SUB_STROKES: [number, string][] = [[0, '无'], [0.6, '细'], [1, '中'], [1.8, '粗']]
const fmtT = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`
interface SubFontItem { file: string; label: string }

// BGM 库类目中文名映射
const BGM_CATEGORY_LABEL: Record<string, string> = {
  upbeat: '欢快活力',
  calm: '舒缓平静',
  inspirational: '励志正能量',
  cinematic: '电影感',
  electronic: '电子',
  chinese: '国风',
  other: '其他',
}

interface Props {
  videoUrl: string
  segmentTimes: { start: number; end: number }[]
  narrationOssKey?: string         // 没传则不能合成
  items: FootageSentenceItem[]
  selected: Record<number, VideoAsset[]>
  onClose: () => void
}

// PIP 配置 (V1: 全局, 全片统一)
type PipShape = 'none' | 'circle' | 'rounded' | 'rounded_square'
type PipPos = 'tl' | 'tr' | 'bl' | 'br' | 'center'
type FaceY = 'top' | 'center' | 'bottom'  // 人物在 PIP 内的纵向位置
type OutputRatio = '9:16' | '16:9' | '3:4' | '1:1'  // 最终成品比例

const POS_LABEL: Record<PipPos, string> = { tl: '左上', tr: '右上', bl: '左下', br: '右下', center: '居中' }
// 预设位置 → 小窗中心点 (0-1 比例); 也可直接拖动小窗自由摆放
const POS_XY: Record<PipPos, { x: number; y: number }> = {
  tl: { x: 0.18, y: 0.2 }, tr: { x: 0.82, y: 0.2 }, bl: { x: 0.18, y: 0.8 }, br: { x: 0.82, y: 0.8 }, center: { x: 0.5, y: 0.5 },
}
const FACE_Y_LABEL: Record<FaceY, string> = { top: '人物靠上', center: '居中', bottom: '人物靠下' }
const FACE_Y_POS: Record<FaceY, string> = { top: '20%', center: '50%', bottom: '80%' }
const RATIO_LABEL: Record<OutputRatio, string> = { '9:16': '9:16', '16:9': '16:9', '3:4': '3:4', '1:1': '1:1' }
const RATIO_CSS: Record<OutputRatio, string> = { '9:16': '9/16', '16:9': '16/9', '3:4': '3/4', '1:1': '1/1' }

export function TimelinePreview({ videoUrl, segmentTimes, narrationOssKey, items, selected, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [shape, setShape] = useState<PipShape>('rounded')
  // 画中画位置 = 小窗中心点 (0-1 比例, 可拖动自由摆放); 大小 = 宽占画面比例 (可滑动)
  const [pipX, setPipX] = useState(0.18)
  const [pipY, setPipY] = useState(0.8)
  const [sizePct, setSizePct] = useState(0.25)
  const [dragging, setDragging] = useState(false)
  const previewRef = useRef<HTMLDivElement>(null)
  const [faceY, setFaceY] = useState<FaceY>('top')
  const [outputRatio, setOutputRatio] = useState<OutputRatio>('9:16')
  const [composing, setComposing] = useState(false)
  const [composedUrl, setComposedUrl] = useState<string | null>(null)
  const [composeError, setComposeError] = useState('')
  // 合成 UI 进度: 显示已花时间 + 30s 后给取消按钮
  const [composeElapsed, setComposeElapsed] = useState(0)
  const composeAbortRef = useRef<AbortController | null>(null)

  // 字幕 (合成时一起烧进去, 画中画 + 字幕一次出片)
  const [subOn, setSubOn] = useState(false)
  const [subSegs, setSubSegs] = useState<SubSeg[]>([])
  const [subTranscribing, setSubTranscribing] = useState(false)
  const [subErr, setSubErr] = useState('')
  const [subFontFile, setSubFontFile] = useState('')
  const [subFontScale, setSubFontScale] = useState(1.0)
  const [subColor, setSubColor] = useState('#FFFFFF')
  const [subStrokeWidth, setSubStrokeWidth] = useState(1.0)
  const [subStrokeColor, setSubStrokeColor] = useState('#000000')
  const [subShadow, setSubShadow] = useState(true)
  const [subX, setSubX] = useState(0.5)
  const [subY, setSubY] = useState(0.9)
  const [subDragging, setSubDragging] = useState(false)
  const [subFonts, setSubFonts] = useState<SubFontItem[]>([])
  const [previewBoxH, setPreviewBoxH] = useState(0)

  useEffect(() => {
    if (!composing) { setComposeElapsed(0); return }
    const start = Date.now()
    const id = window.setInterval(() => setComposeElapsed(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => clearInterval(id)
  }, [composing])

  // BGM 状态: 用户上传一个背景音乐 (mp3/wav 等), 合成时跟口播音轨混音 (避免版权)
  const [bgm, setBgm] = useState<{ oss_key: string; name: string; preview_url: string } | null>(null)
  const [bgmVolume, setBgmVolume] = useState(0.3)   // 默认 30%, 不盖过口播
  const [bgmUploading, setBgmUploading] = useState(false)
  const bgmFileRef = useRef<HTMLInputElement>(null)
  const [vocalRemoverOpen, setVocalRemoverOpen] = useState(false)
  // 内置 BGM 库
  const [bgmLibraryOpen, setBgmLibraryOpen] = useState(false)
  const [bgmLibrary, setBgmLibrary] = useState<BgmTrack[] | null>(null)
  const [bgmLibraryLoading, setBgmLibraryLoading] = useState(false)
  const [bgmLibraryError, setBgmLibraryError] = useState('')
  const [bgmPreviewId, setBgmPreviewId] = useState<number | null>(null)
  const previewAudioRef = useRef<HTMLAudioElement | null>(null)

  // 打开 BGM 库时拉一次列表 (没拉过)
  useEffect(() => {
    if (!bgmLibraryOpen || bgmLibrary !== null) return
    setBgmLibraryLoading(true); setBgmLibraryError('')
    listBgmLibrary()
      .then(r => setBgmLibrary(r.bgms || []))
      .catch(e => setBgmLibraryError(e.message || '加载失败'))
      .finally(() => setBgmLibraryLoading(false))
  }, [bgmLibraryOpen, bgmLibrary])

  // 关弹窗时停掉试听
  useEffect(() => {
    if (!bgmLibraryOpen && previewAudioRef.current) {
      previewAudioRef.current.pause()
      previewAudioRef.current = null
      setBgmPreviewId(null)
    }
  }, [bgmLibraryOpen])

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
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken() || ''}` },
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
          x_pct: pipX, y_pct: pipY, size_pct: sizePct, face_y: faceY,
        },
        output_ratio: outputRatio,
        bgm_oss_key: bgm?.oss_key || null,
        bgm_volume: bgmVolume,
      }
      // AbortController 让"取消"按钮真能中断卡死的 fetch
      const ctrl = new AbortController()
      composeAbortRef.current = ctrl
      const res = await fetch(directBase + '/api/voice/compose-footage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken() || ''}` },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.detail || data.error || `合成失败 (${res.status})`)
      }
      // 成品的最终 url/key — 默认就是合成结果; 若开了字幕, 在合成结果上再烧字幕
      let finalUrl: string = data.video_url
      let finalKey: string = data.output_oss_key
      const subClean = subOn ? subSegs.filter(s => s.text.trim()) : []
      if (subClean.length && data.output_oss_key) {
        const burned = await subtitleBurn({
          video_oss_key: data.output_oss_key, segments: subClean,
          font_scale: subFontScale, color: subColor,
          font_file: subFontFile, stroke_color: subStrokeColor, stroke_width: subStrokeWidth, shadow: subShadow,
          x_pct: subX, y_pct: subY,
        })
        finalUrl = burned.video_url; finalKey = burned.output_oss_key
      }
      setComposedUrl(finalUrl)

      // 把成品视频注入对话, 立刻关弹窗 — 结果已经在对话流里, 弹窗里不再重复展示
      const convId = chatStore.activeId
      if (convId) {
        // 构造 jianying_payload: 后续 VideoPlayer 里的"导出剪映草稿"按钮点击时直接拿这个调端点
        // 用原始 narrationOssKey (口播视频) 而非 output_oss_key (合成后成品), 这样剪映草稿是按句分段的
        const jianyingPayload = narrationOssKey ? {
          narration_oss_key: narrationOssKey,
          output_ratio: outputRatio,
          shots: segmentTimes.map((seg, i) => ({
            start: seg.start,
            end: seg.end,
            text: items[i]?.text || '',
            assets: (selected[i] || [])
              .filter(a => a.oss_key || (a.preview_url && /\.(mp4|mov|webm|mkv)(\?|$)/i.test(a.preview_url)))
              .map(a => ({
                url: a.oss_key ? '' : (a.preview_url || ''),
                oss_key: a.oss_key,
                duration: a.duration || 0,
              })),
          })),
        } : undefined
        const msg = makeAssistantMsg([
          {
            type: 'video_player',
            data: {
              video_url: finalUrl,
              duration_ms: data.duration ? Math.round(data.duration * 1000) : undefined,
              audio_label: subClean.length ? '一键合成 (带字幕)' : '一键合成',
              source: 'ai_generated' as const,
              narration_oss_key: finalKey,   // 给封面/后续模块用
              jianying_payload: jianyingPayload,
            },
          },
          { type: 'text', content: '成品视频已合成' },
          {
            type: 'choices',
            question: '下一步',
            options: [
              { id: '__form_cover__', label: '生成封面', description: '截帧 + 模板, 输出多比例' },
              { id: '__form_publish__', label: '去发布', description: '上传到小红书 / 抖音' },
              { id: '保留这段视频, 暂不做下一步', label: '保留视频', description: '稍后再决定' },
            ],
          },
        ])
        chatStore.addMessage(convId, msg)
      }
      onClose()
    } catch (e: any) {
      // AbortError: 用户主动点取消, 不报错
      if (e?.name === 'AbortError') {
        setComposeError('已取消合成')
      } else {
        setComposeError(humanizeNetworkError(e))
      }
    } finally {
      setComposing(false)
      composeAbortRef.current = null
    }
  }

  const cancelCompose = () => {
    composeAbortRef.current?.abort()
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

  // PIP 样式 (CSS 预览, 跟最终 ffmpeg 合成保持一致): 中心点定位, 可拖动
  const pipStyle: React.CSSProperties = {
    position: 'absolute',
    overflow: 'hidden',
    left: `${pipX * 100}%`,
    top: `${pipY * 100}%`,
    transform: 'translate(-50%, -50%)',
    borderRadius: shape === 'circle' ? '50%' : '12px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
    cursor: dragging ? 'grabbing' : 'grab',
    touchAction: 'none',
  }

  // 拖动小窗: 指针位置 → 中心点比例 (0-1), 夹在 5%-95% 防拖出画面外
  const onPipPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    try { (e.target as HTMLElement).setPointerCapture(e.pointerId) } catch { /* noop */ }
    setDragging(true)
  }
  const onPipPointerMove = (e: React.PointerEvent) => {
    if (!dragging || !previewRef.current) return
    const r = previewRef.current.getBoundingClientRect()
    if (!r.width || !r.height) return
    setPipX(Math.min(0.95, Math.max(0.05, (e.clientX - r.left) / r.width)))
    setPipY(Math.min(0.95, Math.max(0.05, (e.clientY - r.top) / r.height)))
  }
  const onPipPointerUp = (e: React.PointerEvent) => {
    setDragging(false)
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* noop */ }
  }

  // 字幕: 识别口播语音拿可编辑字幕条 (时间跟成品对齐, 口播是主轨)
  const transcribeSub = async () => {
    if (!narrationOssKey) { setSubErr('缺少口播视频, 无法识别字幕'); return }
    setSubTranscribing(true); setSubErr('')
    try {
      const r = await subtitleTranscribe({ video_oss_key: narrationOssKey })
      setSubSegs(r.segments || [])
      if (!r.segments?.length) setSubErr('没识别到语音')
    } catch (e: any) {
      setSubErr(e.message || '识别失败')
    } finally {
      setSubTranscribing(false)
    }
  }
  const updateSubText = (i: number, text: string) => setSubSegs(prev => prev.map((s, j) => j === i ? { ...s, text } : s))
  const removeSubSeg = (i: number) => setSubSegs(prev => prev.filter((_, j) => j !== i))

  // 字幕拉字体列表 (开字幕时才拉)
  useEffect(() => {
    if (!subOn || subFonts.length) return
    fetch(directBase + '/api/voice/cover-fonts').then(r => r.json()).then(d => {
      const list: SubFontItem[] = (d.fonts || []).map((f: any) => ({ file: f.file, label: f.label || f.file }))
      setSubFonts(list); list.slice(0, 16).forEach(f => loadFont(f.file))
    }).catch(() => { /* 用默认字体 */ })
  }, [subOn])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (subFontFile) loadFont(subFontFile) }, [subFontFile])
  useEffect(() => {
    const el = previewRef.current
    if (!el) return
    setPreviewBoxH(el.getBoundingClientRect().height)
    const ro = new ResizeObserver(es => setPreviewBoxH(es[0].contentRect.height))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 字幕拖动 (中心点比例)
  const onSubPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    try { (e.target as HTMLElement).setPointerCapture(e.pointerId) } catch { /* noop */ }
    setSubDragging(true)
  }
  const onSubPointerMove = (e: React.PointerEvent) => {
    if (!subDragging || !previewRef.current) return
    const r = previewRef.current.getBoundingClientRect()
    if (!r.width || !r.height) return
    setSubX(Math.min(0.95, Math.max(0.05, (e.clientX - r.left) / r.width)))
    setSubY(Math.min(0.95, Math.max(0.05, (e.clientY - r.top) / r.height)))
  }
  const onSubPointerUp = (e: React.PointerEvent) => {
    setSubDragging(false)
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* noop */ }
  }
  const subPreviewText = subSegs[0]?.text || '字幕预览'
  const subFontPx = Math.max(10, previewBoxH * 0.05 * subFontScale)
  const subStrokePx = subStrokeWidth > 0 ? Math.max(1, subFontPx * 0.07 * subStrokeWidth) : 0
  const subPreviewStyle: React.CSSProperties = {
    fontFamily: subFontFile ? `"${fontFamily(subFontFile)}", sans-serif` : 'sans-serif',
    color: subColor, fontSize: subFontPx, fontWeight: 800, lineHeight: 1.25, textAlign: 'center',
    maxWidth: '86%', whiteSpace: 'pre-wrap',
    textShadow: subShadow ? '2px 2px 5px rgba(0,0,0,0.75)' : 'none',
    WebkitTextStroke: subStrokePx > 0 ? `${subStrokePx}px ${subStrokeColor}` : undefined,
    paintOrder: 'stroke fill', pointerEvents: 'auto', touchAction: 'none',
    cursor: subDragging ? 'grabbing' : 'grab',
  } as React.CSSProperties
  const subBtn = (active: boolean) =>
    `px-2.5 py-1 rounded-lg border text-xs cursor-pointer transition-colors ${active
      ? 'border-[var(--text)] bg-[var(--text)] text-[var(--bg)]'
      : 'border-[var(--border)] text-[var(--text-2)] hover:border-[var(--text)]'}`

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
              ref={previewRef}
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
                onPointerDown={currentBroll && shape !== 'none' ? onPipPointerDown : undefined}
                onPointerMove={currentBroll && shape !== 'none' ? onPipPointerMove : undefined}
                onPointerUp={currentBroll && shape !== 'none' ? onPipPointerUp : undefined}
                style={!currentBroll ? {
                  // 没素材的镜头: video 全屏
                  position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
                } : shape === 'none' ? {
                  // 无 PIP 模式: video 缩到 1px 隐藏 (保留音频), b-roll 全屏
                  position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none',
                } : {
                  // PIP 模式 (可拖动)
                  ...pipStyle,
                  width: `${sizePct * 100}%`,
                  aspectRatio: shape === 'circle' ? '1/1' : '16/9',
                  objectFit: 'cover',
                  objectPosition: `center ${FACE_Y_POS[faceY]}`,
                }}
              />
              {/* 字幕示意层 (开字幕时显示, 可拖动; 跟画中画同框, 一起看效果) */}
              {subOn && subSegs.length > 0 && (
                <div className="absolute pointer-events-none" style={{ left: `${subX * 100}%`, top: `${subY * 100}%`, transform: 'translate(-50%, -50%)', width: '86%', display: 'flex', justifyContent: 'center' }}>
                  <span onPointerDown={onSubPointerDown} onPointerMove={onSubPointerMove} onPointerUp={onSubPointerUp} style={subPreviewStyle}>{subPreviewText}</span>
                </div>
              )}
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
                {(['9:16', '16:9', '3:4', '1:1'] as OutputRatio[]).map(r => (
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
                {(['none', 'rounded', 'rounded_square', 'circle'] as PipShape[]).map(s => (
                  <button
                    key={s}
                    onClick={() => setShape(s)}
                    className={`px-3 py-1.5 rounded-lg text-xs border transition-all cursor-pointer ${shape === s ? 'bg-[var(--text)] text-[var(--bg)] border-[var(--text)]' : 'bg-[var(--bg-card)] text-[var(--text-2)] border-[var(--border)] hover:border-[var(--text-3)]'}`}
                  >
                    {s === 'none' ? '× 无小窗'
                      : s === 'circle' ? '○ 圆形'
                      : s === 'rounded_square' ? '◼ 圆角方形'
                      : '▢ 圆角矩形'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-start gap-3">
              <span className="text-xs text-[var(--text-3)] w-16 mt-1.5">位置</span>
              <div className="flex flex-col gap-1.5">
                <div className="flex gap-2 flex-wrap">
                  {(['tl', 'tr', 'bl', 'br', 'center'] as PipPos[]).map(p => (
                    <button
                      key={p}
                      onClick={() => { setPipX(POS_XY[p].x); setPipY(POS_XY[p].y) }}
                      className="px-3 py-1.5 rounded-lg text-xs border bg-[var(--bg-card)] text-[var(--text-2)] border-[var(--border)] hover:border-[var(--text)] transition-all cursor-pointer"
                    >
                      {POS_LABEL[p]}
                    </button>
                  ))}
                </div>
                <span className="text-[11px] text-[var(--text-3)]">↑ 快捷预设, 也可直接用手指/鼠标拖动上面的小窗到任意位置 (避开字幕)</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs text-[var(--text-3)] w-16">大小</span>
              <input
                type="range" min={0.15} max={0.5} step={0.01} value={sizePct}
                onChange={e => setSizePct(parseFloat(e.target.value))}
                className="flex-1 accent-[var(--text)] cursor-pointer"
              />
              <span className="text-xs text-[var(--text-3)] w-10 text-right tabular-nums">{Math.round(sizePct * 100)}%</span>
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

          {/* 字幕配置 (合成时一起烧进画面, 画中画 + 字幕一次出片) */}
          <div className="border border-[var(--border)] rounded-xl p-3 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-[var(--text-2)]">字幕 (合成时一起烧进画面)</div>
              <div className="flex gap-2">
                <button onClick={() => { setSubOn(true); if (!subSegs.length && !subTranscribing) transcribeSub() }} className={subBtn(subOn)}>开</button>
                <button onClick={() => setSubOn(false)} className={subBtn(!subOn)}>关</button>
              </div>
            </div>

            {subOn && (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={transcribeSub} disabled={subTranscribing}
                    className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-xs text-[var(--text-2)] hover:border-[var(--text)] cursor-pointer disabled:opacity-50">
                    {subTranscribing ? '识别中…' : (subSegs.length ? '重新识别' : '识别字幕')}
                  </button>
                  {subSegs.length > 0 && <span className="text-[11px] text-[var(--text-3)]">已识别 {subSegs.length} 句 (可改错别字 / 删多余)</span>}
                  {subErr && <span className="text-[11px] text-red-400">{subErr}</span>}
                </div>

                {subSegs.length > 0 && (
                  <div className="max-h-40 overflow-y-auto flex flex-col gap-1.5 pr-1">
                    {subSegs.map((s, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-[10px] text-[var(--text-3)] font-mono w-10 flex-shrink-0">{fmtT(s.start)}</span>
                        <input value={s.text} onChange={e => updateSubText(i, e.target.value)}
                          className="flex-1 min-w-0 px-2 py-1 rounded-lg bg-[var(--bg-input)] border border-[var(--border)] text-xs focus:border-[var(--text)] outline-none"/>
                        <button onClick={() => removeSubSeg(i)} className="text-[var(--text-3)] hover:text-red-400 cursor-pointer flex-shrink-0 text-xs" title="删除">✕</button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <span className="text-xs text-[var(--text-3)] w-12">字体</span>
                  <select value={subFontFile} onChange={e => setSubFontFile(e.target.value)}
                    className="flex-1 px-2 py-1.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border)] text-xs text-[var(--text)] outline-none cursor-pointer">
                    <option value="">默认 (思源黑体)</option>
                    {subFonts.map(f => <option key={f.file} value={f.file}>{f.label}</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-[var(--text-3)] w-12">字号</span>
                  <input type="range" min={0.6} max={1.6} step={0.05} value={subFontScale} onChange={e => setSubFontScale(parseFloat(e.target.value))} className="flex-1 accent-[var(--text)] cursor-pointer"/>
                  <span className="text-[11px] text-[var(--text-3)] w-9 text-right tabular-nums">{Math.round(subFontScale * 100)}%</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-[var(--text-3)] w-12">颜色</span>
                  <div className="flex flex-wrap gap-1.5">
                    {SUB_COLORS.map(([c, l]) => <button key={c} title={l} onClick={() => setSubColor(c)} className={`w-5 h-5 rounded-full border-2 cursor-pointer ${subColor === c ? 'border-[var(--text)] scale-110' : 'border-[var(--border)]'}`} style={{ background: c }}/>)}
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-xs text-[var(--text-3)] w-12">描边</span>
                  <div className="flex gap-1.5">
                    {SUB_STROKES.map(([w, l]) => <button key={l} onClick={() => setSubStrokeWidth(w)} className={subBtn(subStrokeWidth === w)}>{l}</button>)}
                  </div>
                  {subStrokeWidth > 0 && (['#000000', '#FFFFFF'] as const).map(c => <button key={c} title={c === '#000000' ? '黑边' : '白边'} onClick={() => setSubStrokeColor(c)} className={`w-5 h-5 rounded-full border-2 cursor-pointer ${subStrokeColor === c ? 'border-[var(--text)] scale-110' : 'border-[var(--border)]'}`} style={{ background: c }}/>)}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-[var(--text-3)] w-12">阴影</span>
                  <div className="flex gap-2">
                    <button onClick={() => setSubShadow(true)} className={subBtn(subShadow)}>开</button>
                    <button onClick={() => setSubShadow(false)} className={subBtn(!subShadow)}>关</button>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-[var(--text-3)] w-12">位置</span>
                  <div className="flex gap-2">
                    {([['底部', 0.9], ['中间', 0.5], ['顶部', 0.1]] as const).map(([l, y]) => <button key={l} onClick={() => { setSubX(0.5); setSubY(y) }} className={subBtn(Math.abs(subX - 0.5) < 0.02 && Math.abs(subY - y) < 0.02)}>{l}</button>)}
                  </div>
                </div>
                <span className="text-[11px] text-[var(--text-3)]">字幕跟画中画在上面预览里一起看 · 可直接拖动字幕到任意位置 · 合成时一次烧进视频 (+3 积分)</span>
              </>
            )}
          </div>

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
              <div className="flex flex-col gap-2">
                {/* 扫对话历史里去人声生成的 BGM, 让用户能直接选 */}
                {(() => {
                  const conv = chatStore.conversations.find(c => c.id === chatStore.activeId)
                  if (!conv) return null
                  const bgmHistory: { oss_key: string; name: string; duration?: number }[] = []
                  for (const msg of conv.messages) {
                    for (const block of msg.blocks) {
                      if (block.type === 'audio_player' && (block.data as any).source === 'vocal_removed_bgm' && (block.data as any).oss_key) {
                        bgmHistory.push({
                          oss_key: (block.data as any).oss_key,
                          name: (block.data as any).voice_label || 'BGM',
                          duration: (block.data as any).duration_seconds,
                        })
                      }
                    }
                  }
                  if (bgmHistory.length === 0) return null
                  return (
                    <div className="border border-[var(--border)] rounded-lg p-2 flex flex-col gap-1">
                      <div className="text-[10px] text-[var(--text-3)] px-1">从去人声历史选 ({bgmHistory.length} 首)</div>
                      {bgmHistory.slice().reverse().map((h, i) => (
                        <button key={h.oss_key + i}
                          onClick={() => setBgm({ oss_key: h.oss_key, name: h.name, preview_url: '' })}
                          className="flex items-center justify-between px-2 py-1.5 rounded text-xs text-[var(--text-2)] hover:bg-[var(--bg-hover)] cursor-pointer">
                          <span className="truncate flex-1 text-left">🎵 {h.name}</span>
                          {h.duration && <span className="text-[10px] text-[var(--text-3)] flex-shrink-0 ml-2">{h.duration.toFixed(0)}s</span>}
                        </button>
                      ))}
                    </div>
                  )
                })()}
                <button
                  onClick={() => setBgmLibraryOpen(true)}
                  className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-[var(--border)] text-xs text-[var(--text)] bg-[var(--bg-hover)] hover:bg-[var(--bg-card)] cursor-pointer transition-all"
                >
                  <Library size={14}/> 从内置 BGM 库选 (商用授权)
                </button>
                <button
                  onClick={() => bgmFileRef.current?.click()}
                  disabled={bgmUploading}
                  className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-dashed border-[var(--border)] text-xs text-[var(--text-2)] hover:bg-[var(--bg-hover)] hover:border-[var(--text-3)] cursor-pointer disabled:opacity-50 transition-all"
                >
                  {bgmUploading ? <><Loader2 size={14} className="animate-spin"/> 上传中...</> : <><Upload size={14}/> 上传自己的 BGM</>}
                </button>
                <button
                  onClick={() => setVocalRemoverOpen(true)}
                  className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-[11px] text-[var(--text-2)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
                >
                  <Sparkles size={12}/> 或者: 上传有人声的歌, AI 自动去人声做 BGM
                </button>
              </div>
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

        {/* 去人声弹窗 — 完成后直接当 BGM 用 (bypass 第二次 OSS 上传) */}
        <VocalRemoverDialog
          open={vocalRemoverOpen}
          onClose={() => setVocalRemoverOpen(false)}
          onUseAsBgm={(oss_key, name) => {
            setBgm({ oss_key, name, preview_url: '' })
          }}
        />

        {/* 内置 BGM 库 选择弹窗 */}
        {bgmLibraryOpen && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
            onClick={() => setBgmLibraryOpen(false)}
          >
            <div
              onClick={e => e.stopPropagation()}
              className="relative bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-ios-lg w-full max-w-2xl max-h-[80vh] p-6 flex flex-col gap-3"
            >
              <button
                onClick={() => setBgmLibraryOpen(false)}
                className="absolute top-4 right-4 p-1 rounded text-[var(--text-3)] hover:bg-[var(--bg-hover)] cursor-pointer"
              >
                <X size={14}/>
              </button>

              <div>
                <div className="flex items-center gap-2 text-base font-semibold">
                  <Library size={18}/> 内置 BGM 库
                </div>
                <div className="text-xs text-[var(--text-3)] mt-1">
                  官方精选, 商用授权安全使用 · 点 ▶ 试听, 点 "选用" 加到当前合成
                </div>
              </div>

              {bgmLibraryLoading && (
                <div className="flex items-center justify-center py-12 text-sm text-[var(--text-3)]">
                  <Loader2 size={16} className="animate-spin mr-2"/> 加载中...
                </div>
              )}
              {bgmLibraryError && (
                <div className="text-xs text-red-400 bg-red-950/20 border border-red-900/30 rounded-lg px-3 py-2">
                  {bgmLibraryError}
                </div>
              )}

              {bgmLibrary && bgmLibrary.length === 0 && !bgmLibraryLoading && (
                <div className="text-center py-12 text-sm text-[var(--text-3)]">
                  BGM 库还没添加曲目, 请联系管理员上传
                </div>
              )}

              {bgmLibrary && bgmLibrary.length > 0 && (
                <div className="flex-1 overflow-y-auto pr-1 -mr-1 flex flex-col gap-4">
                  {/* 按类目分组 */}
                  {Object.entries(
                    bgmLibrary.reduce<Record<string, BgmTrack[]>>((acc, t) => {
                      const key = t.category || 'other'
                      ;(acc[key] = acc[key] || []).push(t)
                      return acc
                    }, {})
                  ).map(([cat, tracks]) => (
                    <div key={cat}>
                      <div className="text-[11px] text-[var(--text-3)] mb-2 px-1">
                        {BGM_CATEGORY_LABEL[cat] || cat} · {tracks.length} 首
                      </div>
                      <div className="flex flex-col gap-1">
                        {tracks.map(t => (
                          <div
                            key={t.id}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border)] hover:bg-[var(--bg-hover)]"
                          >
                            <button
                              onClick={() => {
                                // 停掉旧的
                                if (previewAudioRef.current) {
                                  previewAudioRef.current.pause()
                                  previewAudioRef.current = null
                                }
                                if (bgmPreviewId === t.id) {
                                  setBgmPreviewId(null)
                                  return
                                }
                                const a = new Audio(t.preview_url)
                                a.play().catch(() => {})
                                a.onended = () => setBgmPreviewId(null)
                                previewAudioRef.current = a
                                setBgmPreviewId(t.id)
                              }}
                              className="w-7 h-7 flex-shrink-0 rounded-full bg-[var(--bg-hover)] hover:bg-[var(--text)] hover:text-[var(--bg)] flex items-center justify-center cursor-pointer transition-colors"
                              title={bgmPreviewId === t.id ? '停止' : '试听'}
                            >
                              {bgmPreviewId === t.id ? <Pause size={12}/> : <Play size={12}/>}
                            </button>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm text-[var(--text)] truncate">{t.name}</div>
                              {t.license_note && (
                                <div className="text-[10px] text-[var(--text-3)] truncate">{t.license_note}</div>
                              )}
                            </div>
                            {t.duration_seconds > 0 && (
                              <span className="text-[10px] text-[var(--text-3)] flex-shrink-0">
                                {t.duration_seconds.toFixed(0)}s
                              </span>
                            )}
                            <button
                              onClick={() => {
                                setBgm({ oss_key: t.oss_key, name: t.name, preview_url: t.preview_url })
                                if (previewAudioRef.current) {
                                  previewAudioRef.current.pause()
                                  previewAudioRef.current = null
                                }
                                setBgmPreviewId(null)
                                setBgmLibraryOpen(false)
                              }}
                              className="px-3 py-1 rounded text-xs bg-[var(--text)] text-[var(--bg)] hover:opacity-80 cursor-pointer flex-shrink-0"
                            >
                              选用
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 合成结果区 (合成完显示) */}
        {/* 合成失败时显示错误 (成功直接关弹窗, 不在弹窗里重复展示视频) */}
        {composeError && (
          <div className="px-5 pb-2">
            <div className="text-xs text-red-400 bg-red-950/20 border border-red-900/30 rounded-lg px-3 py-2">
              {composeError}
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--border)]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-[var(--text-2)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors cursor-pointer"
          >
            关闭
          </button>
          {/* 合成中超过 30s 才出现取消按钮, 避免短任务误触 */}
          {composing && composeElapsed >= 30 && (
            <button
              onClick={cancelCompose}
              className="px-4 py-2 text-sm rounded-lg border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
              title="放弃这次合成, 不扣的积分会自动退"
            >
              取消
            </button>
          )}
          <button
            onClick={handleCompose}
            disabled={composing || !narrationOssKey}
            title={!narrationOssKey ? '缺少口播视频, 走口播剪辑流程后再试' : '后端 ffmpeg 合成, 通常 5-30 秒, 长视频可能 1-2 分钟'}
            className={`px-4 py-2 text-sm rounded-lg transition-all inline-flex items-center gap-2 ${
              composing || !narrationOssKey
                ? 'bg-[var(--bg-hover)] text-[var(--text-3)] cursor-not-allowed'
                : 'bg-[var(--text)] text-[var(--bg)] hover:opacity-80 cursor-pointer'
            }`}
          >
            {composing ? <><Loader2 size={14} className="animate-spin"/> 合成中 {composeElapsed}s</> : (composedUrl ? '重新合成' : (subOn && subSegs.length ? '一键合成 (带字幕)' : '一键合成'))}
          </button>
        </div>
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}
