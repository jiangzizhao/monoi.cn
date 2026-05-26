import { useState, useMemo, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Send, Loader2, CheckCircle2, AlertCircle, ExternalLink } from 'lucide-react'
import { useChatStore } from '../../../store/chatStore'
import type { PlatformCopyResult } from '../../../types'
import { getToken } from '../../../lib/auth'
import { consumePrefill } from '../../../lib/formPrefill'

interface Props {
  onClose: () => void
}

type Platform = 'xhs' | 'douyin'

interface FormState {
  title: string
  description: string
  tags: string   // 逗号分隔, 提交时拆 list
}

interface JobStatus {
  job_id?: string
  platform?: string
  status: string          // 'downloading' / 'publishing' / 'completed' / 'failed'
  detail: string
  started_at?: number
  updated_at?: number
}

const PLATFORM_LABEL: Record<Platform, string> = { xhs: '小红书', douyin: '抖音' }

export function PublishForm({ onClose }: Props) {
  const { conversations, activeId } = useChatStore()

  // Agentic AI 串步: AI 写完封面/平台文案后, 可以预填 publish 表单
  // 支持 { active?: 'xhs'|'douyin', xhs?: {title,description,tags}, douyin?: {...} }
  // prefill 优先级 > copyDefaults (从对话流自动找的 platform_copy)
  const prefill = consumePrefill<{
    active?: Platform
    xhs?: Partial<FormState>
    douyin?: Partial<FormState>
  }>('__form_publish__')

  // 从对话流里找最近的: 视频源 (video_player) + 封面 (cover_result) + 发布文案 (platform_copy)
  const { videoOssKey, videoUrl, coverUrl, copyDefaults } = useMemo(() => {
    const conv = conversations.find(c => c.id === activeId)
    if (!conv) return { videoOssKey: '', videoUrl: '', coverUrl: '', copyDefaults: null as PlatformCopyResult | null }
    let videoOssKey = ''
    let videoUrl = ''
    let coverUrl = ''
    let copyDefaults: PlatformCopyResult | null = null
    for (let i = conv.messages.length - 1; i >= 0; i--) {
      const msg = conv.messages[i]
      if (msg.role !== 'assistant') continue
      for (const block of msg.blocks) {
        if (block.type === 'video_player' && !videoOssKey) {
          videoOssKey = block.data.narration_oss_key || ''
          videoUrl = block.data.video_url
        }
        if (block.type === 'cover_result' && !coverUrl && block.data.covers.length > 0) {
          coverUrl = block.data.covers[0].url
        }
        if (block.type === 'platform_copy' && !copyDefaults) {
          copyDefaults = block.data
        }
      }
      if (videoOssKey && coverUrl && copyDefaults) break
    }
    return { videoOssKey, videoUrl, coverUrl, copyDefaults }
  }, [conversations, activeId])

  // 默认 form 用 prefill > platform_copy 自动填; 都没就空, 用户自己填
  const [forms, setForms] = useState<Record<Platform, FormState>>(() => ({
    xhs: {
      title:       prefill?.xhs?.title       ?? copyDefaults?.xiaohongshu?.title ?? '',
      description: prefill?.xhs?.description ?? copyDefaults?.xiaohongshu?.body  ?? '',
      tags:        prefill?.xhs?.tags        ?? (copyDefaults?.xiaohongshu?.tags || []).join(', '),
    },
    douyin: {
      title:       prefill?.douyin?.title       ?? copyDefaults?.douyin?.title       ?? '',
      description: prefill?.douyin?.description ?? copyDefaults?.douyin?.description ?? '',
      tags:        prefill?.douyin?.tags        ?? (copyDefaults?.douyin?.tags || []).join(', '),
    },
  }))

  const [activeTab, setActiveTab] = useState<Platform>(prefill?.active || 'xhs')
  const [error, setError] = useState('')
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null)
  const pollTimerRef = useRef<number | null>(null)
  const directBase = (import.meta as any).env?.VITE_DIRECT_API_URL || 'https://monoi.nat100.top'

  const updateForm = (platform: Platform, key: keyof FormState, value: string) => {
    setForms(f => ({ ...f, [platform]: { ...f[platform], [key]: value } }))
  }

  // 检测是不是桌面端 (Electron preload 注入了 window.monoiDesktop)
  const isDesktop = typeof (window as any).monoiDesktop !== 'undefined'

  const submit = async () => {
    if (!videoOssKey) {
      setError('没找到要发布的视频, 先合成或剪辑一段')
      return
    }
    const form = forms[activeTab]
    if (!form.title.trim()) {
      setError('标题不能为空')
      return
    }
    setError('')

    const tags = form.tags.split(/[,，]/).map(t => t.trim().replace(/^#/, '')).filter(Boolean)

    // ============== 桌面端: 调本地浏览器 (用户自己账号) ==============
    if (isDesktop) {
      if (!videoUrl) {
        setError('视频还没拿到签名 URL, 等几秒重试')
        return
      }
      const desktop = (window as any).monoiDesktop
      // 模拟一个 jobId 让 UI 显示"发布中"状态 (跟现有 polling 兼容)
      const fakeJobId = `desktop-${Date.now()}`
      setJobId(fakeJobId)
      setJobStatus({ status: 'publishing', detail: '启动本地浏览器, 用你自己账号发布...' })
      try {
        const res = await desktop.publish({
          platform: activeTab,
          video_url: videoUrl,
          title: form.title.trim(),
          description: form.description,
          tags,
        })
        setJobStatus({
          status: res.success ? 'completed' : 'failed',
          detail: res.detail,
        })
      } catch (e: any) {
        setJobStatus({ status: 'failed', detail: e?.message || '桌面发布失败' })
      }
      return
    }

    // ============== 网页 fallback: 走后端代发 (admin 账号) ==============
    try {
      const res = await fetch(directBase + '/api/publish/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken() || ''}` },
        body: JSON.stringify({
          platform: activeTab,
          video_oss_key: videoOssKey,
          title: form.title.trim(),
          description: form.description,
          tags,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.job_id) {
        setError(data.detail || data.error || `提交失败 (${res.status})`)
        return
      }
      setJobId(data.job_id)
      setJobStatus({ status: 'pending', detail: '任务已创建, 等待 Windows 后端处理...' })
    } catch (e: any) {
      setError(e.message || '提交失败')
    }
  }

  // 轮询 job 状态. 桌面端 jobId 以 'desktop-' 开头, 同步阻塞拿结果, 不轮询
  useEffect(() => {
    if (!jobId || jobId.startsWith('desktop-')) return
    let cancelled = false

    const poll = async () => {
      try {
        const res = await fetch(`${directBase}/api/publish/status/${jobId}`)
        if (!res.ok) {
          // 404 = job 没了 (服务重启), 跳出
          if (res.status === 404) {
            if (!cancelled) setJobStatus({ status: 'failed', detail: '后端 job 丢失 (voice-server 重启过?)' })
            return
          }
          throw new Error(`status HTTP ${res.status}`)
        }
        const data = await res.json()
        if (cancelled) return
        setJobStatus(data)
        if (data.status === 'completed' || data.status === 'failed') return
      } catch (e: any) {
        if (!cancelled) {
          // 网络抖动短暂, 继续轮询
        }
      }
      if (!cancelled) pollTimerRef.current = window.setTimeout(poll, 2500)
    }

    poll()
    return () => {
      cancelled = true
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    }
  }, [jobId, directBase])

  const isPublishing = !!jobId && jobStatus?.status !== 'completed' && jobStatus?.status !== 'failed'
  const isDone = jobStatus?.status === 'completed' || jobStatus?.status === 'failed'

  // 当前 tab 的 form
  const curForm = forms[activeTab]
  const platformLabel = PLATFORM_LABEL[activeTab]
  const creatorUrl = activeTab === 'xhs'
    ? 'https://creator.xiaohongshu.com/publish/publish?source=official'
    : 'https://creator.douyin.com/creator-micro/content/upload'

  const modal = (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative bg-[var(--bg-card)] border border-[var(--border)] rounded-[22px] shadow-ios-lg w-full max-w-3xl max-h-[92vh] flex flex-col sheet-enter overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div className="text-base font-semibold text-[var(--text)]">
            {isPublishing ? '发布中' : isDone ? '发布结果' : '发布到平台'}
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-[var(--text-2)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors">
            <X size={16}/>
          </button>
        </div>

        {/* Publishing / Done state */}
        {jobId && (
          <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
            <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-[var(--bg-hover)] border border-[var(--border)]">
              {jobStatus?.status === 'completed' ? (
                <CheckCircle2 size={20} className="text-green-500 mt-0.5 flex-shrink-0"/>
              ) : jobStatus?.status === 'failed' ? (
                <AlertCircle size={20} className="text-red-400 mt-0.5 flex-shrink-0"/>
              ) : (
                <Loader2 size={20} className="animate-spin text-[var(--text-2)] mt-0.5 flex-shrink-0"/>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[var(--text)]">
                  {jobStatus?.status === 'completed' ? `✓ ${platformLabel} 流程已完成` :
                   jobStatus?.status === 'failed' ? `✗ ${platformLabel} 发布失败` :
                   `正在发布到 ${platformLabel}...`}
                </div>
                <div className="text-xs text-[var(--text-3)] mt-1 leading-relaxed whitespace-pre-wrap break-words">
                  {jobStatus?.detail || '...'}
                </div>
              </div>
            </div>

            {isPublishing && (
              <div className="text-xs text-[var(--text-3)] leading-relaxed bg-[var(--bg-input)] rounded-lg px-3 py-2.5">
                💡 <span className="text-[var(--text-2)]">Windows 上会弹出一个浏览器窗口</span> 自动登录并上传视频. 表单
                填完后会停在'<span className="text-[var(--text-2)]">发布</span>'按钮前, 你在浏览器里审一遍稿子 →
                觉得 OK 就<span className="text-[var(--text-2)]">点'发布'按钮</span> → 关上浏览器窗口. 这里会显示完成.
                <br/>
                <a href={creatorUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--text)] hover:opacity-80 mt-2">
                  <ExternalLink size={11}/> 直接打开 {platformLabel} 创作者中心 (备用)
                </a>
              </div>
            )}
          </div>
        )}

        {/* Edit state (default) */}
        {!jobId && (
          <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
            {/* 视频源 + 封面 预览 — 手机竖排, 平板+ 横排 */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-xs text-[var(--text-3)] mb-1">视频源</div>
                {videoUrl ? (
                  <video src={videoUrl} controls className="w-full rounded-lg bg-black max-h-[28vh] object-contain"/>
                ) : (
                  <div className="px-3 py-6 text-xs text-[var(--text-3)] bg-[var(--bg-hover)] rounded-lg text-center">
                    对话里没找到视频, 先合成或剪辑一段
                  </div>
                )}
              </div>
              {coverUrl && (
                <div className="w-full sm:w-32 flex-shrink-0">
                  <div className="text-xs text-[var(--text-3)] mb-1">封面</div>
                  <img src={coverUrl} alt="cover" className="w-full max-h-[20vh] sm:max-h-none rounded-lg bg-black object-contain"/>
                </div>
              )}
            </div>

            {/* Tab 切换 */}
            <div className="flex border-b border-[var(--border)]">
              {(['xhs', 'douyin'] as Platform[]).map(p => (
                <button
                  key={p}
                  onClick={() => setActiveTab(p)}
                  className={`flex-1 py-2 text-sm cursor-pointer transition-colors ${activeTab === p ? 'text-[var(--text)] border-b-2 border-[var(--text)]' : 'text-[var(--text-3)]'}`}
                >
                  {PLATFORM_LABEL[p]}
                </button>
              ))}
            </div>

            {/* Form (当前 tab) */}
            <div className="flex flex-col gap-2">
              <label className="text-xs text-[var(--text-3)]">标题</label>
              <input
                value={curForm.title}
                onChange={(e) => updateForm(activeTab, 'title', e.target.value)}
                placeholder={activeTab === 'xhs' ? '小红书标题 (建议 15 字内)' : '抖音标题 (建议 30 字内)'}
                maxLength={activeTab === 'xhs' ? 20 : 30}
                className="bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none focus:border-[var(--text-3)]"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs text-[var(--text-3)]">描述 / 正文</label>
              <textarea
                value={curForm.description}
                onChange={(e) => updateForm(activeTab, 'description', e.target.value)}
                placeholder={activeTab === 'xhs' ? '小红书正文 (可换行, 1000 字内)' : '抖音作品简介 (1000 字内)'}
                rows={6}
                className="bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none focus:border-[var(--text-3)] resize-y font-mono leading-relaxed"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs text-[var(--text-3)]">标签 (逗号分隔, 自动加 #)</label>
              <input
                value={curForm.tags}
                onChange={(e) => updateForm(activeTab, 'tags', e.target.value)}
                placeholder="美食, 记录, vlog"
                className="bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none focus:border-[var(--text-3)]"
              />
            </div>

            {/* 说明 */}
            <div className="text-[11px] text-[var(--text-3)] leading-relaxed bg-[var(--bg-input)] rounded-lg px-3 py-2.5">
              {isDesktop ? (
                <>
                  <span className="text-green-500 font-medium">✓ 桌面端: 用你自己的账号发</span>
                  <br/>
                  点"发布到 {platformLabel}" → monoi 会启动一个浏览器窗口 → 自动上传视频 + 填表 →
                  <span className="text-[var(--text-2)]"> 停在'发布'按钮前</span> → 你审一眼 → 自己点'发布' → 关上浏览器窗口完成.
                  <br/>
                  <span className="opacity-70">首次需要在弹出的浏览器里登录你的{platformLabel}账号 (登一次, 之后记住).</span>
                </>
              ) : (
                <>
                  点"发布到 {platformLabel}"之后, Windows 会弹一个浏览器窗口, 自动上传视频 + 填好你这里的内容,
                  <span className="text-[var(--text-2)]"> 但不会自动点'发布'按钮</span>. 你在浏览器里审一眼稿子 / 改改 → 自己点'发布' → 关窗口.
                  <br/>
                  <span className="opacity-70">想用自己账号发? 装 monoi 桌面端 (设置 → 下载桌面版).</span>
                </>
              )}
            </div>

            {error && (
              <div className="text-xs text-red-400 bg-red-950/20 border border-red-900/30 rounded-lg px-3 py-2">{error}</div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--border)]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-[var(--text-2)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors cursor-pointer"
          >
            {isPublishing ? '关闭 (不影响后台任务)' : '关闭'}
          </button>
          {!jobId && (
            <button
              onClick={submit}
              disabled={!videoOssKey || !curForm.title.trim()}
              className={`px-4 py-2 text-sm rounded-lg transition-all inline-flex items-center gap-2 ${
                !videoOssKey || !curForm.title.trim()
                  ? 'bg-[var(--bg-hover)] text-[var(--text-3)] cursor-not-allowed'
                  : 'bg-[var(--text)] text-[var(--bg)] hover:opacity-80 cursor-pointer'
              }`}
            >
              <Send size={14}/> 发布到 {platformLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}
