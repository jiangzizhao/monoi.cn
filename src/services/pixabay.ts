import type { VideoAsset } from '../types'
import { getToken } from '../lib/auth'

export async function searchPixabay(query: string, perPage = 6): Promise<VideoAsset[]> {
  const token = getToken()
  const res = await fetch(`/api/pixabay?query=${encodeURIComponent(query)}&per_page=${perPage}`, {
    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
  })
  if (!res.ok) return []
  const data = await res.json()
  return (data.hits || []).map((v: any) => ({
    id: v.id,
    thumbnail: v.videos?.medium?.thumbnail || v.previewURL,
    // 优先 large (~1920) → medium (~1280) → small (~960), 拿最高清晰度
    preview_url: v.videos?.large?.url || v.videos?.medium?.url || v.videos?.small?.url,
    source_url: `https://pixabay.com/videos/${v.id}`,
    source: 'pixabay' as const,
    duration: v.duration,
  }))
}
