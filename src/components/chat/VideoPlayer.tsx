import { useEffect, useRef, useState } from 'react'
import { Play, Pause, Download, Loader2, FileBox, FolderOpen, CheckCircle2 } from 'lucide-react'
import type { VideoResult } from '../../types'
import {
  isFileSystemAPISupported,
  pickAndSaveDraftDir,
  getSavedDraftDir,
  forgetDraftDir,
  downloadAndExtractZipToFolder,
} from '../../lib/jianyingFolder'

function resolveUrl(raw: string) {
  if (!raw) return ''
  if (raw.startsWith('http')) return raw
  // 视频文件可能很大, 直传 NATAPP 绕开 Vercel 4.5MB 响应体限制
  const directBase = import.meta.env.VITE_DIRECT_API_URL || 'https://monoi.nat100.top'
  return directBase + raw
}

export function VideoPlayer({ data }: { data: VideoResult }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [downloading, setDownloading] = useState(false)
  // 剪映草稿导出状态 (有 jianying_payload 才显示按钮)
  const [exportingDraft, setExportingDraft] = useState(false)
  const [draftUrl, setDraftUrl] = useState<string | null>(null)
  const [draftError, setDraftError] = useState('')
  const [draftSizeMB, setDraftSizeMB] = useState<number | null>(null)
  const [draftProgress, setDraftProgress] = useState('')          // 解压进度文字
  const [draftWritten, setDraftWritten] = useState<string | null>(null)  // 成功写进剪映目录后显示
  const [draftDirSet, setDraftDirSet] = useState<boolean | null>(null)   // 用户是否配过剪映目录 (null=查询中)
  const fsSupported = isFileSystemAPISupported()

  // 启动时检查 IndexedDB 里有没有保存过剪映目录 handle
  useEffect(() => {
    if (!fsSupported || !data.jianying_payload) { setDraftDirSet(false); return }
    getSavedDraftDir().then(h => setDraftDirSet(!!h)).catch(() => setDraftDirSet(false))
  }, [fsSupported, data.jianying_payload])

  const url = resolveUrl(data.video_url)
  const durationSec = data.duration_ms ? data.duration_ms / 1000 : undefined

  const toggle = () => {
    const v = videoRef.current
    if (!v) return
    if (playing) { v.pause(); setPlaying(false) }
    else { v.play(); setPlaying(true) }
  }

  const onTime = () => {
    const v = videoRef.current
    if (!v || !v.duration) return
    setProgress((v.currentTime / v.duration) * 100)
  }

  // 先调后端拼草稿 + 上传 OSS, 返签名 URL
  async function callBackendExport(): Promise<{ url: string; sizeMB: number | null }> {
    const directBase = import.meta.env.VITE_DIRECT_API_URL || 'https://monoi.nat100.top'
    const res = await fetch(directBase + '/api/voice/compose-jianying-draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data.jianying_payload),
    })
    const j = await res.json()
    if (!res.ok || !j.success) throw new Error(j.detail || j.error || `导出失败 (${res.status})`)
    return {
      url: j.download_url,
      sizeMB: j.zip_size ? Math.round(j.zip_size / 1024 / 1024 * 10) / 10 : null,
    }
  }

  // 让用户选剪映草稿目录 (一次设置, 永久记住)
  const handlePickDir = async () => {
    setDraftError('')
    try {
      await pickAndSaveDraftDir()
      setDraftDirSet(true)
    } catch (e: any) {
      // 用户取消选择会抛 AbortError, 静默
      if (e?.name !== 'AbortError') setDraftError(e.message || '选择目录失败')
    }
  }

  const handleForgetDir = async () => {
    await forgetDraftDir()
    setDraftDirSet(false)
    setDraftWritten(null)
  }

  // 主导出: 调后端 → 拉 zip → 解压写进剪映目录 (一气呵成, 用户什么都不用做)
  const handleExportToFolder = async () => {
    if (exportingDraft || !data.jianying_payload) return
    setExportingDraft(true)
    setDraftError('')
    setDraftWritten(null)
    try {
      const dir = await getSavedDraftDir()
      if (!dir) throw new Error('剪映目录权限过期, 请重新选择')
      setDraftProgress('调后端拼草稿...')
      const { url, sizeMB } = await callBackendExport()
      setDraftSizeMB(sizeMB)
      const { rootFolderName } = await downloadAndExtractZipToFolder(url, dir, setDraftProgress)
      setDraftWritten(rootFolderName)
    } catch (e: any) {
      setDraftError(e.message || '导出失败')
    } finally {
      setExportingDraft(false)
      setDraftProgress('')
    }
  }

  // Fallback: 不支持 File System API 的浏览器 (Safari/Firefox), 只能下 zip 让用户手动
  const handleExportZipFallback = async () => {
    if (exportingDraft || !data.jianying_payload) return
    setExportingDraft(true)
    setDraftError('')
    try {
      const { url, sizeMB } = await callBackendExport()
      setDraftUrl(url)
      setDraftSizeMB(sizeMB)
    } catch (e: any) {
      setDraftError(e.message || '导出失败')
    } finally {
      setExportingDraft(false)
    }
  }

  // fetch + blob 触发下载, 绕开 <a download> 跨源失效
  const handleDownload = async () => {
    if (downloading) return
    setDownloading(true)
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      const baseName = (data.audio_label || '数字人').replace(/[\\/:*?"<>|]/g, '_')
      const ext = (data.video_url.match(/\.(\w{2,5})(?:\?|$)/)?.[1] || 'mp4').toLowerCase()
      a.download = `${baseName}_${durationSec ? durationSec.toFixed(1) + 's' : 'video'}.${ext}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(blobUrl)
    } catch {
      window.open(url, '_blank')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3 flex flex-col gap-3">
      {data.text_preview && (
        <div className="text-xs text-[var(--text-3)] leading-relaxed whitespace-pre-wrap line-clamp-2">
          {data.text_preview}
        </div>
      )}
      <div className="relative w-full rounded-lg overflow-hidden bg-black">
        <video
          ref={videoRef}
          src={url}
          className="w-full max-h-[420px] object-contain"
          onTimeUpdate={onTime}
          onEnded={() => { setPlaying(false); setProgress(0) }}
          onClick={toggle}
          preload="none"
          playsInline
        />
        {!playing && (
          <button
            onClick={toggle}
            className="absolute inset-0 flex items-center justify-center cursor-pointer group"
            aria-label="播放"
          >
            <span className="w-14 h-14 rounded-full bg-white/85 group-hover:bg-white text-black flex items-center justify-center shadow-xl transition-colors">
              <Play size={22} fill="currentColor" className="ml-1"/>
            </span>
          </button>
        )}
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={toggle}
          className="w-9 h-9 rounded-full bg-[var(--text)] text-[var(--bg)] flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity flex-shrink-0"
        >
          {playing ? <Pause size={14} fill="currentColor"/> : <Play size={14} fill="currentColor" className="ml-0.5"/>}
        </button>
        <div className="flex-1 min-w-0">
          <div className="h-1.5 rounded-full bg-[var(--bg-hover)] overflow-hidden">
            <div className="h-full bg-[var(--text)] transition-all" style={{ width: `${progress}%` }}/>
          </div>
          <div className="flex items-center justify-between mt-1.5 text-xs text-[var(--text-3)]">
            <span>{data.audio_label || '数字人'} {data.width && data.height ? `· ${data.width}×${data.height}` : ''}</span>
            <span>{durationSec ? `${durationSec.toFixed(1)}s` : ''}</span>
          </div>
        </div>
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="w-9 h-9 rounded-lg flex items-center justify-center text-[var(--text-2)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] cursor-pointer flex-shrink-0 disabled:opacity-50 disabled:cursor-wait"
          title="下载"
        >
          {downloading ? <Loader2 size={14} className="animate-spin"/> : <Download size={14}/>}
        </button>
      </div>

      {data.jianying_payload && (
        <div className="border-t border-[var(--border)] pt-3 flex flex-col gap-2">
          {/* 浏览器支持自动写入 (Chrome/Edge): 3 种状态 — 没选目录 / 已选目录 / 写入成功 */}
          {fsSupported ? (
            <>
              {draftWritten ? (
                // 成功写入
                <div className="flex flex-col gap-1 text-xs">
                  <div className="flex items-center gap-2 text-green-500">
                    <CheckCircle2 size={14}/>
                    <span>已写入剪映目录 — 草稿名 <code className="bg-[var(--bg-hover)] px-1 rounded">{draftWritten}</code></span>
                  </div>
                  <p className="text-[var(--text-3)]">切到剪映 (可能要刷新草稿列表), 就能看到这条按句分段的草稿. 重新生成会覆盖.</p>
                  <button onClick={handleExportToFolder} disabled={exportingDraft}
                    className="self-start mt-1 flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-[var(--text-2)] border border-[var(--border)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors">
                    <FileBox size={12}/>再导一次
                  </button>
                </div>
              ) : draftDirSet === false ? (
                // 首次: 先让用户选目录
                <div className="flex flex-col gap-1.5 text-xs">
                  <button onClick={handlePickDir}
                    className="self-start flex items-center gap-2 px-3 py-1.5 rounded-lg text-[var(--text)] border border-[var(--border)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors">
                    <FolderOpen size={12}/>设置剪映草稿目录 (一次性)
                  </button>
                  <p className="text-[var(--text-3)] leading-relaxed">
                    第一次用要选一下你电脑上剪映的草稿目录, 之后导出会自动写入, 不用每次手动放.
                    <br/>
                    Win: <code className="text-[10px] bg-[var(--bg-hover)] px-1 rounded">%LOCALAPPDATA%\JianyingPro\User Data\Projects\com.lveditor.draft\</code>
                    <br/>
                    Mac: <code className="text-[10px] bg-[var(--bg-hover)] px-1 rounded">~/Movies/JianyingPro/User Data/Projects/com.lveditor.draft/</code>
                  </p>
                </div>
              ) : draftDirSet === true ? (
                // 已设目录: 一键导出
                <>
                  <div className="flex items-center gap-2">
                    <button onClick={handleExportToFolder} disabled={exportingDraft}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-[var(--text-2)] border border-[var(--border)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] disabled:opacity-50 disabled:cursor-wait cursor-pointer transition-colors">
                      {exportingDraft ? <Loader2 size={12} className="animate-spin"/> : <FileBox size={12}/>}
                      {exportingDraft ? (draftProgress || '处理中...') : '导出到剪映 (按句分段)'}
                    </button>
                    <button onClick={handleForgetDir}
                      className="text-[10px] text-[var(--text-3)] hover:text-[var(--text-2)] underline cursor-pointer"
                      title="清除已选的剪映目录, 下次重新选">换目录</button>
                  </div>
                  {exportingDraft && draftProgress && (
                    <p className="text-[10px] text-[var(--text-3)]">{draftProgress}{draftSizeMB ? ` · zip ${draftSizeMB} MB` : ''}</p>
                  )}
                </>
              ) : (
                <span className="text-[10px] text-[var(--text-3)]">检查中...</span>
              )}
            </>
          ) : (
            // Fallback: Safari/Firefox 等不支持的浏览器, 退回手动下 zip
            <>
              {!draftUrl ? (
                <button onClick={handleExportZipFallback} disabled={exportingDraft}
                  className="self-start flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-[var(--text-2)] border border-[var(--border)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] disabled:opacity-50 disabled:cursor-wait cursor-pointer transition-colors">
                  {exportingDraft ? <Loader2 size={12} className="animate-spin"/> : <FileBox size={12}/>}
                  {exportingDraft ? '正在打包草稿 (约 30-60 秒)' : '导出剪映草稿 (按句分段)'}
                </button>
              ) : (
                <div className="flex flex-col gap-1.5 text-xs">
                  <a href={draftUrl} target="_blank" rel="noopener noreferrer"
                    className="self-start flex items-center gap-2 px-3 py-1.5 rounded-lg text-[var(--text)] border border-[var(--border)] hover:bg-[var(--bg-hover)] transition-colors">
                    <Download size={12}/>下载草稿 zip{draftSizeMB ? ` (${draftSizeMB} MB)` : ''}
                  </a>
                  <p className="text-[var(--text-3)] leading-relaxed">
                    Chrome/Edge 浏览器可以自动导入到剪映 (你现在用的浏览器不支持). 当前需手动解压到剪映草稿目录:
                    <br/>
                    Win: <code className="text-[10px] bg-[var(--bg-hover)] px-1 rounded">%LOCALAPPDATA%\JianyingPro\User Data\Projects\com.lveditor.draft\</code>
                    <br/>
                    Mac: <code className="text-[10px] bg-[var(--bg-hover)] px-1 rounded">~/Movies/JianyingPro/User Data/Projects/com.lveditor.draft/</code>
                  </p>
                </div>
              )}
            </>
          )}
          {draftError && <p className="text-xs text-red-400">{draftError}</p>}
        </div>
      )}
    </div>
  )
}
