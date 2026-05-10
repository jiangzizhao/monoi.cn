import { useRef, useState } from 'react'
import { RefreshCw, Pencil, Download, Check, ExternalLink, Play, Upload, Loader2 } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { searchPexels } from '../../services/pexels'
import { searchPixabay } from '../../services/pixabay'
import type { FootageSentenceItem, VideoAsset } from '../../types'
import { TimelinePreview } from './TimelinePreview'

// 浏览器侧截视频首帧做缩略图 (avoid 上传服务器再下回来)
function captureFirstFrame(videoUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const v = document.createElement('video')
    v.src = videoUrl
    v.crossOrigin = 'anonymous'
    v.muted = true
    v.playsInline = true
    v.preload = 'metadata'
    v.onloadeddata = () => {
      v.currentTime = Math.min(0.5, (v.duration || 1) / 2)
    }
    v.onseeked = () => {
      const canvas = document.createElement('canvas')
      canvas.width = v.videoWidth || 320
      canvas.height = v.videoHeight || 180
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
        try {
          resolve(canvas.toDataURL('image/jpeg', 0.7))
        } catch {
          resolve('')   // CORS 等情况不出 base64, 用空 (前端会显示占位)
        }
      } else resolve('')
    }
    v.onerror = () => resolve('')
  })
}

function probeDuration(videoUrl: string): Promise<number> {
  return new Promise((resolve) => {
    const v = document.createElement('video')
    v.src = videoUrl
    v.preload = 'metadata'
    v.onloadedmetadata = () => resolve(v.duration || 0)
    v.onerror = () => resolve(0)
  })
}

function AssetThumb({ asset, selected, onSelect }: { asset: VideoAsset; selected: boolean; onSelect: () => void }) {
  return (
    <div onClick={onSelect}
      className={`relative aspect-video rounded-lg overflow-hidden cursor-pointer border-2 transition-all duration-150 group ${selected ? 'border-[var(--text)]' : 'border-transparent hover:border-[var(--text-3)]'}`}>
      {asset.thumbnail ? (
        <img src={asset.thumbnail} alt="" className="w-full h-full object-cover"/>
      ) : (
        <div className="w-full h-full bg-[var(--bg-hover)] flex items-center justify-center text-[var(--text-3)]">
          <Play size={20}/>
        </div>
      )}
      {selected && <div className="absolute inset-0 bg-[var(--text)]/20 flex items-center justify-center"><Check size={20} className="text-white drop-shadow"/></div>}
      <div className="absolute top-1 left-1">
        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium text-white bg-black/60">
          {asset.source === 'pexels' ? 'P' : asset.source === 'pixabay' ? 'Px' : '自传'}
        </span>
      </div>
      <a href={asset.source_url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
        className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded bg-black/60">
        <ExternalLink size={10} className="text-white"/>
      </a>
      {/* 右下: 视频时长 (告诉用户这是视频不是图片, 缩略图只是封面帧) */}
      <div className="absolute bottom-1 right-1 flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px] font-medium">
        <Play size={8} className="fill-white" strokeWidth={0}/>
        {asset.duration ? `${Math.round(asset.duration)}s` : '视频'}
      </div>
    </div>
  )
}

function SentenceRow({ item, index, selected, onToggle, onRefresh, onAddAsset }: {
  item: FootageSentenceItem; index: number; selected: VideoAsset[]
  onToggle: (a: VideoAsset) => void; onRefresh: (kw: string) => void
  onAddAsset: (asset: VideoAsset) => void
}) {
  const isSelected = (a: VideoAsset) => selected.some(s => s.id === a.id && s.source === a.source)
  const [expanded, setExpanded] = useState(true)
  const [editing, setEditing] = useState(false)
  const [kw, setKw] = useState(item.search_en[0] || '')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const directBase = import.meta.env.VITE_DIRECT_API_URL || 'https://monoi.nat100.top'

  const handleUploadFile = async (file: File) => {
    if (file.size > 200 * 1024 * 1024) {
      alert('视频太大 (>200MB), 建议先压缩')
      return
    }
    setUploading(true)
    try {
      // 1. 拿 OSS 签名
      const signRes = await fetch(directBase + '/api/oss/sign-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, content_type: file.type || 'video/mp4' }),
      })
      if (!signRes.ok) throw new Error(`签名失败 (${signRes.status})`)
      const { put_url, oss_key, content_type } = await signRes.json()

      // 2. PUT 直传 OSS
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.onload = () => { (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error(`PUT ${xhr.status}`)) }
        xhr.onerror = () => reject(new Error('网络错误'))
        xhr.open('PUT', put_url)
        xhr.setRequestHeader('Content-Type', content_type)
        xhr.send(file)
      })

      // 3. 截首帧做缩略图 (浏览器 video + canvas)
      const previewUrl = URL.createObjectURL(file)
      const thumbnail = await captureFirstFrame(previewUrl)
      // 探测 duration
      const duration = await probeDuration(previewUrl)
      URL.revokeObjectURL(previewUrl)

      // 4. 拼出 OSS 公开下载 URL (需要后端签 GET URL, 这里用 sign-upload 的桶推测)
      // 简化: 让后端在 sign-upload 也返回签名 GET URL. 现在先用 oss_key 做 placeholder
      const ossPublicUrl = `https://monoi-temp.oss-cn-shenzhen.aliyuncs.com/${oss_key}`

      // 5. 加到 assets (存 oss_key, 后端合成时从这个 key 拉)
      const asset: VideoAsset = {
        id: `upload_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        thumbnail,
        preview_url: ossPublicUrl,
        source_url: ossPublicUrl,
        source: 'upload',
        duration,
        oss_key,
      }
      onAddAsset(asset)
    } catch (e: any) {
      alert(`上传失败: ${e.message}`)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="border border-[var(--border)] rounded-xl overflow-hidden">
      <div className="flex items-start gap-2 px-3.5 py-2.5 cursor-pointer hover:bg-[var(--bg-hover)] transition-colors" onClick={() => setExpanded(v => !v)}>
        <span className="text-xs font-mono text-[var(--text-3)] flex-shrink-0 mt-0.5">{index + 1}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-[var(--text)] leading-snug">{item.text}</div>
          {item.scene && <div className="text-xs text-[var(--text-3)] mt-0.5">{item.scene}</div>}
          <div className="flex flex-wrap gap-1 mt-1.5">
            {item.search_en.map(k => <Badge key={k} color="default">{k}</Badge>)}
            <Badge color="amber">{item.duration}s</Badge>
          </div>
        </div>
        <div className="flex gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="p-1.5 rounded-lg text-[var(--text-3)] hover:text-[var(--text-2)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer disabled:opacity-50"
            title="上传你自己的视频"
          >
            {uploading ? <Loader2 size={13} className="animate-spin"/> : <Upload size={13}/>}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleUploadFile(f)
              if (fileRef.current) fileRef.current.value = ''
            }}
          />
          <button onClick={() => onRefresh(kw)} className="p-1.5 rounded-lg text-[var(--text-3)] hover:text-[var(--text-2)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer" title="换一批">
            <RefreshCw size={13}/>
          </button>
          <button onClick={() => setEditing(v => !v)} className="p-1.5 rounded-lg text-[var(--text-3)] hover:text-[var(--text-2)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer" title="编辑关键词">
            <Pencil size={13}/>
          </button>
        </div>
      </div>

      {editing && (
        <div className="px-3.5 pb-2.5 flex gap-2" onClick={e => e.stopPropagation()}>
          <input value={kw} onChange={e => setKw(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { onRefresh(kw); setEditing(false) } }}
            className="flex-1 bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-xs text-[var(--text)] focus:outline-none focus:border-[var(--text-3)] transition-colors"
            placeholder="修改关键词后回车搜索"/>
          <button onClick={() => { onRefresh(kw); setEditing(false) }}
            className="px-2.5 py-1.5 rounded-lg bg-[var(--text)] text-[var(--bg)] text-xs cursor-pointer hover:opacity-80 transition-opacity">搜索</button>
        </div>
      )}

      {expanded && (
        <div className="px-3.5 pb-3">
          {item.loadingAssets ? (
            <div className="grid grid-cols-3 gap-2">
              {[...Array(6)].map((_, i) => <div key={i} className="aspect-video rounded-lg bg-[var(--bg-hover)] animate-pulse"/>)}
            </div>
          ) : item.assets && item.assets.length > 0 ? (
            <div className="grid grid-cols-3 gap-2">
              {item.assets.map(a => (
                <AssetThumb key={`${a.source}-${a.id}`} asset={a} selected={isSelected(a)} onSelect={() => onToggle(a)}/>
              ))}
            </div>
          ) : (
            <div className="text-xs text-[var(--text-3)] py-2">暂无结果，试试修改关键词</div>
          )}
        </div>
      )}
    </div>
  )
}

export function FootageGrid({ data, videoUrl, segmentTimes, narrationOssKey, onUpdate }: {
  data: FootageSentenceItem[]
  videoUrl?: string
  segmentTimes?: { start: number; end: number }[]
  narrationOssKey?: string
  msgId?: string; blockIndex?: number
  onUpdate: (newData: FootageSentenceItem[]) => void
}) {
  const [selected, setSelected] = useState<Record<number, VideoAsset[]>>({})
  const [previewOpen, setPreviewOpen] = useState(false)

  const refresh = async (index: number, keyword: string) => {
    const updated = data.map((it, i) => i === index ? { ...it, loadingAssets: true } : it)
    onUpdate(updated)
    const [p, px] = await Promise.all([searchPexels(keyword, 6), searchPixabay(keyword, 3)])
    onUpdate(data.map((it, i) => i === index ? { ...it, assets: [...p, ...px], loadingAssets: false } : it))
  }

  const toggle = (sentenceIdx: number, asset: VideoAsset) => {
    setSelected(prev => {
      const list = prev[sentenceIdx] || []
      const exists = list.some(s => s.id === asset.id && s.source === asset.source)
      const next = exists
        ? list.filter(s => !(s.id === asset.id && s.source === asset.source))
        : [...list, asset]
      return { ...prev, [sentenceIdx]: next }
    })
  }

  const exportList = () => {
    const lines = Object.entries(selected)
      .filter(([_, list]) => list.length > 0)
      .map(([i, list]) => {
        const s = data[Number(i)]
        const items = list.map((a, idx) => `  ${idx + 1}. [${a.source}] ${a.source_url}`).join('\n')
        return `句子 ${Number(i)+1}：${s?.text}\n${items}`
      }).join('\n\n---\n\n')
    const blob = new Blob([lines], { type: 'text/plain' })
    const el = document.createElement('a'); el.href = URL.createObjectURL(blob); el.download = 'footage.txt'; el.click()
  }

  const selTotal = Object.values(selected).reduce((sum, list) => sum + list.length, 0)
  const selSentenceCount = Object.values(selected).filter(l => l.length > 0).length

  return (
    <div className="w-full flex flex-col gap-2">
      {data.map((item, i) => (
        <SentenceRow key={i} item={item} index={i}
          selected={selected[i] || []}
          onToggle={a => toggle(i, a)}
          onRefresh={kw => refresh(i, kw)}
          onAddAsset={a => {
            // 加到这一句的 assets 顶部, 同时自动选上 (用户多半上传完就要用)
            const newData = data.map((it, j) => j === i ? { ...it, assets: [a, ...(it.assets || [])] } : it)
            onUpdate(newData)
            toggle(i, a)
          }}/>
      ))}
      {selTotal > 0 && (
        <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-[var(--bg-hover)] border border-[var(--border)]">
          <span className="text-xs text-[var(--text-2)]">已选 {selTotal} 个素材 · 覆盖 {selSentenceCount} / {data.length} 句</span>
          <div className="flex gap-2">
            {videoUrl && segmentTimes && (
              <button
                onClick={() => setPreviewOpen(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--text)] text-[var(--bg)] text-xs cursor-pointer hover:opacity-80 transition-opacity"
              >
                <Play size={12}/> 预览效果
              </button>
            )}
            <button onClick={exportList} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--bg-card)] text-xs cursor-pointer transition-colors">
              <Download size={12}/> 导出清单
            </button>
          </div>
        </div>
      )}

      {previewOpen && videoUrl && segmentTimes && (
        <TimelinePreview
          videoUrl={videoUrl}
          segmentTimes={segmentTimes}
          narrationOssKey={narrationOssKey}
          items={data}
          selected={selected}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </div>
  )
}
