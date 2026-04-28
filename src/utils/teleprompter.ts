export function formatTeleprompter(text: string, maxChars = 15): string {
  if (!text.trim()) return ''
  const lines: string[] = []
  const sentences = text.split(/(?<=[。！？…\n])/)
  for (const sentence of sentences) {
    const s = sentence.trim()
    if (!s) { lines.push(''); continue }
    let i = 0
    while (i < s.length) {
      lines.push(s.slice(i, i + maxChars))
      i += maxChars
    }
    lines.push('')
  }
  return lines.join('\n')
}
