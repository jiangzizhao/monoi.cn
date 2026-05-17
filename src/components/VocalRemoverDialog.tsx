import { useEffect, useRef, useState } from 'react'
import { X, Loader2, Upload, CheckCircle2, Download, Music, Scissors } from 'lucide-react'
import { removeVocals, trimAudio, type RemoveVocalsResp } from '../services/audio'
import { AudioWaveformTrimmer } from './AudioWaveformTrimmer'

interface Props {
  open: boolean
  onClose: () => void
  onUseAsBgm?: (oss_key: string, name: string) => void   // 选了 "用作 BGM" 时调
}

export function VocalRemoverDialog({ open, onClose, onUseAsBgm }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [processing, setProcessing] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [result, setResult] = useState<RemoveVocalsResp | null>(null)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  // 裁剪状态
  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(0)
  const [trimming, setTrimming] = useState(false)
  const [trimmedResult, setTrimmedResult] = useState<{ oss_key: string; download_url: string; duration_seconds: number; output_size_kb: number } | null>(null)

  // processing 期间秒数 +1, 让用户知道还在跑 (demucs CPU 模式可能 2-5 分钟)
  useEffect(() => {
    if (!processing) { setElapsed(0); return }
    const id = setInterval(() => setElapsed(s => s + 1), 1000)
    return () => clearInterval(id)
  }, [processing])

  // 关弹窗时重置 + 取消 in-flight 请求
  useEffect(() => {
    if (!open) {
      abortRef.current?.abort()
      setFile(null); setResult(null); setError(''); setProcessing(false)
      setTrimmedResult(null); setTrimStart(0); setTrimEnd(0)
    }
  }, [open])

  if (!open) return null

  const handlePick = () => fileRef.current?.click()

  const handleFile = (f: File) => {
    if (f.size > 50 * 1024 * 1024) { setError('文件太大 (>50MB), 请压缩'); return }
    const ext = f.name.toLowerCase().match(/\.(mp3|wav|m4a|flac|ogg|aac|aiff)$/)
    if (!ext) { setError('只支持 mp3/wav/m4a/flac/ogg/aac/aiff'); return }
    setFile(f); setError(''); setResult(null)
  }

  const handleProcess = async () => {
    if (!file || processing) return
    setProcessing(true); setError(''); setResult(null)
    abortRef.current = new AbortController()
    try {
      const r = await removeVocals(file, abortRef.current.signal)
      setResult(r)
    } catch (e: any) {
      if (e.name !== 'AbortError') setError(e.message || '去人声失败')
    } finally { setProcessing(false) }
  }

  const handleCancel = () => {
    abortRef.current?.abort()
    setProcessing(false)
  }

  const handleTrim = async () => {
    if (!result || trimming) return
    // 如果没动 trim handles (start=0, end=duration), 不裁剪
    if (Math.abs(trimStart) < 0.05 && Math.abs(trimEnd - result.duration_seconds) < 0.05) {
      alert('没有改起止时间, 跳过裁剪 (直接用原文件即可)')
      return
    }
    setTrimming(true); setError('')
    try {
      const r = await trimAudio(result.oss_key, trimStart, trimEnd)
      setTrimmedResult(r)
    } catch (e: any) {
      setError(e.message || '裁剪失败')
    } finally { setTrimming(false) }
  }

  // 当前展示的"最终结果" — 裁剪过用 trimmedResult, 否则用原始 result
  const finalResult = trimmedResult ? {
    download_url: trimmedResult.download_url,
    oss_key: trimmedResult.oss_key,
    duration_seconds: trimmedResult.duration_seconds,
    output_size_kb: trimmedResult.output_size_kb,
    original_filename: result?.original_filename || 'bgm',
    gpu_used: result?.gpu_used || false,
  } : result

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="relative bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-ios-lg w-full max-w-md p-6 flex flex-col gap-4">
        <button onClick={onClose} className="absolute top-4 right-4 p-1 rounded text-[var(--text-3)] hover:bg-[var(--bg-hover)] cursor-pointer"><X size={14}/></button>

        <div>
          <div className="flex items-center gap-2 text-base font-semibold">
            <Music size={18}/> 音乐去人声
          </div>
          <div className="text-xs text-[var(--text-3)] mt-1">上传任意音乐 → AI 自动去除人声 → 导出纯 BGM (无版权风险更低)</div>
        </div>

        {/* 已选文件 / 选文件按钮 */}
        {!result && (
          <>
            <div onClick={handlePick}
              className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center gap-2 cursor-pointer transition-colors ${
                file ? 'border-[var(--text)] bg-[var(--bg-hover)]' : 'border-[var(--border)] hover:border-[var(--text-3)]'
              }`}>
              <Upload size={24} className="text-[var(--text-3)]"/>
              {file ? (
                <>
                  <div className="text-sm font-medium text-[var(--text)]">{file.name}</div>
                  <div className="text-[10px] text-[var(--text-3)]">{(file.size / 1024 / 1024).toFixed(1)} MB · 点击换文件</div>
                </>
              ) : (
                <>
                  <div className="text-sm text-[var(--text-2)]">点击选择音乐文件</div>
                  <div className="text-[10px] text-[var(--text-3)]">支持 mp3/wav/m4a/flac · 最大 50MB</div>
                </>
              )}
            </div>
            <input ref={fileRef} type="file" accept=".mp3,.wav,.m4a,.flac,.ogg,.aac,.aiff" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}/>

            {error && <p className="text-xs text-red-400">{error}</p>}

            {file && !processing && (
              <button onClick={handleProcess}
                className="py-2.5 rounded-xl bg-[var(--text)] text-[var(--bg)] text-sm font-medium hover:opacity-80 cursor-pointer">
                开始去人声
              </button>
            )}
            {processing && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-sm text-[var(--text-2)]">
                  <Loader2 size={14} className="animate-spin"/>
                  AI 分离中... {elapsed}s
                </div>
                <div className="text-[10px] text-[var(--text-3)]">
                  AI 分离一般需要几十秒到几分钟 (看歌长). 别关弹窗, 关了任务会取消.
                </div>
                <button onClick={handleCancel} className="text-xs text-[var(--text-3)] hover:text-[var(--text-2)] cursor-pointer self-start">
                  取消
                </button>
              </div>
            )}
          </>
        )}

        {/* 去人声完成 — 展示波形 + 裁剪选区 */}
        {result && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-green-500">
              <CheckCircle2 size={18}/>
              <span className="text-sm font-medium">去人声完成</span>
              <span className="text-[10px] text-[var(--text-3)] ml-auto">
                {(finalResult!.output_size_kb / 1024).toFixed(1)} MB · {finalResult!.duration_seconds.toFixed(1)}s
              </span>
            </div>

            {/* 波形 + 拖动裁剪 (基于最初的 result.download_url, 编辑 region) */}
            {!trimmedResult && (
              <>
                <AudioWaveformTrimmer
                  audioUrl={result.download_url}
                  onChange={(s, e) => { setTrimStart(s); setTrimEnd(e) }}
                />
                <button onClick={handleTrim} disabled={trimming}
                  className="self-start flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] disabled:opacity-50 cursor-pointer">
                  {trimming ? <Loader2 size={12} className="animate-spin"/> : <Scissors size={12}/>}
                  {trimming ? '裁剪中...' : `裁剪到 ${(trimEnd - trimStart).toFixed(1)}s`}
                </button>
              </>
            )}

            {/* 裁剪完显示提示 */}
            {trimmedResult && (
              <div className="text-xs text-[var(--text-3)] bg-[var(--bg-hover)] rounded px-3 py-2">
                已裁剪到 {trimmedResult.duration_seconds.toFixed(1)}s · 下面是最终 BGM
              </div>
            )}

            {error && <p className="text-xs text-red-400">{error}</p>}

            {/* 下载 / 用作 BGM (用最终的 finalResult) */}
            <div className="flex flex-col gap-2">
              <a href={finalResult!.download_url} target="_blank" rel="noopener noreferrer" download
                className="py-2 rounded-xl border border-[var(--border)] hover:bg-[var(--bg-hover)] text-sm flex items-center justify-center gap-2 cursor-pointer">
                <Download size={14}/> 下载 BGM mp3
              </a>
              {onUseAsBgm && (
                <button onClick={() => { onUseAsBgm(finalResult!.oss_key, result.original_filename.replace(/\.\w+$/, '') + (trimmedResult ? ' (去人声+裁剪)' : ' (去人声)')); onClose() }}
                  className="py-2 rounded-xl bg-[var(--text)] text-[var(--bg)] text-sm hover:opacity-80 cursor-pointer">
                  直接用作合成 BGM
                </button>
              )}
              <button onClick={() => { setResult(null); setFile(null); setTrimmedResult(null) }}
                className="text-xs text-[var(--text-3)] hover:text-[var(--text-2)] cursor-pointer">
                再处理一首
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
