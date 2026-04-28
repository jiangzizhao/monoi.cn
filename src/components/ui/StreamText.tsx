import { useEffect, useRef } from 'react'

interface StreamTextProps {
  text: string
  className?: string
  streaming?: boolean
}

export function StreamText({ text, className = '', streaming = false }: StreamTextProps) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (streaming) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [text, streaming])

  return (
    <div className={['whitespace-pre-wrap text-sm leading-relaxed', className].join(' ')}>
      {text}
      {streaming && (
        <span className="inline-block w-0.5 h-4 bg-blue-400 animate-pulse ml-0.5 align-text-bottom" />
      )}
      <div ref={endRef} />
    </div>
  )
}
