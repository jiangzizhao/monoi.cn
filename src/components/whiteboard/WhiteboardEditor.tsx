// Konva 白板编辑器 — 白板模式下用, 支持文字 / 图片 / 拖文件 / 缩放旋转 / 撤销重做.
// 内部用 react-konva 渲染 Stage + Layer, 元素是 Text / Image, Transformer 处理选中/缩放/旋转.
//
// 父组件 (RecordTab) 拿 stageRef, 在 canvas composit loop 里调用 stage.toCanvas() 把白板画到主 canvas,
// MediaRecorder 录的就是合成结果.

import { useEffect, useRef, useState } from 'react'
import { Stage, Layer, Rect, Text as KonvaText, Image as KonvaImage, Line as KonvaLine, Group, Transformer } from 'react-konva'
import type Konva from 'konva'
import { Type, ImagePlus, Trash2, Undo2, Redo2, Copy, LayoutTemplate, X, Loader2, Network, Pencil, ChevronDown, Eraser, Plus } from 'lucide-react'

export type WhiteboardItem =
  | {
      id: string
      type: 'text'
      x: number
      y: number
      width: number        // 文本框宽度. 超过这个宽度自动换行 (中文按字, 英文按词)
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
  | {
      id: string
      type: 'mindNode'
      x: number
      y: number
      width: number
      height: number
      text: string
      fontSize: number
      fill: string          // 节点底色
      textFill: string      // 文字色
      fontFamily: string
      rotation: number
      isRoot: boolean       // 根节点 (中心), 区别于分支
      parentId?: string     // 父节点 id, 用于自动连线 (root 为 undefined)
    }
  | {
      id: string
      type: 'freeStroke'
      points: number[]      // [x0,y0, x1,y1, ...] 一笔连续轨迹 (画笔工具)
      stroke: string
      strokeWidth: number
      rotation: number
      x: number             // 用于 Konva 节点定位 (整笔可拖整体平移)
      y: number
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

  // 多页白板: pages 是页面数组, 每页一个 items 列表; 历史栈也按页存
  const [pages, setPages] = useState<WhiteboardItem[][]>([[]])
  const [currentPage, setCurrentPage] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)  // 当前内嵌编辑的 text id
  const [histories, setHistories] = useState<WhiteboardItem[][][]>([[[]]])  // [pageIdx][step][item]
  const [historyIndices, setHistoryIndices] = useState<number[]>([0])

  // 当前页的元素 (派生)
  const items = pages[currentPage] || []
  const history = histories[currentPage] || [[]]
  const historyIdx = historyIndices[currentPage] || 0

  const setItems = (newItems: WhiteboardItem[] | ((prev: WhiteboardItem[]) => WhiteboardItem[])) => {
    setPages(prev => {
      const next = [...prev]
      const cur = prev[currentPage] || []
      next[currentPage] = typeof newItems === 'function' ? (newItems as any)(cur) : newItems
      return next
    })
  }

  // 模式: select (默认选择/拖动) | pen (画笔模式)
  const [mode, setMode] = useState<'select' | 'pen'>('select')
  // 思维导图预设下拉
  const [mindMenuOpen, setMindMenuOpen] = useState(false)
  // 画笔颜色 / 粗细 (复用 defaultTextStyle.fill 也行, 这里独立一份方便后续加粗细调节)
  const [penColor, setPenColor] = useState('#3B82F6')
  const [penWidth] = useState(6)
  // 正在画的临时笔触 (mouseup 时存为 freeStroke item)
  const drawingStrokeRef = useRef<{ points: number[]; id: string } | null>(null)
  const [drawingTick, setDrawingTick] = useState(0)  // 触发重渲染显示正在画的线
  // monoi 服务器字体库 (跟 CoverGeneratorForm 用同一份). 状态指示砍掉 (用户嫌吵), debug 全走 console.
  const [serverFonts, setServerFonts] = useState<{ label: string; value: string }[]>([])

  // 白板背景图 (admin 上传). 默认纯白 (bgImage = null).
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null)
  const [bgPickerOpen, setBgPickerOpen] = useState(false)

  // 默认文字样式 — 工具栏一直显示, 没选中文字时改这个 (应用到下一次新建文字).
  // 选中文字时, 工具栏显示选中文字的样式, 改的是选中那条.
  const [defaultTextStyle, setDefaultTextStyle] = useState({
    fontSize: 72,
    fontFamily: 'Arial, sans-serif',
    fill: '#000000',
  })

  // 自动建文字: 第一次 mount 时在中心放一个空文字 + 进入编辑模式, 用户打开白板就能打字.
  // 用 ref 标记防 StrictMode 双 mount.
  const autoAddedRef = useRef(false)

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

  // serverFonts 拉到了 → 把默认字体也换成 monoi 字体库第一个 (思源黑 Heavy 之类)
  useEffect(() => {
    if (serverFonts.length > 0 && defaultTextStyle.fontFamily === 'Arial, sans-serif') {
      setDefaultTextStyle(s => ({ ...s, fontFamily: serverFonts[0].value }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverFonts])

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

  // 元素变更 → push 历史 (deep clone). 历史按页隔离, 每页独立 50 步上限.
  const pushHistory = (newItems: WhiteboardItem[]) => {
    setHistories(prev => {
      const cur = prev[currentPage] || [[]]
      const idx = historyIndices[currentPage] || 0
      const next = cur.slice(0, idx + 1)
      next.push(JSON.parse(JSON.stringify(newItems)))
      const trimmed = next.slice(-50)
      const copy = [...prev]
      copy[currentPage] = trimmed
      return copy
    })
    setHistoryIndices(prev => {
      const cur = prev[currentPage] || 0
      const next = [...prev]
      next[currentPage] = Math.min(cur + 1, 49)
      return next
    })
  }

  const updateItems = (newItems: WhiteboardItem[], record = true) => {
    setItems(newItems)
    if (record) pushHistory(newItems)
  }

  const undo = () => {
    if (historyIdx <= 0) return
    const idx = historyIdx - 1
    setHistoryIndices(prev => { const n = [...prev]; n[currentPage] = idx; return n })
    setItems(JSON.parse(JSON.stringify(history[idx])))
    setSelectedId(null)
  }
  const redo = () => {
    if (historyIdx >= history.length - 1) return
    const idx = historyIdx + 1
    setHistoryIndices(prev => { const n = [...prev]; n[currentPage] = idx; return n })
    setItems(JSON.parse(JSON.stringify(history[idx])))
    setSelectedId(null)
  }

  // ============== 分页 ==============
  const addPage = () => {
    setPages(prev => [...prev, []])
    setHistories(prev => [...prev, [[]]])
    setHistoryIndices(prev => [...prev, 0])
    setCurrentPage(pages.length)  // 跳到新页
    setSelectedId(null); setEditingId(null)
  }
  const goToPage = (idx: number) => {
    if (idx < 0 || idx >= pages.length) return
    setCurrentPage(idx)
    setSelectedId(null); setEditingId(null)
  }
  const deletePage = (idx: number) => {
    if (pages.length <= 1) { alert('至少保留 1 页'); return }
    if (!confirm(`删除第 ${idx + 1} 页? 该页所有内容会消失.`)) return
    setPages(prev => prev.filter((_, i) => i !== idx))
    setHistories(prev => prev.filter((_, i) => i !== idx))
    setHistoryIndices(prev => prev.filter((_, i) => i !== idx))
    setCurrentPage(Math.max(0, Math.min(currentPage, pages.length - 2)))
    setSelectedId(null); setEditingId(null)
  }

  // 一键清屏 (清当前页)
  const clearPage = () => {
    if (items.length === 0) return
    if (!confirm('清空当前页所有内容? 可用撤销恢复.')) return
    updateItems([])
    setSelectedId(null); setEditingId(null)
  }

  // 添加文字 — 在白板某位置加空文字 + 进入编辑模式 (光标蹦, 直接打字).
  // 用 defaultTextStyle (工具栏一直显示的那套), 选中文字时改的是文字本身, 没选中时改的是这个默认值.
  // 文本框默认宽度: 从点击点到白板右边留 40 边距, 最少 300, 最多 stage 宽 - 100
  const calcTextWidth = (clickX: number) => {
    const remaining = width - clickX - 40
    return Math.max(300, Math.min(remaining, width - 100))
  }

  const addTextAt = (px: number, py: number): string => {
    const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const w = calcTextWidth(px)
    const newItem: WhiteboardItem = {
      id, type: 'text',
      x: px, y: py - defaultTextStyle.fontSize / 2,
      width: w,
      text: '',
      fontSize: defaultTextStyle.fontSize,
      fill: defaultTextStyle.fill,
      fontFamily: defaultTextStyle.fontFamily,
      rotation: 0,
    }
    updateItems([...items, newItem])
    setSelectedId(id)
    setEditingId(id)  // 立刻进入编辑模式, textarea 自动聚焦
    return id
  }
  const addText = () => addTextAt(width * 0.1, height / 2)

  // 第一次 mount: 自动在左侧靠上放一个空文字 + 进编辑模式 → 用户打开白板就能直接打字
  useEffect(() => {
    if (autoAddedRef.current) return
    autoAddedRef.current = true
    const id = `t_${Date.now()}_init`
    const startX = width * 0.1
    setItems([{
      id, type: 'text',
      x: startX, y: height * 0.15,
      width: calcTextWidth(startX),
      text: '',
      fontSize: defaultTextStyle.fontSize,
      fill: defaultTextStyle.fill,
      fontFamily: defaultTextStyle.fontFamily,
      rotation: 0,
    }])
    setSelectedId(id)
    setEditingId(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  // ============== 思维导图 ==============
  // 插入一组节点 (1 个根 + N 个子). preset 控制布局.
  const insertMindMap = (preset: 'radial' | 'horizontal') => {
    const rootId = `m_${Date.now()}_root`
    const cx = width / 2, cy = height / 2
    const nodeW = 240, nodeH = 96
    const branchW = 200, branchH = 80
    const root: WhiteboardItem = {
      id: rootId, type: 'mindNode',
      x: cx - nodeW / 2, y: cy - nodeH / 2,
      width: nodeW, height: nodeH,
      text: '中心主题', fontSize: 36, fill: '#3B82F6', textFill: '#FFFFFF',
      fontFamily: defaultTextStyle.fontFamily,
      rotation: 0, isRoot: true,
    }
    const children: WhiteboardItem[] = []
    const labels = ['分支一', '分支二', '分支三', '分支四', '分支五']
    const branchFills = ['#FEF3C7', '#DBEAFE', '#DCFCE7', '#FCE7F3', '#EDE9FE']
    if (preset === 'radial') {
      // 中心放射: 5 个分支均匀环绕 root
      const radius = Math.min(width, height) * 0.28
      const N = 5
      for (let i = 0; i < N; i++) {
        const angle = -Math.PI / 2 + (i * 2 * Math.PI / N)  // 从顶部开始顺时针
        const bx = cx + radius * Math.cos(angle) - branchW / 2
        const by = cy + radius * Math.sin(angle) - branchH / 2
        children.push({
          id: `m_${Date.now()}_${i}`, type: 'mindNode',
          x: bx, y: by, width: branchW, height: branchH,
          text: labels[i], fontSize: 28, fill: branchFills[i % branchFills.length], textFill: '#1F2937',
          fontFamily: defaultTextStyle.fontFamily,
          rotation: 0, isRoot: false, parentId: rootId,
        })
      }
    } else {
      // 水平树: 左根, 4 个分支右侧上下错落
      root.x = width * 0.15 - nodeW / 2
      const N = 4
      const totalH = (branchH + 40) * N
      const startY = cy - totalH / 2
      for (let i = 0; i < N; i++) {
        children.push({
          id: `m_${Date.now()}_${i}`, type: 'mindNode',
          x: width * 0.65 - branchW / 2,
          y: startY + i * (branchH + 40),
          width: branchW, height: branchH,
          text: labels[i], fontSize: 28, fill: branchFills[i % branchFills.length], textFill: '#1F2937',
          fontFamily: defaultTextStyle.fontFamily,
          rotation: 0, isRoot: false, parentId: rootId,
        })
      }
    }
    updateItems([...items, root, ...children])
    setSelectedId(rootId)
    setMindMenuOpen(false)
  }

  // 给指定节点加一个新子节点 (右侧错落放置). 给 mindNode 上的 + 按钮用.
  const addMindChild = (parentId: string) => {
    const parent = items.find(it => it.id === parentId)
    if (!parent || parent.type !== 'mindNode') return
    const newId = `m_${Date.now()}_c${Math.random().toString(36).slice(2, 5)}`
    const branchW = 200, branchH = 80
    const branchFills = ['#FEF3C7', '#DBEAFE', '#DCFCE7', '#FCE7F3', '#EDE9FE']
    // 已存在同父节点的子数量 → 用来选不同颜色 + 上下错位
    const siblings = items.filter(it => it.type === 'mindNode' && (it as any).parentId === parentId)
    const idx = siblings.length
    const newItem: WhiteboardItem = {
      id: newId, type: 'mindNode',
      x: parent.x + parent.width + 80,
      y: parent.y + parent.height / 2 - branchH / 2 + (idx - 1) * (branchH + 24),
      width: branchW, height: branchH,
      text: '新分支', fontSize: 28,
      fill: branchFills[idx % branchFills.length], textFill: '#1F2937',
      fontFamily: parent.fontFamily,
      rotation: 0, isRoot: false, parentId,
    }
    updateItems([...items, newItem])
    setSelectedId(newId)
    setEditingId(newId)  // 立刻进入编辑模式, 用户可以改名
  }

  // ============== 画笔 ==============
  const startStroke = (px: number, py: number) => {
    const id = `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    drawingStrokeRef.current = { id, points: [px, py] }
    setDrawingTick(t => t + 1)
  }
  const appendStroke = (px: number, py: number) => {
    const s = drawingStrokeRef.current
    if (!s) return
    s.points.push(px, py)
    setDrawingTick(t => t + 1)
  }
  const finishStroke = () => {
    const s = drawingStrokeRef.current
    if (!s) return
    drawingStrokeRef.current = null
    if (s.points.length >= 4) {
      // 至少 2 点才存
      const stroke: WhiteboardItem = {
        id: s.id, type: 'freeStroke',
        points: s.points, stroke: penColor, strokeWidth: penWidth,
        rotation: 0, x: 0, y: 0,
      }
      updateItems([...items, stroke])
    }
    setDrawingTick(t => t + 1)
  }

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
        {/* 思维导图下拉 */}
        <div className="relative">
          <button onClick={() => setMindMenuOpen(o => !o)} title="思维导图"
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs text-[var(--text-2)] hover:bg-[var(--bg-hover)] cursor-pointer">
            <Network size={13}/> 思维导图 <ChevronDown size={10}/>
          </button>
          {mindMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMindMenuOpen(false)}/>
              <div className="absolute left-0 top-full mt-1 z-50 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg shadow-lg min-w-[140px] py-1">
                <button onClick={() => insertMindMap('radial')}
                  className="w-full text-left px-3 py-1.5 text-xs text-[var(--text-2)] hover:bg-[var(--bg-hover)] cursor-pointer flex items-center gap-2">
                  <span className="text-base">⊕</span> 中心放射
                </button>
                <button onClick={() => insertMindMap('horizontal')}
                  className="w-full text-left px-3 py-1.5 text-xs text-[var(--text-2)] hover:bg-[var(--bg-hover)] cursor-pointer flex items-center gap-2">
                  <span className="text-base">⫶</span> 水平树
                </button>
                <div className="border-t border-[var(--border)] my-1"/>
                <div className="px-3 py-1 text-[10px] text-[var(--text-3)]">选中节点后用"复制"加分支, 拖动节点连线自动跟随</div>
              </div>
            </>
          )}
        </div>
        {/* 画笔 */}
        <button onClick={() => { setMode(m => m === 'pen' ? 'select' : 'pen'); setSelectedId(null) }}
          title={mode === 'pen' ? '退出画笔' : '自由画笔'}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs cursor-pointer transition-colors ${
            mode === 'pen'
              ? 'bg-blue-500 text-white hover:bg-blue-600'
              : 'text-[var(--text-2)] hover:bg-[var(--bg-hover)]'
          }`}>
          <Pencil size={13}/> 画笔
        </button>
        {mode === 'pen' && (
          <label
            title="画笔颜色"
            className="relative w-5 h-5 rounded-full border border-[var(--border)] cursor-pointer overflow-hidden shadow-sm hover:scale-110 transition-transform"
            style={{ background: penColor }}>
            <input type="color" value={penColor}
              onChange={e => setPenColor(e.target.value)}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"/>
          </label>
        )}
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
        <button onClick={clearPage} title="清屏 (清空当前页)"
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs text-orange-500 hover:bg-orange-950/20 cursor-pointer">
          <Eraser size={13}/> 清屏
        </button>

        {/* 字体加载状态 — 之前有 N 个 OK / 失败提示, 用户嫌吵, 砍掉.
            真有问题 F12 → Console 看 [whiteboard] log */}

        {/* 文字属性面板 — 一直显示. 选中文字 → 改的是选中文字; 没选中 → 改的是"下一次新建文字"的默认样式. */}
        {(() => {
          const isTextSelected = selectedItem?.type === 'text'
          const curFontSize = isTextSelected ? selectedItem.fontSize : defaultTextStyle.fontSize
          const curFontFamily = isTextSelected ? selectedItem.fontFamily : defaultTextStyle.fontFamily
          const curFill = isTextSelected ? selectedItem.fill : defaultTextStyle.fill
          const setFontSize = (v: number) => {
            if (isTextSelected) handleTransform(selectedItem.id, { fontSize: v })
            else setDefaultTextStyle(s => ({ ...s, fontSize: v }))
          }
          const setFontFamily = (v: string) => {
            if (isTextSelected) handleTransform(selectedItem.id, { fontFamily: v })
            else setDefaultTextStyle(s => ({ ...s, fontFamily: v }))
          }
          const setFill = (v: string) => {
            if (isTextSelected) handleTransform(selectedItem.id, { fill: v })
            else setDefaultTextStyle(s => ({ ...s, fill: v }))
          }
          return (
            <div className="ml-auto flex items-center gap-2 text-[10px] flex-wrap">
              <select value={curFontSize}
                onChange={e => setFontSize(Number(e.target.value))}
                className="bg-[var(--bg-input)] border border-[var(--border)] rounded px-1.5 py-0.5 text-[10px] cursor-pointer">
                {FONT_SIZES.map(s => <option key={s} value={s}>{s}px</option>)}
              </select>
              <select value={curFontFamily}
                onChange={e => setFontFamily(e.target.value)}
                className="bg-[var(--bg-input)] border border-[var(--border)] rounded px-1.5 py-0.5 text-[10px] cursor-pointer">
                {FONT_FAMILIES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
              <label
                title="文字颜色"
                className="relative w-6 h-6 rounded-full border border-[var(--border)] cursor-pointer overflow-hidden shadow-sm hover:scale-110 transition-transform"
                style={{ background: curFill }}>
                <input type="color" value={curFill}
                  onChange={e => setFill(e.target.value)}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"/>
              </label>
            </div>
          )
        })()}
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
            // 画笔模式: 在空白处或元素上, 一律开始一笔
            if (mode === 'pen') {
              const pos = e.target.getStage()?.getPointerPosition()
              if (pos) startStroke(pos.x, pos.y)
              return
            }
            // 编辑中: 别打扰 (textarea 自己处理点击外 = blur)
            if (editingId) return
            // 点击空白处 (stage / 背景矩形 / 背景图): 永远直接出新文字 + 光标.
            // 即使原来有别的元素被选中, 也直接进入新文字编辑 (取消选中 = 副作用).
            // 空文字 blur 时会自动删, 所以"误点"也不会留垃圾.
            if (e.target === e.target.getStage() || e.target.attrs.id === 'bg-rect' || e.target.attrs.id === 'bg-image') {
              const pointerPos = e.target.getStage()?.getPointerPosition()
              if (pointerPos) addTextAt(pointerPos.x, pointerPos.y)
            }
          }}
          onMouseMove={(e) => {
            if (mode !== 'pen' || !drawingStrokeRef.current) return
            const pos = e.target.getStage()?.getPointerPosition()
            if (pos) appendStroke(pos.x, pos.y)
          }}
          onMouseUp={() => { if (mode === 'pen') finishStroke() }}
          onMouseLeave={() => { if (mode === 'pen' && drawingStrokeRef.current) finishStroke() }}>
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

            {/* 思维导图连线 (要画在节点底下, 先渲染). 每个非根 mindNode → 找父节点画 bezier. */}
            {items.map(it => {
              if (it.type !== 'mindNode' || !it.parentId) return null
              const parent = items.find(p => p.id === it.parentId)
              if (!parent || parent.type !== 'mindNode') return null
              // 起点: 父节点最近边的中点 (右 / 左 / 上 / 下 按相对位置自动选)
              const px = parent.x + parent.width / 2
              const py = parent.y + parent.height / 2
              const cx = it.x + it.width / 2
              const cy = it.y + it.height / 2
              // bezier 用水平的中点作控制点 (S 形)
              const midX = (px + cx) / 2
              const points = [px, py, midX, py, midX, cy, cx, cy]
              return (
                <KonvaLine
                  key={`line_${it.id}`}
                  points={points}
                  stroke="#94A3B8"
                  strokeWidth={2.5}
                  bezier
                  lineCap="round"
                  listening={false}
                />
              )
            })}

            {/* 元素 */}
            {items.map(it => {
              if (it.type === 'text') {
                return (
                  <KonvaText
                    key={it.id} id={it.id}
                    x={it.x} y={it.y} text={it.text}
                    width={it.width}            // 限定宽度 → 自动换行
                    wrap="char"                 // 按字断行 (中文友好, 英文也能断)
                    fontSize={it.fontSize} fill={it.fill}
                    fontFamily={it.fontFamily}
                    rotation={it.rotation}
                    draggable={mode === 'select'}
                    onClick={() => mode === 'select' && setSelectedId(it.id)}
                    onTap={() => mode === 'select' && setSelectedId(it.id)}
                    onDblClick={() => mode === 'select' && setEditingId(it.id)}
                    onDblTap={() => mode === 'select' && setEditingId(it.id)}
                    visible={editingId !== it.id}  // 编辑时隐藏 Konva 文字, 让 HTML input 接管显示
                    onDragEnd={(e) => handleTransform(it.id, { x: e.target.x(), y: e.target.y() })}
                    onTransformEnd={(e) => {
                      const node = e.target
                      // Konva 缩放: text 通过 scale 同时改宽度和字号 (按比例放大整个文本框)
                      const scaleX = node.scaleX()
                      const scaleY = node.scaleY()
                      handleTransform(it.id, {
                        x: node.x(), y: node.y(),
                        rotation: node.rotation(),
                        width: Math.max(60, it.width * scaleX),
                        fontSize: Math.max(8, Math.round(it.fontSize * scaleY)),
                      })
                      node.scaleX(1); node.scaleY(1)
                    }}
                  />
                )
              }
              if (it.type === 'mindNode') {
                return (
                  <MindNodeItem key={it.id} item={it as any}
                    selected={selectedId === it.id} editing={editingId === it.id}
                    selectable={mode === 'select'}
                    onSelect={setSelectedId} onEdit={setEditingId}
                    onChange={handleTransform}/>
                )
              }
              if (it.type === 'freeStroke') {
                return (
                  <KonvaLine
                    key={it.id} id={it.id}
                    x={it.x} y={it.y}
                    points={it.points}
                    stroke={it.stroke}
                    strokeWidth={it.strokeWidth}
                    lineCap="round" lineJoin="round"
                    tension={0.5}
                    rotation={it.rotation}
                    draggable={mode === 'select'}
                    listening={mode === 'select'}
                    onClick={() => mode === 'select' && setSelectedId(it.id)}
                    onTap={() => mode === 'select' && setSelectedId(it.id)}
                    onDragEnd={(e) => handleTransform(it.id, { x: e.target.x(), y: e.target.y() })}
                  />
                )
              }
              return <ImageItem key={it.id} item={it as any} onSelect={setSelectedId} onChange={handleTransform}/>
            })}

            {/* 正在画的临时笔触 (mouseup 才存为 item) */}
            {drawingStrokeRef.current && drawingStrokeRef.current.points.length >= 2 && (
              <KonvaLine
                key={`drawing_${drawingTick}`}
                points={drawingStrokeRef.current.points}
                stroke={penColor}
                strokeWidth={penWidth}
                lineCap="round" lineJoin="round"
                tension={0.5}
                listening={false}
              />
            )}

            <Transformer ref={transformerRef}
              rotateEnabled={selectedItem?.type !== 'mindNode'}
              resizeEnabled={selectedItem?.type !== 'mindNode'}
              enabledAnchors={selectedItem?.type === 'mindNode' ? [] : ['top-left','top-center','top-right','middle-left','middle-right','bottom-left','bottom-center','bottom-right']}
              keepRatio={false}
              anchorSize={12}
              anchorCornerRadius={6}
              anchorStroke="#3B82F6"
              anchorFill="#FFFFFF"
              anchorStrokeWidth={2}
              borderStroke="#3B82F6"
              borderStrokeWidth={1.5}
              borderDash={[]}
              rotateAnchorOffset={32}
              boundBoxFunc={(_oldBox, newBox) => {
                if (newBox.width < 20 || newBox.height < 20) return _oldBox
                return newBox
              }}/>
          </Layer>
        </Stage>
        </div>

        {/* 内嵌文字编辑器 — 双击 text / mindNode 激活, 直接在白板上输入.
            textarea 宽度 = item.width * scale, 高度随内容自适应 (输入时算 scrollHeight). */}
        {editingId && (() => {
          const it = items.find(x => x.id === editingId)
          if (!it || (it.type !== 'text' && it.type !== 'mindNode')) return null
          const isMind = it.type === 'mindNode'
          const itemWidth = (it as any).width as number
          const inputX = it.x * scale
          const inputY = it.y * scale
          const inputW = itemWidth * scale
          const lineH = (it.fontSize * scale) * 1.15  // 行高 ~1.15
          const minH = isMind ? (it as any).height * scale : lineH
          return (
            <textarea
              autoFocus
              ref={(el) => {
                // mount 时撑高 textarea 到内容实际高度
                if (el) {
                  el.style.height = 'auto'
                  el.style.height = Math.max(minH, el.scrollHeight) + 'px'
                }
              }}
              defaultValue={it.text}
              onInput={(e) => {
                const el = e.currentTarget
                el.style.height = 'auto'
                el.style.height = Math.max(minH, el.scrollHeight) + 'px'
              }}
              onBlur={(e) => {
                const v = e.target.value
                if (!v.trim() && !isMind) {
                  // 纯文字: 空内容 → 删元素 (防止误点留垃圾空文本)
                  updateItems(items.filter(x => x.id !== editingId))
                  setSelectedId(null)
                } else {
                  handleTransform(editingId, { text: v })
                }
                setEditingId(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setEditingId(null); return }
                // Shift+Enter 换行, 单 Enter 完成编辑
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.target as HTMLTextAreaElement).blur() }
              }}
              style={{
                position: 'absolute',
                left: inputX, top: inputY,
                width: inputW, minHeight: minH,
                fontSize: it.fontSize * scale,
                fontFamily: it.fontFamily,
                color: isMind ? (it as any).textFill : it.fill,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                caretColor: '#3B82F6',
                padding: '0',
                margin: '0',
                lineHeight: isMind ? (minH / (it.fontSize * scale)) : 1.15,
                textAlign: isMind ? 'center' : 'left',
                resize: 'none',
                overflow: 'hidden',
                whiteSpace: 'pre-wrap',      // 自动换行 (按字断, 跟 KonvaText wrap='char' 一致显示)
                wordBreak: 'break-word',
                boxSizing: 'border-box',
              }}
            />
          )
        })()}

        {/* 思维导图 + 按钮 — HTML overlay 叠在每个 mindNode 右侧, 点击加子分支.
            select 模式 + 非编辑态才显示, 避免干扰画笔 / 文字编辑. */}
        {mode === 'select' && !editingId && items.map(it => {
          if (it.type !== 'mindNode') return null
          const cx = (it.x + it.width) * scale + 4
          const cy = (it.y + it.height / 2) * scale - 11
          return (
            <button
              key={`plus_${it.id}`}
              onClick={(e) => { e.stopPropagation(); addMindChild(it.id) }}
              title="加子分支"
              style={{
                position: 'absolute',
                left: cx, top: cy,
                width: 22, height: 22,
                borderRadius: '50%',
                background: '#3B82F6',
                color: 'white',
                border: '2px solid white',
                boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                padding: 0,
                fontSize: 14,
                fontWeight: 700,
                lineHeight: 1,
                zIndex: 10,
              }}>
              +
            </button>
          )
        })}

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

      {/* 分页脚 — 写满了就 + 一页, 翻页切. 录制时显示的是当前页 (用户可以中途翻页) */}
      <div className="flex items-center justify-center gap-1.5 flex-wrap py-1">
        {pages.map((_, i) => (
          <div key={i} className="flex items-center gap-0.5">
            <button
              onClick={() => goToPage(i)}
              className={`min-w-[28px] h-7 px-2 rounded-md text-xs font-medium cursor-pointer transition-colors ${
                i === currentPage
                  ? 'bg-[var(--text)] text-[var(--bg)]'
                  : 'bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--bg-hover)]'
              }`}
              title={`切到第 ${i + 1} 页`}>
              {i + 1}
            </button>
            {i === currentPage && pages.length > 1 && (
              <button onClick={() => deletePage(i)} title="删除本页"
                className="w-5 h-5 rounded text-[10px] text-red-400 hover:bg-red-950/20 cursor-pointer flex items-center justify-center">
                <X size={11}/>
              </button>
            )}
          </div>
        ))}
        <button onClick={addPage} title="新建一页"
          className="flex items-center gap-0.5 h-7 px-2 rounded-md border border-dashed border-[var(--border)] text-xs text-[var(--text-3)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-2)] cursor-pointer">
          <Plus size={12}/> 加页
        </button>
      </div>

      <p className="text-[10px] text-[var(--text-3)] text-center">
        {mode === 'pen'
          ? '画笔模式: 鼠标拖动自由画线. 再点"画笔"退出.'
          : '点空白处即可打字. 思维导图节点右侧 + 加子分支, 双击节点改名. 拖图片到白板上传.'}
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


/** 思维导图节点 — 圆角矩形 + 居中文字, 可拖动 / 双击编辑 / 选中后用工具栏复制即"加分支" */
function MindNodeItem({ item, selected, editing, selectable, onSelect, onEdit, onChange }: {
  item: Extract<WhiteboardItem, { type: 'mindNode' }>
  selected: boolean
  editing: boolean
  selectable: boolean
  onSelect: (id: string) => void
  onEdit: (id: string) => void
  onChange: (id: string, updates: Partial<WhiteboardItem>) => void
}) {
  void selected
  return (
    <Group
      id={item.id}
      x={item.x} y={item.y}
      width={item.width} height={item.height}
      rotation={item.rotation}
      draggable={selectable}
      onClick={() => selectable && onSelect(item.id)}
      onTap={() => selectable && onSelect(item.id)}
      onDblClick={() => selectable && onEdit(item.id)}
      onDblTap={() => selectable && onEdit(item.id)}
      onDragEnd={(e) => onChange(item.id, { x: e.target.x(), y: e.target.y() })}
      onTransformEnd={(e) => {
        const node = e.target
        const scaleX = node.scaleX(), scaleY = node.scaleY()
        onChange(item.id, {
          x: node.x(), y: node.y(),
          width: Math.max(60, item.width * scaleX),
          height: Math.max(40, item.height * scaleY),
          rotation: node.rotation(),
        })
        node.scaleX(1); node.scaleY(1)
      }}>
      <Rect
        x={0} y={0}
        width={item.width} height={item.height}
        fill={item.fill}
        cornerRadius={item.isRoot ? 24 : 16}
        shadowColor="rgba(0,0,0,0.15)"
        shadowBlur={item.isRoot ? 12 : 6}
        shadowOffsetY={item.isRoot ? 4 : 2}
        shadowOpacity={1}
      />
      <KonvaText
        x={8} y={0}
        width={item.width - 16} height={item.height}
        text={item.text || '点击编辑'}
        fontSize={item.fontSize}
        fontFamily={item.fontFamily}
        fill={item.textFill}
        align="center" verticalAlign="middle"
        listening={false}
        visible={!editing}
      />
    </Group>
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
