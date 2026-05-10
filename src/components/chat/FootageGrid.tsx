import { useState } from 'react'
import { RefreshCw, Pencil, Download, Check, ExternalLink, Play } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { searchPexels } from '../../services/pexels'
import { searchPixabay } from '../../services/pixabay'
import type { FootageSentenceItem, VideoAsset } from '../../types'
import { TimelinePreview } from './TimelinePreview'

function AssetThumb({ asset, selected, onSelect }: { asset: VideoAsset; selected: boolean; onSelect: () => void }) {
  return (
    <div onClick={onSelect}
      className={`relative aspect-video rounded-lg overflow-hidden cursor-pointer border-2 transition-all duration-150 group ${selected ? 'border-[var(--text)]' : 'border-transparent hover:border-[var(--text-3)]'}`}>
      <img src={asset.thumbnail} alt="" className="w-full h-full object-cover"/>
      {selected && <div className="absolute inset-0 bg-[var(--text)]/20 flex items-center justify-center"><Check size={20} className="text-white drop-shadow"/></div>}
      <div className="absolute top-1 left-1">
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium text-white ${asset.source === 'pexels' ? 'bg-black/60' : 'bg-black/40'}`}>
          {asset.source === 'pexels' ? 'P' : 'Px'}
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

function SentenceRow({ item, index, selected, onToggle, onRefresh }: {
  item: FootageSentenceItem; index: number; selected: VideoAsset[]
  onToggle: (a: VideoAsset) => void; onRefresh: (kw: string) => void
}) {
  const isSelected = (a: VideoAsset) => selected.some(s => s.id === a.id && s.source === a.source)
  const [expanded, setExpanded] = useState(true)
  const [editing, setEditing] = useState(false)
  const [kw, setKw] = useState(item.search_en[0] || '')

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

export function FootageGrid({ data, videoUrl, segmentTimes, onUpdate }: {
  data: FootageSentenceItem[]
  videoUrl?: string
  segmentTimes?: { start: number; end: number }[]
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
          onRefresh={kw => refresh(i, kw)}/>
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
          items={data}
          selected={selected}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </div>
  )
}
