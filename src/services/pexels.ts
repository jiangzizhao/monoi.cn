import type { VideoAsset } from '../types'

export async function searchPexels(query: string, perPage = 6): Promise<VideoAsset[]> {
  const res = await fetch(`/api/pexels?query=${encodeURIComponent(query)}&per_page=${perPage}`)
  if (!res.ok) return []
  const data = await res.json()
  return (data.videos || []).map((v: any) => ({
    id: v.id,
    thumbnail: v.image,
    preview_url: v.video_files?.find((f: any) => f.quality === 'sd')?.link,
    source_url: v.url,
    source: 'pexels' as const,
    duration: v.duration,
  }))
}
