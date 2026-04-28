import type { VideoAsset } from '../types'

export async function searchPixabay(query: string, perPage = 6): Promise<VideoAsset[]> {
  const res = await fetch(`/api/pixabay?query=${encodeURIComponent(query)}&per_page=${perPage}`)
  if (!res.ok) return []
  const data = await res.json()
  return (data.hits || []).map((v: any) => ({
    id: v.id,
    thumbnail: v.videos?.medium?.thumbnail || v.previewURL,
    preview_url: v.videos?.small?.url,
    source_url: `https://pixabay.com/videos/${v.id}`,
    source: 'pixabay' as const,
    duration: v.duration,
  }))
}
