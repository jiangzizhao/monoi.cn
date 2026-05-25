// Konva 白板编辑器 — 白板模式下用, 支持文字 / 图片 / 拖文件 / 缩放旋转 / 撤销重做.
// 内部用 react-konva 渲染 Stage + Layer, 元素是 Text / Image, Transformer 处理选中/缩放/旋转.
//
// 父组件 (RecordTab) 拿 stageRef, 在 canvas composit loop 里调用 stage.toCanvas() 把白板画到主 canvas,
// MediaRecorder 录的就是合成结果.

import { useEffect, useRef, useState } from 'react'
import { Stage, Layer, Rect, Text as KonvaText, Image as KonvaImage, Transformer } from 'react-konva'
import type Konva from 'konva'
import { Type, ImagePlus, Trash2, Undo2, Redo2, Copy, LayoutTemplate, X, Loader2 } from 'lucide-react'

export type WhiteboardItem =
  | {
      id: string
      type: 'text'
      x: number
      y: number
      text: string
      fontSize: number
      fill: string
      fontFamily: string
      rotation: number
    }
  | {
      id: string
      type: 'image'
      x: number
      y: number
      width: number
      height: number
      src: string  // base64 data URL
      rotation: number
    }

interface Props {
  width: number
  height: number
  /** 父组件拿 stage ref, 在 canvas loop 里画到主 canvas */
  onStageReady?: (stage: Konva.Stage | null) => void
  /** 摄像头流 — 在白板里以 PIP 形式预览 (纯 UI, 录制走另一路) */
  cameraStream?: MediaStream | null
  pipPos?: string  // tl/tc/tr/cl/cc/cr/bl/bc/br
  pipSizePct?: number  // 10-45
  pipShape?: 'circle' | 'rounded' | 'square'
}

const TEXT_COLORS = ['#000000', '#FFFFFF', '#EF4444', '#3B82F6', '#10B981', '#F59E0B']
const FONT_SIZES = [24, 36, 48, 72, 96, 128]
// 默认字体: 系统默认 + 浏览器自带. monoi 服务器字体库在 mount 时拉, append 到这里
const DEFAULT_FONT_FAMILIES = [
  { label: '默认', value: 'Arial, sans-serif' },
  { label: '思源黑', value: '"Source Han Sans CN", "Noto Sans SC", sans-serif' },
  { label: '楷体', value: '"Kaiti SC", "KaiTi", serif' },
  { label: '隶书', value: '"LiSu", "STLiti", serif' },
]

export function WhiteboardEditor({ width, height, onStageReady, cameraStream, pipPos = 'br', pipSizePct = 25, pipShape = 'circle' }: Props) {
  const stageRef = useRef<Konva.Stage>(null)
  const transformerRef = useRef<Konva.Transformer>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  // 元素列表 + 选中 + 历史
  const [items, setItems] = useState<WhiteboardItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)  // 当前内嵌编辑的 text id
  const [history, setHistory] = useState<WhiteboardItem[][]>([[]])
  const [historyIdx, setHistoryIdx] = useState(0)
  // monoi 服务器字体库 (跟 CoverGeneratorForm 用同一份). 状态指示砍掉 (用户嫌吵), debug 全走 console.
  const [serverFonts, setServerFonts] = useState<{ label: string; value: string }[]>([])

  // 白板背景图 (admin 上传). 默认纯白 (bgImage = null).
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null)
  const [bgPickerOpen, setBgPickerOpen] = useState(false)

  // 拉服务器字体 → FontFace API 加载到浏览器 → 注入到字体下拉. 失败自动重试 3 次防网络抖
  useEffect(() => {
    const directBase = (import.meta as any).env?.VITE_DIRECT_API_URL || 'https://monoi.nat100.top'
    const url = directBase + '/api/voice/cover-fonts'

    const tryLoad = async (attempt = 1): Promise<void> => {
      console.log(`[whiteboard] 拉字体库 (第 ${attempt} 次):`, url)
      try {
        const r = await fetch(url)
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const d = await r.json()
        const list: { file: string; label: string }[] = d.fonts || []
        console.log(`[whiteboard] 后端返 ${list.length} 个字体`)
        const loaded: { label: string; value: string }[] = []
        for (const f of list) {
          const family = `monoi-wb-${f.file.replace(/[^\w]/g, '')}`
          const fontUrl = `${directBase}/api/voice/cover-font-file/${encodeURIComponent(f.file)}`
          try {
            const ff = new FontFace(family, `url(${fontUrl})`)
            await ff.load()
            ;(document as any).fonts.add(ff)
            loaded.push({ label: f.label || f.file, value: family })
          } catch (e) {
            console.warn('[whiteboard] font load fail', f.file, e)
          }
        }
        console.log(`[whiteboard] 最终加载 ${loaded.length} 个字体`)
        setServerFonts(loaded)
      } catch (e) {
        console.error(`[whiteboard] 字体库拉取失败 (第 ${attempt} 次):`, e)
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, attempt * 2000))  // 2s, 4s 间隔
          return tryLoad(attempt + 1)
        }
      }
    }
    tryLoad()
  }, [])

  const FONT_FAMILIES = [...DEFAULT_FONT_FAMILIES, ...serverFonts]

  // 摄像头预览 → off-screen video
  useEffect(() => {
    if (cameraStream && videoRef.current) {
      videoRef.current.srcObject = cameraStream
      videoRef.current.play().catch(() => {})
    }
  }, [cameraStream])

  // 显示尺寸 (canvas 内部分辨率 vs 显示尺寸: 用 scale 缩放, 保持高分辨率渲染)
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    onStageReady?.(stageRef.current)
    return () => onStageReady?.(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageRef.current])

  // 显示尺寸跟随容器大小, 内部坐标系仍是 width x height (高分辨率)
  useEffect(() => {
    const updateSize = () => {
      const c = containerRef.current
      if (!c) return
      const cw = c.clientWidth
      // 按比例算高度
      const ratio = height / width
      let dw = cw, dh = cw * ratio
      // 不超过视口高度 60vh
      const maxH = window.innerHeight * 0.6
      if (dh > maxH) { dh = maxH; dw = dh / ratio }
      setDisplaySize({ w: dw, h: dh })
    }
    updateSize()
    window.addEventListener('resize', updateSize)
    return () => window.removeEventListener('resize', updateSize)
  }, [width, height])

  // 元素变更 → push 历史 (deep clone)
  const pushHistory = (newItems: WhiteboardItem[]) => {
    const next = history.slice(0, historyIdx + 1)
    next.push(JSON.parse(JSON.stringify(newItems)))
    setHistory(next.slice(-50))  // 最多 50 步
    setHistoryIdx(Math.min(next.length - 1, 49))
  }

  const updateItems = (newItems: WhiteboardItem[], record = true) => {
    setItems(newItems)
    if (record) pushHistory(newItems)
  }

  const undo = () => {
    if (historyIdx <= 0) return
    const idx = historyIdx - 1
    setHistoryIdx(idx)
    setItems(JSON.parse(JSON.stringify(history[idx])))
    setSelectedId(null)
  }
  const redo = () => {
    if (historyIdx >= history.length - 1) return
    const idx = historyIdx + 1
    setHistoryIdx(idx)
    setItems(JSON.parse(JSON.stringify(history[idx])))
    setSelectedId(null)
  }

  // 添加文字 — 点 "+ 文字" 立刻在白板中心加空文字 + 进入编辑模式 (光标蹦, 直接打字)
  const addText = () => {
    const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const fontSize = 72
    // 默认字体优先用 monoi 服务器字体的第一个 (思源黑等), 没加载到 fallback 系统默认
    const defaultFont = serverFonts.length > 0 ? serverFonts[0].value : FONT_FAMILIES[0].value
    const newItem: WhiteboardItem = {
      id, type: 'text',
      x: width / 2 - 200, y: height / 2 - fontSize / 2,
      text: '', fontSize, fill: '#000000',
      fontFamily: defaultFont,
      rotation: 0,
    }
    const next = [...items, newItem]
    updateItems(next)
    setSelectedId(id)
    setEditingId(id)  // 立刻进入编辑模式, textarea 自动聚焦
  }

  // 添加图片 (file 或 base64 dataURL)
  const addImageFromFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const src = e.target?.result as string
      const img = new Image()
      img.onload = () => {
        const id = `i_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        // 默认宽度 1/3 stage 宽, 按原图比例算高度
        const w = width / 3
        const h = w * (img.height / img.width)
        const newItem: WhiteboardItem = {
          id, type: 'image',
          x: width / 2 - w / 2, y: height / 2 - h / 2,
          width: w, height: h, src,
          rotation: 0,
        }
        const next = [...items, newItem]
        updateItems(next)
        setSelectedId(id)
      }
      img.src = src
    }
    reader.readAsDataURL(file)
  }

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f && f.type.startsWith('image/')) addImageFromFile(f)
    e.target.value = ''  // 同一文件可以重选
  }

  // 拖文件到白板
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const f = Array.from(e.dataTransfer.files).find(f => f.type.startsWith('image/'))
    if (f) addImageFromFile(f)
  }
  const onDragOver = (e: React.DragEvent) => e.preventDefault()

  // 删除选中
  const deleteSelected = () => {
    if (!selectedId) return
    const next = items.filter(it => it.id !== selectedId)
    updateItems(next)
    setSelectedId(null)
  }
  // 复制选中
  const duplicateSelected = () => {
    if (!selectedId) return
    const src = items.find(it => it.id === selectedId)
    if (!src) return
    const copy: WhiteboardItem = JSON.parse(JSON.stringify(src))
    copy.id = `${src.type[0]}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    copy.x += 20; copy.y += 20  // 错开一点
    const next = [...items, copy]
    updateItems(next)
    setSelectedId(copy.id)
  }

  // 元素变换 (拖动 / 缩放 / 旋转 完成后更新数据)
  const handleTransform = (id: string, updates: Partial<WhiteboardItem>) => {
    const next = items.map(it => it.id === id ? { ...it, ...updates } as WhiteboardItem : it)
    updateItems(next)
  }

  // Transformer attach to selected item
  useEffect(() => {
    const stage = stageRef.current
    const transformer = transformerRef.current
    if (!stage || !transformer) return
    if (!selectedId) {
      transformer.nodes([])
      transformer.getLayer()?.batchDraw()
      return
    }
    const node = stage.findOne('#' + selectedId)
    if (node) {
      transformer.nodes([node])
      transformer.getLayer()?.batchDraw()
    }
  }, [selectedId, items])

  const selectedItem = items.find(it => it.id === selectedId)
  const scale = displaySize.w / width

  return (
    <div ref={containerRef} className="w-full flex flex-col gap-2">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1 px-2 py-1.5 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl">
        <button onClick={addText} title="加文字"
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs text-[var(--text-2)] hover:bg-[var(--bg-hover)] cursor-pointer">
          <Type size={13}/> 文字
        </button>
        <label className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs text-[var(--text-2)] hover:bg-[var(--bg-hover)] cursor-pointer">
          <ImagePlus size={13}/> 图片
          <input type="file" accept="image/*" onChange={handleFilePick} className="hidden"/>
        </label>
        <div className="w-px h-4 bg-[var(--border)] mx-1"/>
        <button onClick={undo} disabled={historyIdx <= 0} title="撤销"
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs text-[var(--text-2)] hover:bg-[var(--bg-hover)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
          <Undo2 size={13}/>
        </button>
        <button onClick={redo} disabled={historyIdx >= history.length - 1} title="重做"
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs text-[var(--text-2)] hover:bg-[var(--bg-hover)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
          <Redo2 size={13}/>
        </button>
        <div className="w-px h-4 bg-[var(--border)] mx-1"/>
        <button onClick={duplicateSelected} disabled={!selectedId} title="复制"
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs text-[var(--text-2)] hover:bg-[var(--bg-hover)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
          <Copy size={13}/>
        </button>
        <button onClick={deleteSelected} disabled={!selectedId} title="删除"
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs text-red-400 hover:bg-red-950/20 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
          <Trash2 size={13}/>
        </button>
        <div className="w-px h-4 bg-[var(--border)] mx-1"/>
        <button onClick={() => setBgPickerOpen(true)} title="换背景"
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs text-[var(--text-2)] hover:bg-[var(--bg-hover)] cursor-pointer">
          <LayoutTemplate size={13}/> 背景
        </button>

        {/* 字体加载状态 — 之前有 N 个 OK / 失败提示, 用户嫌吵, 砍掉.
            真有问题 F12 → Console 看 [whiteboard] log */}

        {/* 文字属性面板 (选中文字时显示) */}
        {selectedItem?.type === 'text' && (
          <div className="ml-auto flex items-center gap-2 text-[10px] flex-wrap">
            <select value={selectedItem.fontSize}
              onChange={e => handleTransform(selectedItem.id, { fontSize: Number(e.target.value) })}
              className="bg-[var(--bg-input)] border border-[var(--border)] rounded px-1.5 py-0.5 text-[10px] cursor-pointer">
              {FONT_SIZES.map(s => <option key={s} value={s}>{s}px</option>)}
            </select>
            <select value={selectedItem.fontFamily}
              onChange={e => handleTransform(selectedItem.id, { fontFamily: e.target.value })}
              className="bg-[var(--bg-input)] border border-[var(--border)] rounded px-1.5 py-0.5 text-[10px] cursor-pointer">
              {FONT_FAMILIES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
            <div className="flex items-center gap-1">
              {TEXT_COLORS.map(c => (
                <button key={c} onClick={() => handleTransform(selectedItem.id, { fill: c })}
                  className={`w-4 h-4 rounded-full border-2 cursor-pointer ${selectedItem.fill === c ? 'border-[var(--text)]' : 'border-[var(--border)]'}`}
                  style={{ background: c }}/>
              ))}
            </div>
          </div>
        )}
      </div>

{/* Stage container — Konva 内部用原生 1080x1920 (高分辨率), CSS transform scale 缩放显示.
          这样 stage.toCanvas() 总是返回原始分辨率, 主 canvas 合成时不丢精度.
          外层 wrapper 限制可见区域 = 缩放后大小 (避免 overflow 把页面撑爆) */}
      <div onDrop={onDrop} onDragOver={onDragOver}
        className="rounded-xl border border-[var(--border)] bg-white overflow-hidden mx-auto relative"
        style={{ width: displaySize.w, height: displaySize.h }}>
        <div style={{
          width: width, height: height,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}>
        <Stage ref={stageRef} width={width} height={height}
          onMouseDown={(e) => {
            // 点击空白处: 取消选中 (如果有选中) OR 在该位置直接创建文字 (如果无选中, 类似 PPT 文本工具)
            if (e.target === e.target.getStage() || e.target.attrs.id === 'bg-rect') {
              if (selectedId) {
                setSelectedId(null)
              } else if (!editingId) {
                // 在点击位置加空文字并立刻进编辑 — 实现"光标点哪写哪"
                const pointerPos = e.target.getStage()?.getPointerPosition()
                if (pointerPos) {
                  const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
                  const fontSize = 72
                  const defaultFont = serverFonts.length > 0 ? serverFonts[0].value : FONT_FAMILIES[0].value
                  const newItem: WhiteboardItem = {
                    id, type: 'text',
                    x: pointerPos.x, y: pointerPos.y - fontSize / 2,
                    text: '', fontSize, fill: '#000000',
                    fontFamily: defaultFont,
                    rotation: 0,
                  }
                  updateItems([...items, newItem])
                  setSelectedId(id)
                  setEditingId(id)
                }
              }
            }
          }}>
          <Layer>
            {/* 背景: bgImage 有就铺图 (cover 填满, 不留白边), 没图就纯白 */}
            <Rect id="bg-rect" x={0} y={0} width={width} height={height} fill="white"/>
            {bgImage && (
              <KonvaImage
                id="bg-image"
                x={0} y={0}
                width={width} height={height}
                image={bgImage}
                listening={false}
              />
            )}
            {/* 元素 */}
            {items.map(it => {
              if (it.type === 'text') {
                return (
                  <KonvaText
                    key={it.id} id={it.id}
                    x={it.x} y={it.y} text={it.text}
                    fontSize={it.fontSize} fill={it.fill}
                    fontFamily={it.fontFamily}
                    rotation={it.rotation}
                    draggable
                    onClick={() => setSelectedId(it.id)}
                    onTap={() => setSelectedId(it.id)}
                    onDblClick={() => setEditingId(it.id)}
                    onDblTap={() => setEditingId(it.id)}
                    visible={editingId !== it.id}  // 编辑时隐藏 Konva 文字, 让 HTML input 接管显示
                    onDragEnd={(e) => handleTransform(it.id, { x: e.target.x(), y: e.target.y() })}
                    onTransformEnd={(e) => {
                      const node = e.target
                      // Konva 缩放: text 通过 scale 实现, 我们直接调整 fontSize 保真度更好
                      const scaleX = node.scaleX()
                      handleTransform(it.id, {
                        x: node.x(), y: node.y(),
                        rotation: node.rotation(),
                        fontSize: Math.max(8, Math.round(it.fontSize * scaleX)),
                      })
                      node.scaleX(1); node.scaleY(1)
                    }}
                  />
                )
              }
              return <ImageItem key={it.id} item={it as any} onSelect={setSelectedId} onChange={handleTransform}/>
            })}
            <Transformer ref={transformerRef} rotateEnabled keepRatio={false}
              boundBoxFunc={(_oldBox, newBox) => {
                if (newBox.width < 20 || newBox.height < 20) return _oldBox
                return newBox
              }}/>
          </Layer>
        </Stage>
        </div>

        {/* 内嵌文字编辑器 — 双击文字激活, 直接在白板上输入 (取代 prompt 弹窗) */}
        {editingId && (() => {
          const it = items.find(x => x.id === editingId)
          if (!it || it.type !== 'text') return null
          const inputX = it.x * scale
          const inputY = it.y * scale
          const inputW = Math.max(200, displaySize.w - inputX - 10) * 0.6
          const inputH = (it.fontSize * scale) * 1.4
          return (
            <textarea
              autoFocus
              defaultValue={it.text}
              onBlur={(e) => {
                const v = e.target.value
                if (!v.trim()) {
                  // 空文字 → 删掉这个 item (用户加了又没填, 或全删空了)
                  updateItems(items.filter(x => x.id !== editingId))
                  setSelectedId(null)
                } else {
                  handleTransform(editingId, { text: v })
                }
                setEditingId(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setEditingId(null); return }
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.target as HTMLTextAreaElement).blur() }
              }}
              style={{
                position: 'absolute',
                left: inputX, top: inputY,
                width: inputW, minHeight: inputH,
                fontSize: it.fontSize * scale,
                fontFamily: it.fontFamily,
                color: it.fill,
                background: 'transparent',  // 无背景, 像直接在白板上打字
                border: 'none',              // 无边框
                outline: 'none',
                caretColor: '#3B82F6',       // 蓝色光标更显眼, 提示用户在编辑
                padding: '0',
                margin: '0',
                lineHeight: 1,
                resize: 'none',
                overflow: 'hidden',
                whiteSpace: 'pre',
              }}
            />
          )
        })()}

        {/* 摄像头 PIP 预览 — HTML video 叠在 Konva 上, 让用户看到人物会出现在哪 (纯 UI, 录制走主 canvas 那条路) */}
        {cameraStream && (() => {
          const pipDh = displaySize.h * pipSizePct / 100
          const aspect = videoRef.current?.videoWidth && videoRef.current.videoHeight
            ? videoRef.current.videoWidth / videoRef.current.videoHeight : 16/9
          const pipW = pipShape === 'circle' ? pipDh : pipDh * aspect
          const pipH = pipDh
          const pad = displaySize.w * 0.02
          let left = pad, top = pad
          if (pipPos[1] === 'c') left = (displaySize.w - pipW) / 2
          else if (pipPos[1] === 'r') left = displaySize.w - pipW - pad
          if (pipPos[0] === 'c') top = (displaySize.h - pipH) / 2
          else if (pipPos[0] === 'b') top = displaySize.h - pipH - pad
          const radius = pipShape === 'circle' ? '50%' : pipShape === 'rounded' ? '8%' : '0'
          return (
            <video ref={videoRef} muted playsInline autoPlay
              style={{
                position: 'absolute', left, top, width: pipW, height: pipH,
                borderRadius: radius, objectFit: 'cover',
                border: '2px solid rgba(255,255,255,0.9)',
                pointerEvents: 'none',
              }}/>
          )
        })()}
      </div>

      <p className="text-[10px] text-[var(--text-3)] text-center">
        点击元素选中 (角上拖动缩放, 顶上圆点旋转). 双击文字编辑. 拖图片文件到白板上传.
      </p>

      {bgPickerOpen && (
        <BackgroundPicker
          onClose={() => setBgPickerOpen(false)}
          onPick={(img) => { setBgImage(img); setBgPickerOpen(false) }}
          onClear={() => { setBgImage(null); setBgPickerOpen(false) }}
        />
      )}
    </div>
  )
}


// ============== 白板背景选择器 (拉 /api/whiteboard-backgrounds) ==============

interface ServerBackground {
  id: number
  name: string
  url: string
  category: string
}

function BackgroundPicker({ onClose, onPick, onClear }: {
  onClose: () => void
  onPick: (img: HTMLImageElement) => void
  onClear: () => void
}) {
  const [list, setList] = useState<ServerBackground[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [loadingId, setLoadingId] = useState<number | null>(null)

  useEffect(() => {
    const directBase = (import.meta as any).env?.VITE_DIRECT_API_URL || 'https://monoi.nat100.top'
    fetch(directBase + '/api/whiteboard-backgrounds')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(d => setList(d.backgrounds || []))
      .catch(e => setErr(e.message || '加载失败'))
      .finally(() => setLoading(false))
  }, [])

  const handlePick = (bg: ServerBackground) => {
    setLoadingId(bg.id)
    const img = new Image()
    img.crossOrigin = 'anonymous'  // OSS 跨域 — toCanvas 需要无污染
    img.onload = () => { onPick(img); setLoadingId(null) }
    img.onerror = () => { setErr(`背景"${bg.name}"加载失败`); setLoadingId(null) }
    img.src = bg.url
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] w-full max-w-3xl max-h-[80vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)]">
          <div className="text-base font-semibold">选择白板背景</div>
          <button onClick={onClose} className="text-[var(--text-3)] hover:text-[var(--text)] cursor-pointer"><X size={18}/></button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {loading && (
            <div className="text-sm text-[var(--text-3)] py-8 flex items-center justify-center gap-2">
              <Loader2 size={14} className="animate-spin"/> 加载中...
            </div>
          )}
          {err && <div className="text-xs text-red-400 bg-red-950/20 border border-red-900/30 rounded-lg px-3 py-2 mb-3">{err}</div>}
          {!loading && (
            <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
              {/* 纯白选项 */}
              <button onClick={onClear}
                className="aspect-[9/16] rounded-lg border border-[var(--border)] bg-white relative overflow-hidden hover:border-[var(--text)] cursor-pointer flex items-center justify-center">
                <span className="text-xs text-[var(--text-2)]">纯白</span>
              </button>
              {list.map(bg => (
                <button key={bg.id} onClick={() => handlePick(bg)} disabled={loadingId === bg.id}
                  className="aspect-[9/16] rounded-lg border border-[var(--border)] bg-white relative overflow-hidden hover:border-[var(--text)] cursor-pointer">
                  <img src={bg.url} alt={bg.name} className="absolute inset-0 w-full h-full object-cover" crossOrigin="anonymous"/>
                  {loadingId === bg.id && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                      <Loader2 size={16} className="animate-spin text-white"/>
                    </div>
                  )}
                  {(bg.name || bg.category) && (
                    <div className="absolute bottom-0 left-0 right-0 px-1.5 py-0.5 bg-black/50 text-white text-[10px] truncate">
                      {bg.name || bg.category}
                    </div>
                  )}
                </button>
              ))}
              {list.length === 0 && (
                <div className="col-span-full text-center text-xs text-[var(--text-3)] py-6">
                  还没有背景图. (管理员可在后台上传)
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** Konva.Image 需要 image 元素 ready 才能渲染, 包成子组件用 useState 加载 */
function ImageItem({ item, onSelect, onChange }: {
  item: Extract<WhiteboardItem, { type: 'image' }>
  onSelect: (id: string) => void
  onChange: (id: string, updates: Partial<WhiteboardItem>) => void
}) {
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  useEffect(() => {
    const img = new Image()
    img.onload = () => setImage(img)
    img.src = item.src
  }, [item.src])
  if (!image) return null
  return (
    <KonvaImage
      id={item.id}
      x={item.x} y={item.y}
      width={item.width} height={item.height}
      image={image}
      rotation={item.rotation}
      draggable
      onClick={() => onSelect(item.id)}
      onTap={() => onSelect(item.id)}
      onDragEnd={(e) => onChange(item.id, { x: e.target.x(), y: e.target.y() })}
      onTransformEnd={(e) => {
        const node = e.target
        onChange(item.id, {
          x: node.x(), y: node.y(),
          width: Math.max(20, node.width() * node.scaleX()),
          height: Math.max(20, node.height() * node.scaleY()),
          rotation: node.rotation(),
        })
        node.scaleX(1); node.scaleY(1)
      }}
    />
  )
}
