import { useEffect, useRef, useState } from 'react'
import { Loader2, Sparkles, CheckCircle2, Download, ArrowLeft, ImageIcon } from 'lucide-react'
import {
  listCoverTemplates, renderCoverFromTemplate,
  type CoverTemplate, type TextFieldOverride, type UserCoverTextField, type PersonSlotOverride,
} from '../../../services/cover'
import { useChatStore, makeAssistantMsg } from '../../../store/chatStore'
import { underlineStyle } from '../../../lib/coverUnderline'
import { arcLayout, segmentsToArcChars } from '../../../lib/coverArc'
import { lineStyle } from '../../../lib/coverLine'
import { loadFont, fontFamily, parseSegments } from '../../../utils/coverFonts'
import { PersonLibrary } from './PersonLibrary'

const directBase = (import.meta as any).env?.VITE_DIRECT_API_URL || 'https://monoi.nat100.top'

interface FontOpt { file: string; label: string; tag?: string }

const CAT_LABEL: Record<string, string> = {
  kepu: '科普', zhenjing: '震惊', gushi: '故事', jiaocheng: '教程',
  jianji: '极简', zhichang: '职场', xuexi: '学习', licai: '理财', other: '其他',
}

export function TemplateCoverPicker({ onClose }: { onClose?: () => void } = {}) {
  const chatStore = useChatStore()
  const [templates, setTemplates] = useState<CoverTemplate[] | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [selected, setSelected] = useState<CoverTemplate | null>(null)

  // 选中模板后: 用户填的每个字段 + 微调样式 + 人物图 + 生成结果
  const [userTexts, setUserTexts] = useState<Record<string, string>>({})
  const [textOverrides, setTextOverrides] = useState<Record<string, TextFieldOverride>>({})
  // 用户自己加的额外字段 (admin 没设的). label 用 'extra_${id}' 避免跟 admin 字段冲突
  const [extraFields, setExtraFields] = useState<UserCoverTextField[]>([])
  // 用户隐藏的 admin 字段 label
  const [hiddenLabels, setHiddenLabels] = useState<Set<string>>(new Set())
  // 用户调整后的人物坑 (空对象 = 没改, 走 admin 默认)
  const [personSlotOverride, setPersonSlotOverride] = useState<PersonSlotOverride>({})
  const [fontsList, setFontsList] = useState<FontOpt[]>([])
  // personFile / personLocalUrl / personFileRef / handlePersonFile 已经移到 PersonLibrary 组件里, 这里不再维护
  const [personOssKey, setPersonOssKey] = useState('')          // 抠完后的 OSS key
  const [personPreviewUrl, setPersonPreviewUrl] = useState('')  // 抠完后服务器返的签名 URL
  const [personProcessing, setPersonProcessing] = useState(false)
  const [personErr, setPersonErr] = useState('')

  const [generating, setGenerating] = useState(false)
  const [genErr, setGenErr] = useState('')
  const [result, setResult] = useState<{ download_url: string; width: number; height: number } | null>(null)

  useEffect(() => {
    listCoverTemplates()
      .then(r => setTemplates(r.templates || []))
      .catch(e => {
        const raw = String(e?.message || e || '加载失败')
        const friendly = raw.includes('Failed to fetch') || raw.includes('NetworkError')
          ? '网络连接失败 — 服务器可能不在线, 等 10 秒重试; 还不行请联系客服'
          : raw
        setLoadErr(friendly)
      })
    // 同时拉字体库 (admin 跟内置合并)
    fetch(directBase + '/api/voice/cover-fonts')
      .then(r => r.json())
      .then(d => setFontsList(d.fonts || []))
      .catch(() => setFontsList([]))
  }, [])

  // 选模板时, 用 placeholder 初始化每个字段输入 + 清空 overrides + 预加载字体
  useEffect(() => {
    if (!selected) return
    const init: Record<string, string> = {}
    for (const f of selected.text_fields) init[f.label] = f.placeholder || ''
    setUserTexts(init)
    setTextOverrides({})          // 清空, 默认走 admin 设的
    setExtraFields([])
    setHiddenLabels(new Set())
    setPersonSlotOverride({})
    setPersonOssKey(''); setPersonPreviewUrl(''); setPersonErr('')
    setResult(null); setGenErr('')
    // 预加载模板里所有字段的字体, 让左侧预览能用真字体显示
    for (const f of selected.text_fields) {
      if (f.font_file) loadFont(f.font_file)
    }
  }, [selected?.id])

  // 用户切换字体下拉时也实时加载 (admin 字段 override 改字体 + extra 字段加字体, 都监听)
  useEffect(() => {
    for (const ovr of Object.values(textOverrides)) {
      if (ovr.font_file) loadFont(ovr.font_file)
    }
    for (const f of extraFields) {
      if (f.font_file) loadFont(f.font_file)
    }
  }, [textOverrides, extraFields])

  const updateOverride = (label: string, patch: Partial<TextFieldOverride>) => {
    setTextOverrides(prev => ({
      ...prev,
      [label]: { ...(prev[label] || {}), ...patch },
    }))
  }

  const handleGenerate = async () => {
    if (!selected) return
    setGenerating(true); setGenErr(''); setResult(null)
    try {
      // 只传非空 override (减少 payload, 后端跳过 None)
      const cleanOverrides: Record<string, TextFieldOverride> = {}
      for (const [label, ovr] of Object.entries(textOverrides)) {
        const trimmed: TextFieldOverride = {}
        if (ovr.font_file) trimmed.font_file = ovr.font_file
        if (ovr.font_scale !== undefined && ovr.font_scale !== 1.0) trimmed.font_scale = ovr.font_scale
        if (ovr.color) trimmed.color = ovr.color
        if (ovr.highlight_color) trimmed.highlight_color = ovr.highlight_color
        if (ovr.stroke_color) trimmed.stroke_color = ovr.stroke_color
        if (ovr.stroke_width !== undefined) trimmed.stroke_width = ovr.stroke_width
        if (ovr.layer) trimmed.layer = ovr.layer        // 用户改的图层 (人物前/后)
        if (ovr.x !== undefined) trimmed.x = ovr.x      // 用户拖拽位置
        if (ovr.y !== undefined) trimmed.y = ovr.y
        if (ovr.w !== undefined) trimmed.w = ovr.w
        if (ovr.h !== undefined) trimmed.h = ovr.h
        if (Object.keys(trimmed).length > 0) cleanOverrides[label] = trimmed
      }
      const r = await renderCoverFromTemplate({
        template_id: selected.id,
        user_texts: userTexts,
        text_overrides: Object.keys(cleanOverrides).length > 0 ? cleanOverrides : undefined,
        extra_fields: extraFields.length > 0 ? extraFields : undefined,
        hidden_labels: hiddenLabels.size > 0 ? Array.from(hiddenLabels) : undefined,
        person_oss_key: personOssKey || undefined,
        person_slot_override: Object.keys(personSlotOverride).length > 0 ? personSlotOverride : undefined,
      })
      // 生成成功 → 直接发到对话 + 关弹窗 (之前停在弹窗底部的预览, 用户看不到也不知道成没成功)
      const convId = chatStore.activeId
      if (convId) {
        chatStore.addMessage(convId, makeAssistantMsg([
          { type: 'text', content: `✓ 已用模板 "${selected.name}" 生成封面` },
          { type: 'cover_result', data: { covers: [{ ratio: selected.ratio, url: r.download_url }] } },
          {
            type: 'choices',
            question: '下一步',
            options: [
              { id: '__form_publish__', label: '去发布', description: '上传到小红书 / 抖音' },
              { id: '帮我生成各平台的发布文案', label: '生成发布文案', description: 'AI 给每平台写标题/描述/标签' },
              { id: '保留封面, 暂不做下一步', label: '保留封面', description: '稍后再决定' },
            ],
          } as any,
        ]))
        onClose?.()
      } else {
        // 没活跃对话(极少) → 退回弹窗里展示预览, 让用户手动发
        setResult({ download_url: r.download_url, width: r.width, height: r.height })
      }
    } catch (e: any) {
      setGenErr(e.message || '生成失败')
    } finally {
      setGenerating(false)
    }
  }

  const sendToChat = () => {
    if (!result || !selected) return
    const convId = chatStore.activeId
    if (!convId) { alert('没活跃对话, 先建一个对话'); return }
    const msg = makeAssistantMsg([
      { type: 'text', content: `✓ 已用模板 "${selected.name}" 生成封面` },
      { type: 'cover_result', data: { covers: [{ ratio: selected.ratio, url: result.download_url }] } },
      // 加 "下一步" choices, 让用户能继续去发布 / 保留 (跟老 CoverGeneratorForm 一致)
      {
        type: 'choices',
        question: '下一步',
        options: [
          { id: '__form_publish__', label: '去发布', description: '上传到小红书 / 抖音' },
          { id: '帮我生成各平台的发布文案', label: '生成发布文案', description: 'AI 给每平台写标题/描述/标签' },
          { id: '保留封面, 暂不做下一步', label: '保留封面', description: '稍后再决定' },
        ],
      } as any,
    ])
    chatStore.addMessage(convId, msg)
    // 发到对话后关掉模板编辑器, 跟老 CoverGeneratorForm 行为一致
    onClose?.()
  }

  // ============ 模板列表 ============
  if (!selected) {
    if (loadErr) return <div className="text-xs text-red-400 bg-red-950/20 border border-red-900/30 rounded-lg px-3 py-2">{loadErr}</div>
    if (!templates) return <div className="flex items-center justify-center py-12 text-sm text-[var(--text-3)]"><Loader2 size={16} className="animate-spin mr-2"/> 加载模板...</div>
    if (templates.length === 0) return <div className="text-center py-12 text-sm text-[var(--text-3)]">还没有可用模板, 联系管理员上传</div>

    // 按类目分组
    const grouped = templates.reduce<Record<string, CoverTemplate[]>>((acc, t) => {
      const k = t.category || 'other'
      ;(acc[k] = acc[k] || []).push(t)
      return acc
    }, {})

    return (
      <div className="flex flex-col gap-4">
        <div className="text-xs text-[var(--text-3)]">选一个模板 → 填字 → 生成封面. 模板里的字体/颜色/位置都已经调好.</div>
        {Object.entries(grouped).map(([cat, ts]) => (
          <div key={cat}>
            <div className="text-[11px] text-[var(--text-3)] px-1 mb-2">{CAT_LABEL[cat] || cat} · {ts.length} 个</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {(() => {
                // 横屏 (16:9) 模板 2 个堆叠 = 1 个竖屏 (9:16) 高度. 不再让横屏卡片底部空白.
                // 渲染顺序: 先 竖屏 + 方形 (各占 1 cell), 再把横屏 2 个一组塞进 1 cell.
                const renderCard = (t: CoverTemplate) => {
                  const cardTexts: Record<string, string> = {}
                  for (const f of t.text_fields) cardTexts[f.label] = f.placeholder || f.label
                  return (
                    <button
                      key={t.id}
                      onClick={() => setSelected(t)}
                      className="relative group rounded-lg border border-[var(--border)] overflow-hidden hover:border-[var(--text-3)] cursor-pointer transition-colors text-left block w-full"
                    >
                      <TemplatePreview
                        template={t}
                        userTexts={cardTexts}
                        textOverrides={{}}
                        personPreviewUrl={t.sample_person_url || ''}
                      />
                      <div className="px-2 py-1.5 bg-[var(--bg-card)] text-xs text-[var(--text)] truncate">{t.name}</div>
                    </button>
                  )
                }
                const verticalAndSquare = ts.filter(t => t.ratio !== '16:9')
                const horizontals = ts.filter(t => t.ratio === '16:9')
                const cells: React.ReactNode[] = []
                verticalAndSquare.forEach(t => cells.push(<div key={`v_${t.id}`}>{renderCard(t)}</div>))
                // 横屏 2 个一组堆叠成 1 cell, 跟竖屏 1 cell 一样高
                for (let i = 0; i < horizontals.length; i += 2) {
                  const pair = horizontals.slice(i, i + 2)
                  cells.push(
                    <div key={`hpair_${i}`} className="flex flex-col gap-3">
                      {pair.map(renderCard)}
                    </div>
                  )
                }
                return cells
              })()}
            </div>
          </div>
        ))}
      </div>
    )
  }

  // ============ 选了模板, 填字 + 上传人物 + 生成 ============
  const personSlot = selected.person_slot
  const personReady = !personSlot || !!personOssKey   // 没人物坑直接 OK; 有人物坑必须抠完
  const canGenerate = personReady && !generating && !personProcessing && Object.values(userTexts).some(v => v.trim())

  return (
    <div className="flex flex-col gap-4">
      <button onClick={() => { setSelected(null); setResult(null) }}
        className="flex items-center gap-1 text-xs text-[var(--text-3)] hover:text-[var(--text)] cursor-pointer self-start">
        <ArrowLeft size={12}/> 换个模板
      </button>

      <div className="flex flex-col sm:flex-row gap-4">
        {/* 左: 模板预览 + 已抠人物覆盖 + 实时文字预览 — 容器加大让字号显大 */}
        <div className="sm:w-80 flex-shrink-0">
          <TemplatePreview
            template={selected}
            userTexts={userTexts}
            textOverrides={textOverrides}
            extraFields={extraFields}
            hiddenLabels={hiddenLabels}
            // 用户没传自己的人物时, fallback 到模板自带的示例人物图 (admin 上传的)
            personPreviewUrl={personPreviewUrl || selected.sample_person_url || ''}
            personSlotOverride={personSlotOverride}
            onMoveField={(label, dx, dy) => {
              if (label === '__person__') {
                setPersonSlotOverride(prev => ({
                  ...prev,
                  x: (prev.x ?? selected.person_slot?.x ?? 0) + dx,
                  y: (prev.y ?? selected.person_slot?.y ?? 0) + dy,
                }))
                return
              }
              const adminField = selected.text_fields.find(ff => ff.label === label)
              if (adminField) {
                setTextOverrides(prev => {
                  const cur = prev[label] || {}
                  const curX = cur.x ?? adminField.x
                  const curY = cur.y ?? adminField.y
                  return { ...prev, [label]: { ...cur, x: curX + dx, y: curY + dy } }
                })
              } else {
                setExtraFields(prev => prev.map(f =>
                  f.label === label ? { ...f, x: f.x + dx, y: f.y + dy } : f
                ))
              }
            }}
            onResizeField={(label, dx, dy, corner) => {
              const apply = (cur: { x: number; y: number; w: number; h: number }) => {
                let { x, y, w, h } = cur
                if (corner === 'nw') { x += dx; y += dy; w -= dx; h -= dy }
                else if (corner === 'ne') { y += dy; w += dx; h -= dy }
                else if (corner === 'sw') { x += dx; w -= dx; h += dy }
                else { w += dx; h += dy }
                w = Math.max(20, w); h = Math.max(20, h)
                return { x, y, w, h }
              }
              if (label === '__person__') {
                setPersonSlotOverride(prev => {
                  const slot = selected.person_slot
                  if (!slot) return prev
                  const baseline = {
                    x: prev.x ?? slot.x, y: prev.y ?? slot.y,
                    w: prev.w ?? slot.w, h: prev.h ?? slot.h,
                  }
                  return { ...prev, ...apply(baseline) }
                })
                return
              }
              const adminField = selected.text_fields.find(ff => ff.label === label)
              if (adminField) {
                setTextOverrides(prev => {
                  const cur = prev[label] || {}
                  const baseline = {
                    x: cur.x ?? adminField.x, y: cur.y ?? adminField.y,
                    w: cur.w ?? adminField.w, h: cur.h ?? adminField.h,
                  }
                  const after = apply(baseline)
                  // 字号跟 box 高度同比例缩放 (Canva 一致): font_scale 累加, 基准是 admin.h
                  const oldH = baseline.h
                  const newH = after.h
                  const prevScale = cur.font_scale ?? 1
                  const newScale = Math.max(0.2, Math.min(5, prevScale * (newH / Math.max(1, oldH))))
                  return { ...prev, [label]: { ...cur, ...after, font_scale: newScale } }
                })
              } else {
                setExtraFields(prev => prev.map(f => {
                  if (f.label !== label) return f
                  const after = apply({ x: f.x, y: f.y, w: f.w, h: f.h })
                  // extra 字段直接改 font_size (没 font_scale)
                  const hRatio = after.h / Math.max(1, f.h)
                  const newFontSize = Math.max(12, Math.round(f.font_size * hRatio))
                  return { ...f, ...after, font_size: newFontSize }
                }))
              }
            }}
            onRotateField={(label, deltaRotation) => {
              if (label === '__person__') {
                setPersonSlotOverride(prev => ({
                  ...prev,
                  rotation: Math.round(((prev.rotation ?? selected.person_slot?.rotation ?? 0) + deltaRotation)),
                }))
                return
              }
              // 累加增量, 必须用 functional update 拿最新 state — 多次 mousemove
              // 触发时 closure 里的 textOverrides 是旧的, 直接 updateOverride 会丢累加
              const adminField = selected.text_fields.find(ff => ff.label === label)
              if (adminField) {
                setTextOverrides(prev => {
                  const cur = prev[label] || {}
                  const curRot = cur.rotation ?? adminField.rotation ?? 0
                  return { ...prev, [label]: { ...cur, rotation: Math.round(curRot + deltaRotation) } }
                })
              } else {
                setExtraFields(prev => prev.map(f =>
                  f.label === label ? { ...f, rotation: Math.round((f.rotation || 0) + deltaRotation) } : f
                ))
              }
            }}
          />
          <div className="text-xs text-[var(--text-2)] mt-2 text-center">{selected.name}</div>
          <div className="text-[10px] text-[var(--text-3)] text-center">{selected.ratio} · 拖动文字调位置, 实时预览</div>
        </div>

        {/* 右: 填字 + 人物 */}
        <div className="flex-1 min-w-0 flex flex-col gap-3">
          {/* admin 设的字段 (没隐藏的) */}
          {selected.text_fields.filter(f => !hiddenLabels.has(f.label)).map((f, i) => {
            const ovr = textOverrides[f.label] || {}
            const curFont = ovr.font_file || f.font_file
            const curScale = ovr.font_scale ?? 1.0
            const curColor = ovr.color || f.color
            const curHighlight = ovr.highlight_color || f.highlight_color || ''
            const curStroke = ovr.stroke_color || f.stroke_color || ''
            const curLayer = ovr.layer ?? f.layer ?? 'front'
            return (
              <div key={i} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-[var(--text-2)] font-medium">
                    {f.label}
                  </label>
                  <button
                    onClick={() => setHiddenLabels(prev => { const n = new Set(prev); n.add(f.label); return n })}
                    className="text-[10px] text-[var(--text-3)] hover:text-red-400 cursor-pointer"
                    title="隐藏这个字段, 不在封面上显示"
                  >
                    × 隐藏
                  </button>
                </div>
                <input
                  value={userTexts[f.label] || ''}
                  onChange={e => setUserTexts(prev => ({ ...prev, [f.label]: e.target.value }))}
                  placeholder={f.placeholder || `输入${f.label}`}
                  className="bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none focus:border-[var(--text-3)]"
                />
                {/* 紧凑微调控件 — 默认按 admin 设的, 用户能改 */}
                <div className="flex items-center gap-2 flex-wrap text-[11px] text-[var(--text-3)] pl-1">
                  <select
                    value={curFont}
                    onChange={e => updateOverride(f.label, { font_file: e.target.value })}
                    className="bg-[var(--bg)] border border-[var(--border)] rounded px-1.5 py-0.5 text-[11px] max-w-[120px] truncate cursor-pointer"
                  >
                    {fontsList.length === 0 && <option value={curFont}>{curFont}</option>}
                    {fontsList.map(opt => (
                      <option key={opt.file} value={opt.file}>{opt.label}</option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <span>字号</span>
                    <input type="range" min={0.5} max={2.0} step={0.1} value={curScale}
                      onChange={e => updateOverride(f.label, { font_scale: +e.target.value })}
                      className="w-16 accent-current cursor-pointer"/>
                  </label>
                  {/* 主色 — 圆形色块, 一眼看到是颜色 */}
                  <label className="flex items-center gap-1.5 cursor-pointer hover:opacity-80" title="点击改文字颜色">
                    <span>文字色</span>
                    <span className="relative inline-block w-5 h-5 rounded-full border-2 border-[var(--border)] overflow-hidden"
                      style={{ backgroundColor: curColor }}>
                      <input type="color" value={curColor}
                        onChange={e => updateOverride(f.label, { color: e.target.value })}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"/>
                    </span>
                  </label>
                  {f.highlight_color && (
                    <label className="flex items-center gap-1.5 cursor-pointer hover:opacity-80" title="点击改 {} 包字的颜色">
                      <span>高亮</span>
                      <span className="relative inline-block w-5 h-5 rounded-full border-2 border-[var(--border)] overflow-hidden"
                        style={{ backgroundColor: curHighlight || '#FFD700' }}>
                        <input type="color" value={curHighlight || '#FFD700'}
                          onChange={e => updateOverride(f.label, { highlight_color: e.target.value })}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"/>
                      </span>
                    </label>
                  )}
                  {(f.stroke_width || 0) > 0 && (
                    <label className="flex items-center gap-1.5 cursor-pointer hover:opacity-80" title="点击改描边色">
                      <span>描边</span>
                      <span className="relative inline-block w-5 h-5 rounded-full border-2 border-[var(--border)] overflow-hidden"
                        style={{ backgroundColor: curStroke || '#000000' }}>
                        <input type="color" value={curStroke || '#000000'}
                          onChange={e => updateOverride(f.label, { stroke_color: e.target.value })}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"/>
                      </span>
                    </label>
                  )}
                  {/* 图层: 文字在人物前 / 后 (人物压字) — 仅有人物坑的模板显示 */}
                  {selected.person_slot && (
                    <button
                      onClick={() => updateOverride(f.label, { layer: curLayer === 'behind' ? 'front' : 'behind' })}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-[var(--border)] hover:border-[var(--text-3)] cursor-pointer"
                      title="切换文字在人物前面 / 后面 (人物压字效果)"
                    >
                      <span>图层</span>
                      <span className="font-medium text-[var(--text-2)]">{curLayer === 'behind' ? '人物后' : '人物前'}</span>
                    </button>
                  )}
                  {/* 重置 */}
                  {textOverrides[f.label] && Object.keys(textOverrides[f.label]).length > 0 && (
                    <button
                      onClick={() => setTextOverrides(prev => { const n = { ...prev }; delete n[f.label]; return n })}
                      className="text-[10px] text-[var(--text-3)] hover:text-[var(--text)] cursor-pointer ml-auto"
                    >
                      重置
                    </button>
                  )}
                </div>
              </div>
            )
          })}

          {/* 隐藏了的 admin 字段, 给个一键恢复 */}
          {hiddenLabels.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-3)] pl-1">
              <span>已隐藏:</span>
              {Array.from(hiddenLabels).map(label => (
                <button key={label}
                  onClick={() => setHiddenLabels(prev => { const n = new Set(prev); n.delete(label); return n })}
                  className="px-2 py-0.5 rounded border border-dashed border-[var(--border)] hover:text-[var(--text)] cursor-pointer"
                  title="点击恢复显示"
                >
                  + {label}
                </button>
              ))}
            </div>
          )}

          {/* 用户加的 extra 字段 */}
          {extraFields.map((f, i) => {
            const updateExtra = (patch: Partial<UserCoverTextField>) => {
              setExtraFields(prev => prev.map((ff, idx) => idx === i ? { ...ff, ...patch } : ff))
            }
            return (
              <div key={f.label} className="flex flex-col gap-1.5 border border-dashed border-[var(--border)] rounded-lg p-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-amber-500 font-medium">+ 自定义文字 #{i + 1}</label>
                  <button
                    onClick={() => setExtraFields(prev => prev.filter((_, idx) => idx !== i))}
                    className="text-[10px] text-red-400 hover:text-red-300 cursor-pointer">
                    × 删掉
                  </button>
                </div>
                <input
                  value={userTexts[f.label] || ''}
                  onChange={e => setUserTexts(prev => ({ ...prev, [f.label]: e.target.value }))}
                  placeholder="自定义文字内容"
                  className="bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none focus:border-[var(--text-3)]"
                />
                <div className="flex items-center gap-2 flex-wrap text-[11px] text-[var(--text-3)] pl-1">
                  <select value={f.font_file}
                    onChange={e => updateExtra({ font_file: e.target.value })}
                    className="bg-[var(--bg)] border border-[var(--border)] rounded px-1.5 py-0.5 text-[11px] max-w-[120px] truncate cursor-pointer">
                    {fontsList.map(opt => <option key={opt.file} value={opt.file}>{opt.label}</option>)}
                  </select>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <span>字号</span>
                    <input type="number" min={20} max={400} value={f.font_size}
                      onChange={e => updateExtra({ font_size: +e.target.value })}
                      className="w-14 bg-[var(--bg)] border border-[var(--border)] rounded px-1 py-0.5 text-[11px]"/>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer hover:opacity-80">
                    <span>文字色</span>
                    <span className="relative inline-block w-5 h-5 rounded-full border-2 border-[var(--border)] overflow-hidden"
                      style={{ backgroundColor: f.color }}>
                      <input type="color" value={f.color}
                        onChange={e => updateExtra({ color: e.target.value })}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"/>
                    </span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer hover:opacity-80">
                    <span>描边</span>
                    <span className="relative inline-block w-5 h-5 rounded-full border-2 border-[var(--border)] overflow-hidden"
                      style={{ backgroundColor: f.stroke_color || '#000000' }}>
                      <input type="color" value={f.stroke_color || '#000000'}
                        onChange={e => updateExtra({ stroke_color: e.target.value, stroke_width: f.stroke_width || 4 })}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"/>
                    </span>
                  </label>
                </div>
              </div>
            )
          })}

          {/* +加文字 按钮 */}
          <button
            onClick={() => {
              const id = `extra_${Date.now()}`
              const tplW = 1080            // 默认位置假设, 用户拖拽会改
              const newField: UserCoverTextField = {
                label: id,
                x: Math.round(tplW * 0.1),
                y: Math.round((selected.ratio === '16:9' ? 1080 : 1440) * 0.4),
                w: Math.round(tplW * 0.8),
                h: 200,
                font_file: fontsList[0]?.file || 'SourceHanSansCN-Heavy.otf',
                font_size: 100,
                color: '#FFFFFF',
                highlight_color: null,
                stroke_color: '#000000',
                stroke_width: 4,
                shadow_color: null,
                shadow_offset_x: 0, shadow_offset_y: 0, shadow_blur: 0,
                align: 'left', rotation: 0, max_chars: 0, placeholder: '',
              }
              setExtraFields(prev => [...prev, newField])
              setUserTexts(prev => ({ ...prev, [id]: '新文字' }))
            }}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-[var(--border)] text-xs text-[var(--text-2)] hover:bg-[var(--bg-hover)] hover:border-[var(--text-3)] cursor-pointer">
            + 加一个自定义文字
          </button>

          {/* 人物上传 (有人物坑才显示) */}
          {personSlot && (
            <div className="flex flex-col gap-2 border border-[var(--border)] rounded-lg p-3">
              <div className="text-xs text-[var(--text-2)] flex items-center gap-1.5">
                <Sparkles size={12} className="text-amber-500"/>
                人物图 (AI 自动抠图{personSlot.stroke_enabled ? ', 含描边' : ''})
              </div>
              <PersonLibrary
                selectedOssKey={personOssKey}
                onSelect={(ossKey, previewUrl) => {
                  setPersonOssKey(ossKey)
                  setPersonPreviewUrl(previewUrl)
                  setPersonErr('')
                }}
                stroke={{
                  enabled: personSlot.stroke_enabled,
                  color: personSlot.stroke_color,
                  width: personSlot.stroke_width,
                }}
                onUploadingChange={setPersonProcessing}
                onError={setPersonErr}
              />
              {personErr && <div className="text-[10px] text-red-400">{personErr}</div>}
            </div>
          )}

          {genErr && <div className="text-xs text-red-400 bg-red-950/20 border border-red-900/30 rounded-lg px-3 py-2">{genErr}</div>}

          <button onClick={handleGenerate} disabled={!canGenerate}
            className={`py-2.5 rounded-lg text-sm transition-colors ${
              canGenerate ? 'bg-[var(--text)] text-[var(--bg)] hover:opacity-80 cursor-pointer' : 'bg-[var(--bg-hover)] text-[var(--text-3)] cursor-not-allowed'
            }`}>
            {generating ? <span className="flex items-center justify-center gap-2"><Loader2 size={14} className="animate-spin"/> 渲染中 (后端 Pillow 合成, ~5s)</span>
              : !personReady ? '先上传人物图' : '生成封面'}
          </button>
        </div>
      </div>

      {/* 生成结果 */}
      {result && (
        <div className="border border-[var(--border)] rounded-lg p-3 flex flex-col gap-3 bg-[var(--bg)]">
          <div className="flex items-center gap-2 text-green-500 text-sm">
            <CheckCircle2 size={16}/> 封面生成成功 · {result.width}×{result.height}
          </div>
          <img src={result.download_url} alt="封面" className="w-full max-h-[40vh] object-contain rounded bg-black"/>
          <div className="flex gap-2">
            <button onClick={sendToChat}
              className="flex-1 py-2 rounded-lg bg-[var(--text)] text-[var(--bg)] text-sm hover:opacity-80 cursor-pointer flex items-center justify-center gap-1.5">
              <ImageIcon size={14}/> 发到对话
            </button>
            <a href={result.download_url} target="_blank" rel="noopener noreferrer" download
              className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm hover:bg-[var(--bg-hover)] cursor-pointer flex items-center gap-1.5">
              <Download size={14}/> 下载
            </a>
          </div>
        </div>
      )}
    </div>
  )
}


/** 模板实时预览 — 底图 + 人物 overlay + 文字 overlay (跟最终 Pillow 渲染基本一致).
 * 关键: 文字位置/尺寸按 admin 上传时**底图真实像素尺寸**算, 不是 1080. */
// 特殊 label 给人物用 (跟用户字段 label 不冲突, 因为字段不允许 __ 开头)
const PERSON_LABEL = '__person__'

// 人物预览描边: 人物库只存光图, 描边在生成封面时按模板加. 预览这里用多向 drop-shadow 近似那圈描边,
// 让编辑器看到的跟成品基本一致. 偏移用 cqw (预览容器有 containerType:inline-size), 跟字体描边同量纲.
function personStrokeFilter(color: string, widthPx: number, tplW: number): string {
  if (!tplW || widthPx <= 0) return 'none'
  const o = widthPx / tplW * 100  // cqw
  const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [0.7, -0.7], [-0.7, 0.7], [-0.7, -0.7]]
  return dirs.map(([dx, dy]) => `drop-shadow(${(dx * o).toFixed(3)}cqw ${(dy * o).toFixed(3)}cqw 0 ${color})`).join(' ')
}

export function TemplatePreview({ template, userTexts, textOverrides, extraFields, hiddenLabels, personPreviewUrl, personSlotOverride, onMoveField, onResizeField, onRotateField }: {
  template: CoverTemplate
  userTexts: Record<string, string>
  textOverrides: Record<string, TextFieldOverride>
  extraFields?: UserCoverTextField[]
  hiddenLabels?: Set<string>
  personPreviewUrl: string
  personSlotOverride?: PersonSlotOverride
  onMoveField?: (label: string, dx: number, dy: number) => void
  onResizeField?: (label: string, dx: number, dy: number, corner: 'nw' | 'ne' | 'sw' | 'se') => void
  onRotateField?: (label: string, deltaRotation: number) => void
}) {
  const personSlot = template.person_slot
  const imgRef = useRef<HTMLImageElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [bgSize, setBgSize] = useState<{ w: number; h: number } | null>(null)
  // 当前选中的字段 label (画手柄用)
  const [activeLabel, setActiveLabel] = useState<string | null>(null)

  // 鼠标交互状态: move | resize | rotate
  const interactionRef = useRef<{
    type: 'move' | 'resize' | 'rotate'
    label: string
    startMouseX: number; startMouseY: number
    corner?: 'nw' | 'ne' | 'sw' | 'se'
    centerX?: number; centerY?: number          // rotate 用
    startRotation?: number                        // rotate 起点角度
  } | null>(null)

  // 底图加载后拿真实 naturalWidth/naturalHeight
  useEffect(() => {
    const img = imgRef.current
    if (!img) return
    if (img.complete && img.naturalWidth) {
      setBgSize({ w: img.naturalWidth, h: img.naturalHeight })
    }
  }, [template.bg_url])

  // 模板内每个字段用的字体, 自己负责加载 (让卡片缩略图也能用真字体显示)
  useEffect(() => {
    for (const f of template.text_fields) {
      if (f.font_file) loadFont(f.font_file)
    }
    for (const f of (extraFields || [])) {
      if (f.font_file) loadFont(f.font_file)
    }
  }, [template.id, template.text_fields, extraFields])

  const fallbackW = 1080
  const fallbackH = template.ratio === '3:4' ? 1440
    : template.ratio === '9:16' ? 1920
    : template.ratio === '16:9' ? Math.round(1080 * 9 / 16)
    : 1080
  const tplW = bgSize?.w || fallbackW
  const tplH = bgSize?.h || fallbackH

  // 全局 mousemove/mouseup, 处理 3 种交互
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const it = interactionRef.current
      if (!it || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const scale = tplW / rect.width

      if (it.type === 'move' && onMoveField) {
        const dx = Math.round((e.clientX - it.startMouseX) * scale)
        const dy = Math.round((e.clientY - it.startMouseY) * scale)
        if (dx === 0 && dy === 0) return
        onMoveField(it.label, dx, dy)
        interactionRef.current = { ...it, startMouseX: e.clientX, startMouseY: e.clientY }
      } else if (it.type === 'resize' && onResizeField && it.corner) {
        const dx = Math.round((e.clientX - it.startMouseX) * scale)
        const dy = Math.round((e.clientY - it.startMouseY) * scale)
        if (dx === 0 && dy === 0) return
        onResizeField(it.label, dx, dy, it.corner)
        interactionRef.current = { ...it, startMouseX: e.clientX, startMouseY: e.clientY }
      } else if (it.type === 'rotate' && onRotateField && it.centerX !== undefined && it.centerY !== undefined) {
        // 增量算法跨象限不跳: 算从上次 mousemove 到现在转过的角度差, 调用方累加
        const a0 = Math.atan2(it.startMouseY - it.centerY, it.startMouseX - it.centerX)
        const a1 = Math.atan2(e.clientY - it.centerY, e.clientX - it.centerX)
        let delta = (a1 - a0) * 180 / Math.PI
        if (delta > 180) delta -= 360
        if (delta < -180) delta += 360
        if (Math.abs(delta) < 0.5) return
        onRotateField(it.label, delta)
        interactionRef.current = { ...it, startMouseX: e.clientX, startMouseY: e.clientY }
      }
    }
    const onUp = () => { interactionRef.current = null; document.body.style.cursor = '' }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [tplW, onMoveField, onResizeField, onRotateField])

  return (
    <div ref={containerRef} className="relative rounded-lg overflow-hidden border border-[var(--border)] bg-[var(--bg)]"
         style={{
           aspectRatio: template.ratio.replace(':', ' / '),
           // containerType: inline-size 挂在外层, 让字段内 cqw 单位按整图宽算
           // (之前挂字段 wrapper, cqw=wrapper宽, 字号偏小 ~25%)
           containerType: 'inline-size',
         }}>
      {/* 1. 底图 */}
      {template.bg_url && (
        <img ref={imgRef} src={template.bg_url} alt=""
          onLoad={e => setBgSize({ w: (e.target as HTMLImageElement).naturalWidth, h: (e.target as HTMLImageElement).naturalHeight })}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"/>
      )}

      {/* 1b. 装饰线条 (admin 设计, 用户只读. z: behind=15 在人物(20)下, front=35 在前) */}
      {(template.line_fields || []).map((l, i) => {
        const rot = l.rotation || 0
        return (
          <div key={`line_${i}`} className="absolute pointer-events-none"
            style={{
              left: `${l.x / tplW * 100}%`,
              top: `${l.y / tplH * 100}%`,
              width: `${l.w / tplW * 100}%`,
              height: `${l.h / tplH * 100}%`,
              transform: Math.abs(rot) > 0.01 ? `rotate(${rot}deg)` : undefined,
              transformOrigin: 'center',
              zIndex: l.layer === 'behind' ? 15 : 35,
            }}>
            <span style={lineStyle(l.style, l.color, `${l.thickness / tplW * 100}cqw`)}/>
          </div>
        )
      })}

      {/* 2. 抠完的人物 — 也支持拖移/缩放/旋转 (跟字段一样的手柄) */}
      {personPreviewUrl && personSlot && (() => {
        const ovr = personSlotOverride || {}
        const px = ovr.x ?? personSlot.x
        const py = ovr.y ?? personSlot.y
        const pw = ovr.w ?? personSlot.w
        const ph = ovr.h ?? personSlot.h
        const pRot = ovr.rotation ?? (personSlot.rotation || 0)
        const isPersonActive = activeLabel === PERSON_LABEL
        const interactive = !!(onMoveField && onResizeField && onRotateField)
        return (
          <div
            className={`absolute select-none ${interactive ? `cursor-move ${isPersonActive ? 'outline outline-2 outline-pink-500' : 'hover:outline hover:outline-2 hover:outline-pink-400/70'}` : 'pointer-events-none'}`}
            style={{
              left: `${px / tplW * 100}%`,
              top: `${py / tplH * 100}%`,
              width: `${pw / tplW * 100}%`,
              height: `${ph / tplH * 100}%`,
              transform: Math.abs(pRot) > 0.01 ? `rotate(${pRot}deg)` : undefined,
              transformOrigin: 'center',
              zIndex: 20,   // 介于 behind 文字(10) 和 front 文字(30) 之间
            }}
            onMouseDown={interactive ? (e) => {
              e.preventDefault(); e.stopPropagation()
              setActiveLabel(PERSON_LABEL)
              interactionRef.current = { type: 'move', label: PERSON_LABEL, startMouseX: e.clientX, startMouseY: e.clientY }
              document.body.style.cursor = 'move'
            } : undefined}
            title={interactive ? '拖动调位置, 点选中显示手柄' : undefined}
          >
            <img src={personPreviewUrl} alt=""
              className="w-full h-full object-cover pointer-events-none"
              draggable={false}
              style={personSlot.stroke_enabled && (personSlot.stroke_width || 0) > 0
                ? { filter: personStrokeFilter(personSlot.stroke_color || '#FFFFFF', personSlot.stroke_width || 0, tplW) }
                : undefined}/>

            {/* 选中时显示手柄 (跟字段一样, 但用粉色区分) */}
            {isPersonActive && interactive && (
              <>
                {(['nw', 'ne', 'sw', 'se'] as const).map(corner => {
                  const pos: React.CSSProperties = {
                    position: 'absolute',
                    top: corner.startsWith('n') ? -6 : 'auto',
                    bottom: corner.startsWith('s') ? -6 : 'auto',
                    left: corner.endsWith('w') ? -6 : 'auto',
                    right: corner.endsWith('e') ? -6 : 'auto',
                    cursor: `${corner}-resize`,
                  }
                  return (
                    <div key={corner}
                      onMouseDown={(e) => {
                        e.preventDefault(); e.stopPropagation()
                        interactionRef.current = { type: 'resize', label: PERSON_LABEL, corner,
                          startMouseX: e.clientX, startMouseY: e.clientY }
                        document.body.style.cursor = `${corner}-resize`
                      }}
                      className="w-3 h-3 bg-pink-500 border-2 border-white rounded-sm shadow"
                      style={pos}/>
                  )
                })}
                <div
                  onMouseDown={(e) => {
                    e.preventDefault(); e.stopPropagation()
                    const rect = containerRef.current?.getBoundingClientRect()
                    if (!rect) return
                    const cx = rect.left + (px + pw / 2) / tplW * rect.width
                    const cy = rect.top + (py + ph / 2) / tplH * rect.height
                    interactionRef.current = {
                      type: 'rotate', label: PERSON_LABEL,
                      startMouseX: e.clientX, startMouseY: e.clientY,
                      centerX: cx, centerY: cy,
                      startRotation: pRot,
                    }
                    document.body.style.cursor = 'crosshair'
                  }}
                  className="absolute w-6 h-6 bg-pink-500 border-2 border-white rounded-full shadow-lg cursor-grab active:cursor-grabbing flex items-center justify-center text-white text-[10px] font-bold"
                  style={{ top: -32, left: '50%', transform: 'translateX(-50%)', zIndex: 20 }}
                  title="拖动旋转"
                >↻</div>
                <div className="absolute pointer-events-none border-l border-pink-500"
                  style={{ top: -20, left: '50%', width: 0, height: 12, transform: 'translateX(-0.5px)' }}/>
              </>
            )}
          </div>
        )
      })()}

      {/* 3. 文字 overlay — admin 字段 (没隐藏的) + 用户 extra 字段, 一起渲染 */}
      {[
        ...template.text_fields.filter(f => !(hiddenLabels?.has(f.label))).map(f => ({ field: f, isAdmin: true })),
        ...(extraFields || []).map(f => ({ field: f, isAdmin: false })),
      ].map(({ field: f, isAdmin }, i) => {
        // admin 字段走 override 合并; extra 字段直接用本身值
        const ovr = isAdmin ? (textOverrides[f.label] || {}) : {}
        const text = (userTexts[f.label] || '').trim() || f.placeholder || f.label

        const fontFile = ovr.font_file || f.font_file
        const fontScale = ovr.font_scale ?? 1.0
        const fontSize = f.font_size * fontScale
        const color = ovr.color || f.color
        const highlightColor = ovr.highlight_color || f.highlight_color || color
        const strokeColor = ovr.stroke_color || f.stroke_color
        const strokeWidth = ovr.stroke_width ?? f.stroke_width
        const align = f.align || 'left'

        // 位置: admin 字段优先用 override; extra 字段直接用本身值
        const posX = ovr.x ?? f.x
        const posY = ovr.y ?? f.y
        const posW = ovr.w ?? f.w
        const posH = ovr.h ?? f.h

        const segs = parseSegments(text)
        const justify = align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start'
        const textAlign: any = align

        const strokeCss = strokeColor && strokeWidth > 0
          ? { WebkitTextStroke: `${strokeWidth * 2 / tplW * 100}cqw ${strokeColor}`, paintOrder: 'stroke fill' as const }
          : {}

        const shadowColor = f.shadow_color
        const shadowCss = shadowColor
          ? { textShadow: `${(f.shadow_offset_x || 0) / tplW * 100}cqw ${(f.shadow_offset_y || 0) / tplW * 100}cqw ${(f.shadow_blur || 0) / tplW * 100}cqw ${shadowColor}` }
          : {}

        const ulCss = underlineStyle(f)   // 定位下划线元素的样式 (或 null), 见 lib/coverUnderline

        // 弧形/扇形 (从模板字段 f 读, 跟 shadow/underline 一样不走 override). cqw 单位.
        const arc = f.text_arc || 0
        const isArc = Math.abs(arc) >= 1
        const arcFontCqw = fontSize / tplW * 100

        // 用户/admin 改 rotation 时, 优先用 override 的 (admin 字段), 否则用 field 自带的
        const rotation = (isAdmin ? (ovr.rotation ?? f.rotation) : f.rotation) || 0
        const hasRotation = Math.abs(rotation) > 0.01
        // 图层: behind=人物后(z10) / front=人物前(z30), 人物 z20. 跟后端绘制顺序一致
        const layer = (isAdmin ? (ovr.layer ?? f.layer) : f.layer) || 'front'
        // wrapper 整体旋转 — 字 + handles 一起转 (跟 Canva 一致)
        // 注意: wrapper 不再设 containerType — 让内部 cqw 单位向上找到外层 TemplatePreview 容器,
        // 按整图宽算字号 (而不是按字段框自己的宽). 这样字号比例跟最终图一致.
        const wrapperStyle: React.CSSProperties = {
          left: `${posX / tplW * 100}%`,
          top: `${posY / tplH * 100}%`,
          width: `${posW / tplW * 100}%`,
          height: `${posH / tplH * 100}%`,
          justifyContent: hasRotation ? 'center' : justify,
          alignItems: 'center',
          transform: hasRotation ? `rotate(${rotation}deg)` : undefined,
          transformOrigin: 'center',
          overflow: 'visible',
          zIndex: layer === 'behind' ? 10 : 30,
        }
        const isActive = activeLabel === f.label
        return (
          <div key={i}
            className={`absolute flex items-center select-none ${onMoveField ? `cursor-move ${isActive ? 'outline outline-2 outline-blue-500' : 'hover:outline hover:outline-2 hover:outline-amber-400/70'}` : 'pointer-events-none'}`}
            style={wrapperStyle}
            onMouseDown={onMoveField ? (e) => {
              e.preventDefault()
              e.stopPropagation()
              setActiveLabel(f.label)
              interactionRef.current = { type: 'move', label: f.label, startMouseX: e.clientX, startMouseY: e.clientY }
              document.body.style.cursor = 'move'
            } : undefined}
            title={onMoveField ? '拖动调位置, 点选中显示手柄' : undefined}>
            {isArc ? (
              // 弧形/扇形: 逐字沿弧摆放 (绝对定位, 原点=box中心), 与后端同公式. cqw 单位.
              <div style={{ position: 'absolute', left: '50%', top: '50%', width: 0, height: 0 }}>
                {arcLayout(segmentsToArcChars(segs, color, highlightColor), arc, arcFontCqw).map((c, j) => (
                  <span key={j} style={{
                    position: 'absolute', left: 0, top: 0,
                    transform: `translate(-50%, -50%) translate(${c.x}cqw, ${c.y}cqw) rotate(${c.rot}deg)`,
                    fontFamily: `"${fontFamily(fontFile)}", sans-serif`,
                    fontSize: `${arcFontCqw}cqw`, fontWeight: 900, lineHeight: 1, color: c.color,
                    whiteSpace: 'pre', ...strokeCss,
                  }}>{c.ch}</span>
                ))}
              </div>
            ) : (
            <div style={{
              fontFamily: `"${fontFamily(fontFile)}", sans-serif`,
              fontSize: `${fontSize / tplW * 100}cqw`,
              color,
              fontWeight: 900,
              lineHeight: 1,
              textAlign,
              whiteSpace: 'nowrap',
              transformOrigin: align === 'center' ? 'center' : align === 'right' ? 'right' : 'left',
              ...strokeCss,
              ...shadowCss,
              position: 'relative' as const,
            }}
              ref={el => {
                if (!el || !el.parentElement) return
                // 跟 cover_compositor.py 的 _draw_text_field 保持一致:
                // 不用 CSS scale (scale 跟 align/center 互动会让视觉位置/大小偏离后端实际渲染),
                // 而是真正缩字号 8% 直到塞下 box. 这样预览跟最终图视觉一致.
                el.style.transform = ''
                const parentW = el.parentElement.clientWidth
                if (parentW <= 0) return
                let cur = fontSize
                el.style.fontSize = `${cur / tplW * 100}cqw`
                let safety = 30
                while (el.scrollWidth > parentW && cur > 12 && safety-- > 0) {
                  cur = Math.floor(cur * 0.92)
                  el.style.fontSize = `${cur / tplW * 100}cqw`
                }
              }}
            >
              {segs.map((s, j) => (
                <span key={j} style={{ color: s.highlight ? highlightColor : color }}>{s.text}</span>
              ))}
              {ulCss && <span style={ulCss}/>}
            </div>
            )}

            {/* Canva 风手柄: 4 角缩放 + 顶部旋转 (只在选中时显示, 只有支持 resize/rotate 回调时) */}
            {isActive && onResizeField && (
              <>
                {(['nw', 'ne', 'sw', 'se'] as const).map(corner => {
                  const pos: React.CSSProperties = {
                    position: 'absolute',
                    top: corner.startsWith('n') ? -6 : 'auto',
                    bottom: corner.startsWith('s') ? -6 : 'auto',
                    left: corner.endsWith('w') ? -6 : 'auto',
                    right: corner.endsWith('e') ? -6 : 'auto',
                    cursor: `${corner}-resize`,
                  }
                  return (
                    <div key={corner}
                      onMouseDown={(e) => {
                        e.preventDefault(); e.stopPropagation()
                        interactionRef.current = { type: 'resize', label: f.label, corner,
                          startMouseX: e.clientX, startMouseY: e.clientY }
                        document.body.style.cursor = `${corner}-resize`
                      }}
                      className="w-3 h-3 bg-blue-500 border-2 border-white rounded-sm shadow"
                      style={pos}/>
                  )
                })}
              </>
            )}
            {isActive && onRotateField && (
              <>
                <div
                  onMouseDown={(e) => {
                    e.preventDefault(); e.stopPropagation()
                    const rect = containerRef.current?.getBoundingClientRect()
                    if (!rect) return
                    const cx = rect.left + (posX + posW / 2) / tplW * rect.width
                    const cy = rect.top + (posY + posH / 2) / tplH * rect.height
                    interactionRef.current = {
                      type: 'rotate', label: f.label,
                      startMouseX: e.clientX, startMouseY: e.clientY,
                      centerX: cx, centerY: cy,
                      startRotation: rotation,
                    }
                    document.body.style.cursor = 'crosshair'
                  }}
                  className="absolute w-6 h-6 bg-blue-500 border-2 border-white rounded-full shadow-lg cursor-grab active:cursor-grabbing flex items-center justify-center text-white text-[10px] font-bold"
                  style={{ top: -32, left: '50%', transform: 'translateX(-50%)', zIndex: 20 }}
                  title="拖动旋转"
                >↻</div>
                <div className="absolute pointer-events-none border-l border-blue-500"
                  style={{ top: -20, left: '50%', width: 0, height: 12, transform: 'translateX(-0.5px)' }}/>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
