// monoi logo — 自动跟系统主题切换 light / dark 版.
//
// 浅色背景 (默认): logo.png (黑方块 + 白 M) — 黑色撑出形状
// 深色背景: logo-dark.png (白方块 + 黑 M, 自动反色版) — 白色撑出形状
//
// 用 <picture> + media query, 浏览器原生切换. 不需要 JS / React state 监听主题.

interface Props {
  className?: string
  alt?: string
}

export function Logo({ className = '', alt = 'monoi' }: Props) {
  return (
    <picture>
      <source srcSet="/logo-dark.png" media="(prefers-color-scheme: dark)"/>
      <img src="/logo.png" alt={alt} className={className}/>
    </picture>
  )
}
