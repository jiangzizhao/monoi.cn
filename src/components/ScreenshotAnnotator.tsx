// 截屏批注: 在一张截图上画箭头 / 矩形 / 自由笔 / 写字, 导出 PNG. 用 react-konva.
// 录屏里选好窗口后, 点「截屏」抓当前帧 → 进这个编辑器标注 → 下载.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Stage, Layer, Image as KonvaImage, Arrow, Rect, Line, Text as KonvaText } from 'react-konva'
import type Konva from 'konva'
import { X, ArrowUpRight, Square, Pen, Type, Undo2, Trash2, Download } from 'lucide-react'

type Tool = 'arrow' | 'rect' | 'pen' | 'text'
interface Shape {
  tool: Tool
  color: string
  width: number
  points?: number[]          // arrow/pen: [x1,y1,x2,y2,...]
  x?: number; y?: number; w?: number; h?: number   // rect
  text?: string; fontSize?: number                  // text
}

const COLORS = ['#FF3B30', '#FFCC00', '#34C759', '#0A84FF', '#FFFFFF', '#000000']
const TOOLS: { id: Tool; label: string; Icon: typeof Pen }[] = [
  { id: 'arrow', label: '箭头', Icon: ArrowUpRight },
  { id: 'rect', label: '方框', Icon: Square },
  { id: 'pen', label: '画笔', Icon: Pen },
  { id: 'text', label: '文字', Icon: Type },
]

export function ScreenshotAnnotator({ imageDataUrl, onClose }: { imageDataUrl: string; onClose: () => void }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [tool, setTool] = useState<Tool>('arrow')
  const [color, setColor] = useState('#FF3B30')
  const [width, setWidth] = useState(4)
  const [shapes, setShapes] = useState<Shape[]>([])
  const drawingRef = useRef(false)
  const stageRef = useRef<Konva.Stage>(null)
  const [textBox, setTextBox] = useState<{ clientX: number; clientY: number; x: number; y: number } | null>(null)
  const commitText = (val: string) => {
    if (val.trim() && textBox) setShapes(prev => [...prev, { tool: 'text', color, width, x: textBox.x, y: textBox.y, text: val.trim(), fontSize: Math.max(18, width * 6) }])
    setTextBox(null)
  }

  // 加载截图
  useEffect(() => {
    const im = new window.Image()
    im.onload = () => setImg(im)
    im.src = imageDataUrl
  }, [imageDataUrl])

  // 显示尺寸: 等比缩进视口 (画布按显示尺寸, 导出时按比例放回原分辨率)
  const maxW = Math.min(window.innerWidth - 80, 1100)
  const maxH = window.innerHeight - 200
  const natW = img?.naturalWidth || 1280
  const natH = img?.naturalHeight || 720
  const scale = Math.min(maxW / natW, maxH / natH, 1)
  const dispW = Math.round(natW * scale)
  const dispH = Math.round(natH * scale)

  const pointer = () => {
    const st = stageRef.current
    const p = st?.getPointerPosition()
    return p ? { x: p.x, y: p.y } : null
  }

  const onDown = (e?: any) => {
    const p = pointer()
    if (!p) return
    if (tool === 'text') {
      // 就地弹输入框 (electron 禁用 window.prompt)
      const ne = e?.evt
      const cx = ne?.clientX ?? ne?.touches?.[0]?.clientX ?? window.innerWidth / 2
      const cy = ne?.clientY ?? ne?.touches?.[0]?.clientY ?? window.innerHeight / 2
      setTextBox({ clientX: cx, clientY: cy, x: p.x, y: p.y })
      return
    }
    drawingRef.current = true
    if (tool === 'arrow') setShapes(prev => [...prev, { tool: 'arrow', color, width, points: [p.x, p.y, p.x, p.y] }])
    else if (tool === 'rect') setShapes(prev => [...prev, { tool: 'rect', color, width, x: p.x, y: p.y, w: 0, h: 0 }])
    else if (tool === 'pen') setShapes(prev => [...prev, { tool: 'pen', color, width, points: [p.x, p.y] }])
  }

  const onMove = () => {
    if (!drawingRef.current) return
    const p = pointer()
    if (!p) return
    setShapes(prev => {
      if (!prev.length) return prev
      const last = { ...prev[prev.length - 1] }
      if (last.tool === 'arrow') last.points = [last.points![0], last.points![1], p.x, p.y]
      else if (last.tool === 'rect') { last.w = p.x - (last.x || 0); last.h = p.y - (last.y || 0) }
      else if (last.tool === 'pen') last.points = [...(last.points || []), p.x, p.y]
      return [...prev.slice(0, -1), last]
    })
  }

  const onUp = () => { drawingRef.current = false }

  const undo = () => setShapes(prev => prev.slice(0, -1))
  const clear = () => setShapes([])

  const download = () => {
    const st = stageRef.current
    if (!st) return
    const url = st.toDataURL({ pixelRatio: scale > 0 ? 1 / scale : 1 })   // 放回原分辨率
    const a = document.createElement('a')
    a.href = url
    a.download = `截图标注_${Date.now()}.png`
    a.click()
  }

  const toolBtn = (active: boolean) =>
    `flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs cursor-pointer transition-colors ${active
      ? 'border-[var(--text)] bg-[var(--text)] text-[var(--bg)]'
      : 'border-[var(--border)] text-[var(--text-2)] hover:border-[var(--text)]'}`

  const modal = (
    <div className="fixed inset-0 z-[130] flex flex-col items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="flex flex-col gap-3 max-h-[92vh]">
        {/* 工具条 */}
        <div className="flex items-center flex-wrap gap-2 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] px-3 py-2">
          {TOOLS.map(({ id, label, Icon }) => (
            <button key={id} onClick={() => setTool(id)} className={toolBtn(tool === id)}><Icon size={13}/> {label}</button>
          ))}
          <div className="w-px h-5 bg-[var(--border)] mx-1"/>
          {COLORS.map(c => (
            <button key={c} onClick={() => setColor(c)} title="颜色"
              className={`w-6 h-6 rounded-full border-2 cursor-pointer transition-all ${color === c ? 'border-[var(--text)] scale-110' : 'border-[var(--border)]'}`}
              style={{ background: c }}/>
          ))}
          <div className="w-px h-5 bg-[var(--border)] mx-1"/>
          {([['细', 4], ['粗', 8]] as const).map(([l, w]) => (
            <button key={l} onClick={() => setWidth(w)} className={toolBtn(width === w)}>{l}</button>
          ))}
          <div className="w-px h-5 bg-[var(--border)] mx-1"/>
          <button onClick={undo} className={toolBtn(false)}><Undo2 size={13}/> 撤销</button>
          <button onClick={clear} className={toolBtn(false)}><Trash2 size={13}/> 清空</button>
          <button onClick={download} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--text)] text-[var(--bg)] text-xs cursor-pointer hover:opacity-80"><Download size={13}/> 下载</button>
          <button onClick={onClose} className="ml-1 text-[var(--text-3)] hover:text-[var(--text)] cursor-pointer"><X size={16}/></button>
        </div>

        {/* 画布 */}
        <div className="rounded-xl overflow-hidden border border-[var(--border)] bg-black mx-auto" style={{ width: dispW, height: dispH }}>
          <Stage
            ref={stageRef}
            width={dispW}
            height={dispH}
            onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp}
            onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp}
            style={{ cursor: tool === 'text' ? 'text' : 'crosshair' }}
          >
            <Layer listening={false}>
              {img && <KonvaImage image={img} width={dispW} height={dispH}/>}
            </Layer>
            <Layer>
              {shapes.map((s, i) => {
                if (s.tool === 'arrow') return <Arrow key={i} points={s.points!} stroke={s.color} fill={s.color} strokeWidth={s.width} pointerLength={Math.max(8, s.width * 2.2)} pointerWidth={Math.max(8, s.width * 2.2)} lineCap="round"/>
                if (s.tool === 'rect') return <Rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} stroke={s.color} strokeWidth={s.width}/>
                if (s.tool === 'pen') return <Line key={i} points={s.points!} stroke={s.color} strokeWidth={s.width} lineCap="round" lineJoin="round" tension={0.3}/>
                if (s.tool === 'text') return <KonvaText key={i} x={s.x} y={s.y} text={s.text} fill={s.color} fontSize={s.fontSize} fontStyle="bold"/>
                return null
              })}
            </Layer>
          </Stage>
        </div>
        <div className="text-[11px] text-[var(--text-3)] text-center">选工具 → 在图上拖画(文字是点一下输入)· 撤销/清空可改 · 下载保存 PNG</div>
      </div>

      {textBox && (
        <input
          autoFocus defaultValue="" placeholder="输入文字, 回车确认"
          onKeyDown={e => { if (e.key === 'Enter') commitText((e.target as HTMLInputElement).value); else if (e.key === 'Escape') setTextBox(null) }}
          onBlur={e => commitText(e.target.value)}
          onClick={e => e.stopPropagation()}
          style={{ position: 'fixed', left: Math.min(textBox.clientX, window.innerWidth - 180), top: textBox.clientY, zIndex: 140 }}
          className="px-2 py-1 rounded-lg border-2 border-[var(--text)] bg-white text-black text-sm outline-none shadow-lg w-40"
        />
      )}
    </div>
  )

  return createPortal(modal, document.body)
}
