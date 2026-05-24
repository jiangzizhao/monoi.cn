// Konva 白板编辑器 — 白板模式下用, 支持文字 / 图片 / 拖文件 / 缩放旋转 / 撤销重做.
// 内部用 react-konva 渲染 Stage + Layer, 元素是 Text / Image, Transformer 处理选中/缩放/旋转.
//
// 父组件 (RecordTab) 拿 stageRef, 在 canvas composit loop 里调用 stage.toCanvas() 把白板画到主 canvas,
// MediaRecorder 录的就是合成结果.

import { useEffect, useRef, useState } from 'react'
import { Stage, Layer, Rect, Text as KonvaText, Image as KonvaImage, Transformer } from 'react-konva'
import type Konva from 'konva'
import { Type, ImagePlus, Trash2, Undo2, Redo2, Copy } from 'lucide-react'

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
}

const TEXT_COLORS = ['#000000', '#FFFFFF', '#EF4444', '#3B82F6', '#10B981', '#F59E0B']
const FONT_SIZES = [24, 36, 48, 72, 96, 128]
const FONT_FAMILIES = [
  { label: '默认', value: 'Arial, sans-serif' },
  { label: '思源黑', value: '"Source Han Sans CN", "Noto Sans SC", sans-serif' },
  { label: '楷体', value: '"Kaiti SC", "KaiTi", serif' },
  { label: '隶书', value: '"LiSu", "STLiti", serif' },
]

export function WhiteboardEditor({ width, height, onStageReady }: Props) {
  const stageRef = useRef<Konva.Stage>(null)
  const transformerRef = useRef<Konva.Transformer>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // 元素列表 + 选中 + 历史
  const [items, setItems] = useState<WhiteboardItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [history, setHistory] = useState<WhiteboardItem[][]>([[]])
  const [historyIdx, setHistoryIdx] = useState(0)

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

  // 添加文字 — 点 "+ 文字" 立刻弹输入框让用户输入, 不用再双击
  const addText = () => {
    const txt = prompt('输入文字内容:', '')
    if (txt === null || !txt.trim()) return  // 用户取消或空
    const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const fontSize = 72  // 默认大字号, 在 1080x1920 画布上不会显得太小
    // 估算文字宽度居中: 中文约 1 字符宽 = fontSize, 英文约 0.5
    const estW = txt.length * fontSize * 0.8
    const newItem: WhiteboardItem = {
      id, type: 'text',
      x: width / 2 - estW / 2, y: height / 2 - fontSize / 2,
      text: txt, fontSize, fill: '#000000',
      fontFamily: FONT_FAMILIES[0].value,
      rotation: 0,
    }
    const next = [...items, newItem]
    updateItems(next)
    setSelectedId(id)
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
            if (e.target === e.target.getStage() || e.target.attrs.id === 'bg-rect') {
              setSelectedId(null)
            }
          }}>
          <Layer>
            {/* 白色背景 */}
            <Rect id="bg-rect" x={0} y={0} width={width} height={height} fill="white"/>
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
                    onDblClick={() => {
                      const t = prompt('编辑文字:', it.text)
                      if (t !== null) handleTransform(it.id, { text: t })
                    }}
                    onDblTap={() => {
                      const t = prompt('编辑文字:', it.text)
                      if (t !== null) handleTransform(it.id, { text: t })
                    }}
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
      </div>

      <p className="text-[10px] text-[var(--text-3)] text-center">
        点击元素选中 (角上拖动缩放, 顶上圆点旋转). 双击文字编辑. 拖图片文件到白板上传.
      </p>
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
