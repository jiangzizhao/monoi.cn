import { useEffect, useRef, useState } from 'react'
import { Plus, Upload, Loader2, X, ImageIcon } from 'lucide-react'
import {
  listMyPersonCutouts, deleteMyPersonCutout, touchMyPersonCutout, coverRemoveBg,
  type MyPersonCutout,
} from '../../../services/cover'

interface Props {
  /** 当前选中的 oss_key (受控). 空 = 没选中. */
  selectedOssKey: string
  /** 选中变化 — 选了已有的人物 / 上传完抠图后. preview_url 是签好的 URL, 给预览用. */
  onSelect: (ossKey: string, previewUrl: string) => void
  /** 上传新图时的抠图配置 (跟模板的 person_slot stroke 保持一致) */
  stroke?: {
    enabled?: boolean
    color?: string
    width?: number
  }
  /** 抠图开始 / 完成回调, 让父组件能显示 "AI 抠图中" 之类状态 */
  onUploadingChange?: (uploading: boolean) => void
  onError?: (msg: string) => void
}

/** "我的人物" — 用户抠过的所有人物图缩略图 grid + 上传新人物按钮.
 * 第一格永远是 "+ 新增", 后面按 last_used_at 倒序排. */
export function PersonLibrary({ selectedOssKey, onSelect, stroke, onUploadingChange, onError }: Props) {
  const [items, setItems] = useState<MyPersonCutout[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // 拉列表
  const loadList = async () => {
    try {
      const r = await listMyPersonCutouts()
      setItems(r.items || [])
    } catch (e: any) {
      onError?.(e.message || '加载人物库失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadList() }, [])

  const setUp = (b: boolean) => { setUploading(b); onUploadingChange?.(b) }

  // 上传新图 → 抠图 → 选中 + 添加到列表
  const handleFile = async (f: File) => {
    if (!f.type.startsWith('image/')) { onError?.('请选图片文件'); return }
    if (f.size > 20 * 1024 * 1024) { onError?.('图片太大 (>20MB)'); return }
    setUp(true)
    try {
      const r = await coverRemoveBg(f, {
        stroke_enabled: stroke?.enabled,
        stroke_color: stroke?.color,
        stroke_width: stroke?.width,
      })
      // 抠图成功 → 后端会自动写入 user_person_cutout 表, 重新拉一下列表
      await loadList()
      onSelect(r.oss_key, r.preview_url)
    } catch (e: any) {
      onError?.(e.message || '抠图失败')
    } finally {
      setUp(false)
    }
  }

  // 选已有人物 → 调 touch + 通知父组件
  const handlePick = async (item: MyPersonCutout) => {
    onSelect(item.oss_key, item.preview_url)
    try {
      await touchMyPersonCutout(item.id)
      // touch 成功不重拉列表 (节省请求), 下次进来再排序就行
    } catch {
      // touch 失败不影响功能
    }
  }

  // 删除
  const handleDelete = async (id: number) => {
    try {
      await deleteMyPersonCutout(id)
      setItems(prev => prev.filter(it => it.id !== id))
      // 如果删的是当前选中的, 清空选中
      const deleted = items.find(it => it.id === id)
      if (deleted && deleted.oss_key === selectedOssKey) {
        onSelect('', '')
      }
    } catch (e: any) {
      onError?.(e.message || '删除失败')
    } finally {
      setConfirmDeleteId(null)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <input ref={fileRef} type="file" accept="image/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); if (fileRef.current) fileRef.current.value = '' }}/>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-[var(--text-3)] py-4">
          <Loader2 size={12} className="animate-spin"/> 加载人物库...
        </div>
      ) : items.length === 0 ? (
        // 空状态: 大上传卡片
        <button onClick={() => fileRef.current?.click()} disabled={uploading}
          className={`flex flex-col items-center justify-center gap-2 px-4 py-6 rounded-lg border border-dashed text-xs ${
            uploading
              ? 'border-[var(--border)] text-[var(--text-3)] cursor-wait'
              : 'border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--bg-hover)] cursor-pointer'
          }`}>
          {uploading
            ? <><Loader2 size={14} className="animate-spin"/> AI 抠图中 5-15s</>
            : <>
                <Upload size={14}/>
                选张人物照片 (jpg/png, ≤20MB)
                <span className="text-[10px] text-[var(--text-3)]">上传后 AI 自动抠图</span>
              </>
          }
        </button>
      ) : (
        // grid 视图: + 新增 + 已有人物
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: 'thin' }}>
          {/* + 新增 */}
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className={`flex-shrink-0 w-20 h-20 rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1 text-[10px] ${
              uploading
                ? 'border-[var(--border)] text-[var(--text-3)] cursor-wait'
                : 'border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--bg-hover)] hover:border-[var(--text-3)] cursor-pointer'
            }`}
            title="上传新的人物图">
            {uploading
              ? <><Loader2 size={16} className="animate-spin"/> 抠图中</>
              : <><Plus size={20}/> 新增</>
            }
          </button>

          {/* 已有人物 */}
          {items.map(item => {
            const isSelected = item.oss_key === selectedOssKey
            const isConfirming = confirmDeleteId === item.id
            return (
              <div key={item.id} className="relative flex-shrink-0 group">
                <button onClick={() => handlePick(item)}
                  className={`w-20 h-20 rounded-lg overflow-hidden border-2 transition-all ${
                    isSelected
                      ? 'border-blue-500 ring-2 ring-blue-500/30'
                      : 'border-[var(--border)] hover:border-[var(--text-3)] cursor-pointer'
                  }`}
                  title={item.filename || `人物 #${item.id}`}>
                  {item.preview_url ? (
                    <img src={item.preview_url} alt={item.filename || ''}
                      className="w-full h-full object-contain bg-[var(--bg)]"
                      draggable={false}/>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[var(--text-3)] bg-[var(--bg)]">
                      <ImageIcon size={20}/>
                    </div>
                  )}
                </button>

                {/* 删除按钮 — hover 显示 */}
                {!isConfirming ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(item.id) }}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer hover:bg-red-600 shadow"
                    title="删除"
                  >
                    <X size={11}/>
                  </button>
                ) : (
                  // 二次确认气泡
                  <div className="absolute -top-1 -right-1 flex gap-0.5 items-center bg-[var(--bg-card)] border border-[var(--border)] rounded-lg shadow-lg px-1 py-0.5">
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(item.id) }}
                      className="text-[10px] text-red-500 hover:text-red-400 cursor-pointer px-1">删</button>
                    <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null) }}
                      className="text-[10px] text-[var(--text-3)] hover:text-[var(--text)] cursor-pointer px-1">×</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
