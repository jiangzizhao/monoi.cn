// formPrefill — Agentic AI 自动打开弹窗时 prefill 字段的读写工具.
// ChatInput 收到带 prefill 的 monoi:open-form 事件 → sessionStorage.setItem('monoi:prefill:__form_xxx__', JSON.stringify(...))
// 各 Form 组件 mount 时调 consumePrefill('__form_xxx__') 一次性取走 + 删除 (避免下次再打开误用旧值).
//
// 没 prefill 返回 null, 不影响现有手动打开流程.

export function consumePrefill<T = Record<string, unknown>>(formId: string): T | null {
  if (typeof window === 'undefined') return null
  const key = `monoi:prefill:${formId}`
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    sessionStorage.removeItem(key)
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/** 写 prefill — 通常由 ChatInput 的 monoi:open-form 监听器调, 自动跑.
 * 暴露 setPrefill 是为了将来 multi-step pipeline 时, 上一步完成后手动 prefill 下一步. */
export function setPrefill(formId: string, values: Record<string, unknown>): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(`monoi:prefill:${formId}`, JSON.stringify(values))
  } catch { /* quota 满了就算了 */ }
}
