import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw, Pencil, Download, Check, ExternalLink, Play, Upload, Loader2, Package, Lock } from 'lucide-react'
import JSZip from 'jszip'
import { Badge } from '../ui/Badge'
import { searchPexels } from '../../services/pexels'
import { searchPixabay } from '../../services/pixabay'
import { fetchMyCredits, chargeCredit } from '../../services/billing'
import { getToken } from '../../lib/auth'
import type { FootageSentenceItem, VideoAsset } from '../../types'
import { TimelinePreview } from './TimelinePreview'

// 下载视频包扣费规则: 2 积分/视频. 跟用户拍板对齐.
const FOOTAGE_DOWNLOAD_CREDITS_PER_VIDEO = 2

// 浏览器侧截视频首帧做缩略图 (avoid 上传服务器再下回来)
// .mov HEVC 等浏览器无法解码的格式不触发 onseeked → 加 5s timeout 兜底
function captureFirstFrame(videoUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const v = document.createElement('video')
    v.src = videoUrl
    v.crossOrigin = 'anonymous'
    v.muted = true
    v.playsInline = true
    v.preload = 'metadata'
    const timer = setTimeout(() => resolve(''), 5000)   // 5s 兜底
    const finish = (val: string) => { clearTimeout(timer); resolve(val) }
    v.onloadeddata = () => {
      try { v.currentTime = Math.min(0.5, (v.duration || 1) / 2) }
      catch { finish('') }
    }
    v.onseeked = () => {
      const canvas = document.createElement('canvas')
      canvas.width = v.videoWidth || 320
      canvas.height = v.videoHeight || 180
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
        try { finish(canvas.toDataURL('image/jpeg', 0.7)) }
        catch { finish('') }   // CORS 等情况不出 base64, 用空 (前端会显示占位)
      } else finish('')
    }
    v.onerror = () => finish('')
  })
}

function probeDuration(videoUrl: string): Promise<number> {
  return new Promise((resolve) => {
    const v = document.createElement('video')
    v.src = videoUrl
    v.preload = 'metadata'
    const timer = setTimeout(() => resolve(0), 3000)   // 3s 兜底
    const finish = (val: number) => { clearTimeout(timer); resolve(val) }
    v.onloadedmetadata = () => finish(v.duration || 0)
    v.onerror = () => finish(0)
  })
}

function AssetThumb({ asset, selected, onSelect }: { asset: VideoAsset; selected: boolean; onSelect: () => void }) {
  return (
    <div onClick={onSelect}
      className={`relative aspect-video rounded-lg overflow-hidden cursor-pointer border-2 transition-all duration-150 group ${selected ? 'border-[var(--text)]' : 'border-transparent hover:border-[var(--text-3)]'}`}>
      {asset.thumbnail ? (
        <img src={asset.thumbnail} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover"/>
      ) : (
        <div className="w-full h-full bg-[var(--bg-hover)] flex items-center justify-center text-[var(--text-3)]">
          <Play size={20}/>
        </div>
      )}
      {selected && <div className="absolute inset-0 bg-[var(--text)]/20 flex items-center justify-center"><Check size={20} className="text-white drop-shadow"/></div>}
      {/* 角标: 只标"自传" (你自己传过的), Pexels/Pixabay 不标 — 都是免费可商用, 区分没意义 */}
      {asset.source === 'upload' && (
        <div className="absolute top-1 left-1">
          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium text-white bg-black/60">
            自传
          </span>
        </div>
      )}
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

function SentenceRow({ item, index, selected, onToggle, onRefresh, onRotate, onAddAsset }: {
  item: FootageSentenceItem; index: number; selected: VideoAsset[]
  onToggle: (a: VideoAsset) => void; onRefresh: (kw: string) => void
  onRotate: () => void
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
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken() || ''}` },
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
            title="上传你自己的视频, 替换这句的素材"
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
          <button onClick={onRotate} className="p-1.5 rounded-lg text-[var(--text-3)] hover:text-[var(--text-2)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer" title="换一批">
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
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {[...Array(6)].map((_, i) => <div key={i} className="aspect-video rounded-lg bg-[var(--bg-hover)] animate-pulse"/>)}
            </div>
          ) : item.assets && item.assets.length > 0 ? (
            <>
              {selected.length === 0 && (
                <div className="text-[11px] text-[var(--text-3)] pb-1.5">点一下选用这句的素材 · 不选则这句不配画面</div>
              )}
              <div className="grid grid-cols-2 gap-2">
                {/* 一句展示 2 个素材 (一排); 默认不选, 用户点哪个用哪个 (再点取消); "换一批"出下一组; "上传"用自己的 */}
                {item.assets.slice(0, 2).map(a => (
                  <AssetThumb key={`${a.source}-${a.id}`} asset={a} selected={isSelected(a)} onSelect={() => onToggle(a)}/>
                ))}
              </div>
            </>
          ) : (
            <div className="text-xs text-[var(--text-3)] py-2">暂无结果，试试"换一批"或修改关键词, 或上传自己的</div>
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
  // 视频包下载进度: 'idle' | '准备中' | `下载 3/9` | '打包中' | '完成'
  const [zipStatus, setZipStatus] = useState<string>('')
  // 免费用户点下载视频包 → 弹升级 modal
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const nav = useNavigate()

  const refresh = async (index: number, keyword: string) => {
    const updated = data.map((it, i) => i === index ? { ...it, loadingAssets: true } : it)
    onUpdate(updated)
    const [p, px] = await Promise.all([searchPexels(keyword, 6), searchPixabay(keyword, 3)])
    const merged = [...p, ...px]
    onUpdate(data.map((it, i) => i === index ? { ...it, assets: merged, loadingAssets: false } : it))
    // 改完关键词重搜后, 清掉这句的旧选择 (旧素材已不在新结果里) — 不自动选, 让用户自己点
    setSelected(prev => ({ ...prev, [index]: [] }))
  }

  // 换一批: 一排显示 2 个, 这里把已搜到的批次往后转 2 格, 露出下一组 2 个 (即时, 不重搜);
  // 不足 3 个 (转了也没新东西) 才重搜.
  const rotate = (index: number) => {
    const it = data[index]
    const a = it.assets || []
    if (a.length < 3) { refresh(index, it.search_en?.[0] || ''); return }
    const rotated = [...a.slice(2), ...a.slice(0, 2)]
    onUpdate(data.map((x, i) => i === index ? { ...x, assets: rotated } : x))
    // 换一批只换展示, 不动选择 — 不自动选, 让用户自己点想要的
  }

  // 不再自动选第 1 个 — 用户反馈"自动选上不想要的还得点掉很麻烦", 改成默认不选,
  // 由用户自己点想要的素材 (没点的句子合成时不配画面, 只留口播原片).

  // 单选: 一句只留 1 个素材. 展示 3 个里点哪个就换成哪个; 点已选中的那个 = 取消 (这句不用素材).
  const toggle = (sentenceIdx: number, asset: VideoAsset) => {
    setSelected(prev => {
      const cur = prev[sentenceIdx] || []
      const isSame = cur.length === 1 && cur[0].id === asset.id && cur[0].source === asset.source
      return { ...prev, [sentenceIdx]: isSame ? [] : [asset] }
    })
  }

  const exportList = () => {
    const lines = Object.entries(selected)
      .filter(([_, list]) => list.length > 0)
      .map(([i, list]) => {
        const s = data[Number(i)]
        const items = list.map((a, idx) => `  ${idx + 1}. [${a.source}] ${a.source_url}`).join('\n')
        return `句子 ${Number(i)+1}:${s?.text}\n${items}`
      }).join('\n\n---\n\n')
    const blob = new Blob([lines], { type: 'text/plain' })
    const el = document.createElement('a'); el.href = URL.createObjectURL(blob); el.download = 'footage.txt'; el.click()
  }

  /** 下载所有选中视频, 打包成 zip — 一次性给用户真视频, 不用她一个个点 Pexels 链接下载.
   * 免费用户挡: 弹升级 modal. 付费用户: 按数量扣 2 积分/视频, 扣完才真下. */
  const downloadAllVideos = async () => {
    const allAssets = Object.entries(selected).flatMap(([i, list]) =>
      list.map(a => ({ sentenceIdx: Number(i), text: data[Number(i)]?.text || '', asset: a }))
    )
    const downloadable = allAssets.filter(x => x.asset.preview_url || x.asset.oss_key)
    if (downloadable.length === 0) {
      setZipStatus('选中的视频没有直链可下载')
      setTimeout(() => setZipStatus(''), 3000)
      return
    }

    // tier 检查: 免费用户挡, 弹升级 modal (不扣费, 不下载)
    setZipStatus('检查套餐...')
    try {
      const c = await fetchMyCredits()
      if (c.tier === 'free') {
        setZipStatus('')
        setUpgradeOpen(true)
        return
      }
    } catch (e) {
      setZipStatus('套餐检查失败, 请重试')
      setTimeout(() => setZipStatus(''), 3000)
      return
    }

    // 扣费 — 2 积分/视频. 失败 (余额不足 402) 直接停, 不进 zip 流程
    const cost = downloadable.length * FOOTAGE_DOWNLOAD_CREDITS_PER_VIDEO
    setZipStatus(`扣费 ${cost} 积分中...`)
    try {
      await chargeCredit('footage_download', cost, `footage_${Date.now()}`)
    } catch (e: any) {
      const msg = String(e?.message || '')
      setZipStatus(msg.includes('402') || msg.includes('积分') ? '积分不足, 去账户中心充值' : `扣费失败: ${msg}`)
      setTimeout(() => setZipStatus(''), 5000)
      return
    }

    const zip = new JSZip()
    setZipStatus(`准备下载 ${downloadable.length} 个视频...`)
    let okCount = 0
    let failCount = 0
    for (let i = 0; i < downloadable.length; i++) {
      const { sentenceIdx, text, asset } = downloadable[i]
      setZipStatus(`下载中 ${i + 1}/${downloadable.length}...`)
      const url = asset.preview_url || ''
      if (!url) { failCount++; continue }
      try {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const blob = await res.blob()
        // 文件名: 句子序号_文本前6字_source.mp4 (避免重名 + 用户能从名字猜出是哪句)
        const safeText = (text.slice(0, 6) || 'shot').replace(/[\\/:*?"<>|]/g, '_')
        const ext = (url.match(/\.(mp4|mov|webm|mkv)(?:\?|$)/i)?.[1] || 'mp4').toLowerCase()
        const fname = `${String(sentenceIdx + 1).padStart(2, '0')}_${safeText}_${asset.source}_${i}.${ext}`
        zip.file(fname, blob)
        okCount++
      } catch (e) {
        console.warn('下载失败', url, e)
        failCount++
      }
    }
    if (okCount === 0) {
      setZipStatus(`全部 ${failCount} 个视频都下载失败 (可能 Pexels 限流), 稍后重试`)
      setTimeout(() => setZipStatus(''), 5000)
      return
    }
    setZipStatus('打包中...')
    const content = await zip.generateAsync({ type: 'blob' }, (meta) => {
      setZipStatus(`打包中 ${meta.percent.toFixed(0)}%...`)
    })
    const el = document.createElement('a')
    el.href = URL.createObjectURL(content)
    el.download = `footage_${Date.now()}.zip`
    el.click()
    setZipStatus(failCount > 0
      ? `已下载 ${okCount} 个 (${failCount} 个失败)`
      : `已下载 ${okCount} 个视频`)
    setTimeout(() => setZipStatus(''), 5000)
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
          onRotate={() => rotate(i)}
          onAddAsset={a => {
            // 上传的放这句 assets 顶部并直接作为这句唯一选中 (一句一个)
            const newData = data.map((it, j) => j === i ? { ...it, assets: [a, ...(it.assets || [])] } : it)
            onUpdate(newData)
            setSelected(prev => ({ ...prev, [i]: [a] }))
          }}/>
      ))}
      {selTotal > 0 && (
        <div className="flex flex-col gap-2 px-3.5 py-2.5 rounded-xl bg-[var(--bg-hover)] border border-[var(--border)]">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-xs text-[var(--text-2)]">已选 {selTotal} 个素材 · 覆盖 {selSentenceCount} / {data.length} 句</span>
            <div className="flex gap-2 flex-wrap">
              {videoUrl && segmentTimes && (
                <button
                  onClick={() => setPreviewOpen(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--text)] text-[var(--bg)] text-xs cursor-pointer hover:opacity-80 transition-opacity"
                >
                  <Play size={12}/> 预览效果
                </button>
              )}
              <button onClick={downloadAllVideos}
                disabled={!!zipStatus && zipStatus !== '完成'}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--bg-card)] text-xs cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={`Pro 及以上专享 · 扣 ${selTotal * FOOTAGE_DOWNLOAD_CREDITS_PER_VIDEO} 积分把选中的 ${selTotal} 个视频打包下载`}>
                <Package size={12}/> 下载视频包
              </button>
              <button onClick={exportList} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--bg-card)] text-xs cursor-pointer transition-colors"
                title="只导出选中视频的 Pexels/Pixabay 链接 txt, 自己浏览器打开下载">
                <Download size={12}/> 导出 URL 清单
              </button>
            </div>
          </div>
          {zipStatus && (
            <div className="text-[11px] text-[var(--text-3)] flex items-center gap-1.5">
              {zipStatus.includes('下载中') || zipStatus.includes('打包中') ? <Loader2 size={11} className="animate-spin"/> : null}
              {zipStatus}
            </div>
          )}
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

      {/* 免费用户点 下载视频包 → 升级 Pro/Max modal */}
      {upgradeOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setUpgradeOpen(false)}>
          <div onClick={e => e.stopPropagation()} className="relative bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-ios-lg w-full max-w-sm p-6 flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <Lock size={18} className="text-amber-500"/>
              <div className="text-base font-semibold">下载视频包是付费功能</div>
            </div>
            <p className="text-sm text-[var(--text-2)] leading-relaxed">
              批量下载素材需要升级到 <b>Pro</b> 或更高套餐. 升级后扣 <b>2 积分/视频</b>, 不限次.
            </p>
            <div className="text-xs text-[var(--text-3)] bg-[var(--bg-hover)] rounded-lg p-3 leading-relaxed">
              想免费体验? 你可以点 "<b>导出 URL 清单</b>" 按钮拿到 Pexels/Pixabay 链接, 自己浏览器打开下载是免费的.
            </div>
            <div className="flex gap-2">
              <button onClick={() => setUpgradeOpen(false)}
                className="flex-1 py-2 rounded-lg border border-[var(--border)] text-[var(--text-2)] text-sm hover:bg-[var(--bg-hover)] cursor-pointer">
                先不升级
              </button>
              <button onClick={() => { setUpgradeOpen(false); nav('/app/account#membership') }}
                className="flex-1 py-2 rounded-lg bg-[var(--text)] text-[var(--bg)] text-sm hover:opacity-80 cursor-pointer">
                去升级
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
