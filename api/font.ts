// Vercel Edge Function 代理 GitHub 字体 (国内 ISP 屏了 raw.githubusercontent/jsdelivr/ghproxy
// 但 Vercel domain 在国内 CDN 通畅). Edge runtime 流式响应不受 Hobby 4.5MB 限制.

export const config = { runtime: 'edge' }

const FONT_PATHS: Record<string, string> = {
  'SourceHanSansCN-Heavy.otf':  'assets/font/中文/思源字体系列/思源黑体/SourceHanSansCN-Heavy.otf',
  'zcool-xiaowei-logo.otf':     'assets/font/中文/站酷字体系列/站酷小薇LOGO体.otf',
  'zcool-qingke-huangyou.ttf':  'assets/font/中文/站酷字体系列/站酷庆科黄油体.ttf',
  'zcool-kuaile.ttf':           'assets/font/中文/站酷字体系列/站酷快乐体.ttf',
  'shetu-modern-xiaofang.ttf':  'assets/font/中文/其他字体/摄图摩登小方体.ttf',
  'baotu-xiaobai.ttf':          'assets/font/中文/其他字体/包图小白体.ttf',
  'jiangxi-zhuokai.ttf':        'assets/font/中文/其他字体/江西拙楷.ttf',
  'youshe-biaoti-hei.ttf':      'assets/font/中文/其他字体/优设标题黑.ttf',
  'zhuangjia-mincho.ttf':       'assets/font/日文/装甲明朝体.ttf',
  'marker-shouhui.ttf':         'assets/font/日文/麦克笔手绘体.ttf',
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const name = url.searchParams.get('name') || ''
  const path = FONT_PATHS[name]
  if (!path) return new Response('font not found', { status: 404 })

  const upstream = `https://raw.githubusercontent.com/wordshub/free-font/master/${encodeURI(path)}`
  const resp = await fetch(upstream)
  if (!resp.ok) return new Response(`upstream ${resp.status}`, { status: resp.status })

  const ext = name.toLowerCase().endsWith('.otf') ? 'font/otf' : 'font/ttf'
  return new Response(resp.body, {
    status: 200,
    headers: {
      'Content-Type': ext,
      'Content-Length': resp.headers.get('content-length') || '',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
