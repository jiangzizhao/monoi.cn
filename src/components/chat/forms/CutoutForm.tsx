import { useState } from 'react'
import { X, Download, Sticker, AlertCircle } from 'lucide-react'
import { PersonLibrary } from './PersonLibrary'

interface Props {
  onClose: () => void
}

/** 独立的人物抠图功能 — 不绑封面模板. 复用 PersonLibrary (我的人物库) + 加下载按钮.
 * 后端限制: user_person_cutout 表每用户最多 10 个 (超额时后端自动删最旧的). */
export function CutoutForm({ onClose }: Props) {
  const [selectedOssKey, setSelectedOssKey] = useState('')
  const [selectedUrl, setSelectedUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')

  // 默认 stroke 配置 — 抠图器独立用, 不带描边 (用户原图样)
  const STROKE = { enabled: false, color: '#FFFFFF', width: 0 }

  const handleDownload = () => {
    if (!selectedUrl) return
    // 用 a 标签下载, 透明 PNG 保留
    const a = document.createElement('a')
    a.href = selectedUrl
    a.download = `monoi-cutout-${Date.now()}.png`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] w-full max-w-2xl flex flex-col gap-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] sticky top-0 bg-[var(--bg-card)] z-10">
          <div className="flex items-center gap-2">
            <Sticker size={18} className="text-amber-500"/>
            <div>
              <div className="text-base font-semibold">人物抠图</div>
              <div className="text-[11px] text-[var(--text-3)] mt-0.5">AI 自动抠去背景, 输出透明 PNG. 抠过的图最多存 10 张</div>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-[var(--bg-hover)] flex items-center justify-center text-[var(--text-2)] cursor-pointer">
            <X size={18}/>
          </button>
        </div>

        <div className="px-5 pb-5 flex flex-col gap-4">
          {/* 上传 / 选历史 */}
          <PersonLibrary
            selectedOssKey={selectedOssKey}
            onSelect={(ossKey, previewUrl) => {
              setSelectedOssKey(ossKey)
              setSelectedUrl(previewUrl)
              setErr('')
            }}
            stroke={STROKE}
            onUploadingChange={setUploading}
            onError={setErr}
          />

          {err && (
            <div className="text-xs text-red-400 bg-red-950/20 border border-red-900/30 rounded-lg px-3 py-2 flex items-start gap-2">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5"/>
              <span>{err}</span>
            </div>
          )}

          {/* 选中后的大预览 + 下载 */}
          {selectedUrl && (
            <div className="flex flex-col gap-3 border border-[var(--border)] rounded-lg p-3 bg-[var(--bg)]">
              <div className="text-xs text-[var(--text-3)]">抠图结果</div>
              <div className="rounded-lg bg-[repeating-conic-gradient(#ddd_0deg_25%,#fff_0deg_50%)] [background-size:20px_20px] p-4 flex items-center justify-center min-h-[200px]">
                <img src={selectedUrl} alt="抠图结果"
                  className="max-w-full max-h-[60vh] object-contain"/>
              </div>
              <button onClick={handleDownload}
                className="flex items-center justify-center gap-2 py-2.5 rounded-lg bg-[var(--text)] text-[var(--bg)] text-sm hover:opacity-80 cursor-pointer">
                <Download size={14}/> 下载透明 PNG
              </button>
            </div>
          )}

          {!selectedUrl && !uploading && (
            <div className="text-center text-xs text-[var(--text-3)] py-4">
              上传一张含人物的照片, AI 5-15 秒抠完背景, 可下载透明 PNG
            </div>
          )}

          <div className="text-[11px] text-[var(--text-3)] leading-relaxed border-t border-[var(--border-subtle)] pt-3">
            <div className="font-medium text-[var(--text-2)] mb-1">说明</div>
            <ul className="space-y-0.5 list-disc list-inside">
              <li>"我的人物"库每用户最多存 <span className="text-[var(--text-2)]">10 张</span>, 超过自动清最旧的</li>
              <li>下载后保存到本地, 不占库存额度</li>
              <li>用做封面 / 数字人形象 都可以直接复用</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
