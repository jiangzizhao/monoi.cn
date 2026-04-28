import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { Check, X, Info } from 'lucide-react'

interface T { id: number; msg: string; type: 'success'|'error'|'info' }
const Ctx = createContext<{ toast:(m:string,t?:T['type'])=>void }>({ toast:()=>{} })
export const useToast = () => useContext(Ctx)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<T[]>([])
  const id = useRef(0)
  const toast = useCallback((msg: string, type: T['type'] = 'success') => {
    const n = ++id.current
    setToasts(p => [...p, { id: n, msg, type }])
    setTimeout(() => setToasts(p => p.filter(t => t.id !== n)), 2200)
  }, [])
  const Icon = { success: Check, error: X, info: Info }
  const style = { success:'border-green-800/50 text-green-400', error:'border-red-800/50 text-red-400', info:'border-indigo-800/50 text-indigo-400' }
  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => {
          const I = Icon[t.type]
          return <div key={t.id} className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-[var(--bg-card)] border text-sm ${style[t.type]}`}><I size={14} strokeWidth={2.5}/>{t.msg}</div>
        })}
      </div>
    </Ctx.Provider>
  )
}
