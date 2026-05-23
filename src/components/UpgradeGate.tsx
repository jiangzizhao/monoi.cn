// 通用"升级 Pro/Max 才能用"门槛 modal — 多个 Form 共用.
// 用法:
//   const [tierBlocked, setTierBlocked] = useState(false)
//   useEffect(() => { fetchMyCredits().then(c => setTierBlocked(c.tier === 'free')) }, [])
//   if (tierBlocked) return <UpgradeGate featureName="人物抠图" onClose={onClose}/>

import { useNavigate } from 'react-router-dom'
import { Lock, X } from 'lucide-react'
import { createPortal } from 'react-dom'

interface Props {
  featureName: string                  // 显示给用户的功能名, 如 "人物抠图"
  minTier?: string                      // 默认 'Pro', 可指定 'Max'
  onClose: () => void                   // 关闭这个 modal — 一般直接关掉外层 Form
  freeAlternative?: string              // 可选: 告诉用户免费的替代方案, 比如"想免费? 用 XXX"
}

export function UpgradeGate({ featureName, minTier = 'Pro', onClose, freeAlternative }: Props) {
  const nav = useNavigate()
  const modal = (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="relative bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-ios-lg w-full max-w-sm p-6 flex flex-col gap-4">
        <button onClick={onClose} className="absolute top-4 right-4 p-1 rounded text-[var(--text-3)] hover:bg-[var(--bg-hover)] cursor-pointer"><X size={14}/></button>
        <div className="flex items-center gap-2">
          <Lock size={18} className="text-amber-500"/>
          <div className="text-base font-semibold">{featureName} 是付费功能</div>
        </div>
        <p className="text-sm text-[var(--text-2)] leading-relaxed">
          这个功能需要升级到 <b>{minTier}</b> 或更高套餐.
        </p>
        {freeAlternative && (
          <div className="text-xs text-[var(--text-3)] bg-[var(--bg-hover)] rounded-lg p-3 leading-relaxed">{freeAlternative}</div>
        )}
        <div className="flex gap-2">
          <button onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-[var(--border)] text-[var(--text-2)] text-sm hover:bg-[var(--bg-hover)] cursor-pointer">
            先不升级
          </button>
          <button onClick={() => { onClose(); nav('/app/account#membership') }}
            className="flex-1 py-2 rounded-lg bg-[var(--text)] text-[var(--bg)] text-sm hover:opacity-80 cursor-pointer">
            去升级
          </button>
        </div>
      </div>
    </div>
  )
  return createPortal(modal, document.body)
}
