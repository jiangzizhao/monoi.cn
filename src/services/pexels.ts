import type { VideoAsset } from '../types'
import { getToken } from '../lib/auth'

// 从 video_files 选最佳 mp4: 优先 hd, 然后挑宽度最接近 1920 但不超过的, 最后退回 sd
// 目标: 拿原素材最高清晰度版本, 避免合成时升采样模糊
function pickBestVideoFile(files: any[] | undefined): string | undefined {
  if (!files || files.length === 0) return undefined
  // 只看 mp4 类型
  const mp4s = files.filter(f => (f.file_type || '').includes('mp4') || /\.mp4(\?|$)/i.test(f.link || ''))
  if (mp4s.length === 0) return undefined
  // 按 width 排序, 先取 ≤1920 里最大的; 没有就取最小的 (兜底)
  const fits = mp4s.filter(f => (f.width || 0) <= 1920 && (f.width || 0) > 0).sort((a, b) => (b.width || 0) - (a.width || 0))
  if (fits.length > 0) return fits[0].link
  return mp4s.sort((a, b) => (a.width || 0) - (b.width || 0))[0].link
}

export async function searchPexels(query: string, perPage = 6): Promise<VideoAsset[]> {
  const token = getToken()
  const res = await fetch(`/api/pexels?query=${encodeURIComponent(query)}&per_page=${perPage}`, {
    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
  })
  if (!res.ok) return []
  const data = await res.json()
  return (data.videos || []).map((v: any) => ({
    id: v.id,
    thumbnail: v.image,
    preview_url: pickBestVideoFile(v.video_files),
    source_url: v.url,
    source: 'pexels' as const,
    duration: v.duration,
  }))
}
