import { useEffect, useRef, useState } from 'react'
import { X, Loader2, CheckCircle2, XCircle, RefreshCw } from 'lucide-react'
import { QRCodeCanvas } from 'qrcode.react'
import { createOrder, queryOrder, type CreateOrderResp } from '../services/pay'

type Step = 'select' | 'qr' | 'success' | 'failure'
type Channel = 'wechat' | 'alipay'

interface Props {
  open: boolean
  planId: string                  // 'pro_monthly' / 'max_monthly' / 'flagship_yearly'
  planName: string                // 显示名 'Pro 月卡'
  amountYuan: number              // 显示金额
  periodLabel: string             // '/月' 或 '/年'
  highlights: string[]            // 该套餐权益列表 (4-5 条)
  onClose: () => void
  onPaid?: () => void             // 支付成功后通知外面刷新会员状态
}

export function PaymentDialog({ open, planId, planName, amountYuan, periodLabel, highlights, onClose, onPaid }: Props) {
  const [step, setStep] = useState<Step>('select')
  const [channel, setChannel] = useState<Channel>('wechat')
  const [agreed, setAgreed] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [order, setOrder] = useState<CreateOrderResp | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const pollTimerRef = useRef<number | null>(null)
  const countdownTimerRef = useRef<number | null>(null)
  const closeTimerRef = useRef<number | null>(null)

  // 检测移动端 — 二维码扫不到自己, 提示用户用电脑
  const isMobile = typeof window !== 'undefined' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)

  // 打开/关闭时重置
  useEffect(() => {
    if (open) {
      setStep('select')
      setChannel('wechat')
      setAgreed(false)
      setError('')
      setOrder(null)
    } else {
      clearTimers()
    }
    return clearTimers
  }, [open])

  function clearTimers() {
    if (pollTimerRef.current) { window.clearInterval(pollTimerRef.current); pollTimerRef.current = null }
    if (countdownTimerRef.current) { window.clearInterval(countdownTimerRef.current); countdownTimerRef.current = null }
    if (closeTimerRef.current) { window.clearTimeout(closeTimerRef.current); closeTimerRef.current = null }
  }

  const handleConfirm = async () => {
    if (!agreed) { setError('请先同意会员服务协议'); return }
    if (channel === 'alipay') { setError('支付宝商户审核中, 请先用微信支付'); return }
    setCreating(true)
    setError('')
    try {
      const o = await createOrder(planId, channel)
      setOrder(o)
      setStep('qr')
      // 启动倒计时 + 轮询
      const tickCountdown = () => setSecondsLeft(Math.max(0, Math.ceil(o.expires_at - Date.now() / 1000)))
      tickCountdown()
      countdownTimerRef.current = window.setInterval(tickCountdown, 1000)
      pollTimerRef.current = window.setInterval(() => poll(o.order_id), 2000)
    } catch (e: any) {
      setError(e.message || '下单失败')
    } finally {
      setCreating(false)
    }
  }

  const poll = async (orderId: string) => {
    try {
      const r = await queryOrder(orderId)
      if (r.status === 'paid') {
        clearTimers()
        setStep('success')
        onPaid?.()
        closeTimerRef.current = window.setTimeout(() => { onClose() }, 3000)
      } else if (r.status === 'expired') {
        clearTimers()
        setStep('failure')
      }
    } catch (e) {
      console.warn('[pay] poll err:', e)
    }
  }

  const handleRetry = () => {
    setStep('select')
    setOrder(null)
    setError('')
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="relative bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-ios-lg w-full max-w-md p-6 flex flex-col gap-4">
        <button onClick={onClose} className="absolute top-4 right-4 p-1 rounded text-[var(--text-3)] hover:bg-[var(--bg-hover)] cursor-pointer"><X size={14}/></button>

        {/* 移动端: 不显示支付流程, 提示去电脑 */}
        {isMobile && step !== 'success' ? (
          <div className="flex flex-col gap-3 items-center text-center py-4">
            <div className="text-base font-semibold">请用电脑访问</div>
            <p className="text-sm text-[var(--text-2)]">微信扫码支付需要用电脑打开, 因为手机本身就在用微信, 没法扫自己的二维码.</p>
            <p className="text-xs text-[var(--text-3)]">手机打开 monoi.cn → 账户中心 → 会员中心 (V2 上线 H5 支付后支持手机直付).</p>
          </div>
        ) : step === 'select' ? (
          <>
            <div>
              <div className="text-base font-semibold">开通 {planName}</div>
              <div className="text-xs text-[var(--text-3)] mt-0.5">¥{amountYuan}{periodLabel} · 即时开通</div>
            </div>
            <div className="border-t border-[var(--border)] pt-3">
              <div className="text-xs text-[var(--text-3)] mb-2">订单详情</div>
              <ul className="text-sm text-[var(--text-2)] space-y-1">
                {highlights.map((h, i) => <li key={i} className="flex gap-1.5"><span className="text-[var(--text-3)]">·</span>{h}</li>)}
              </ul>
            </div>
            <div className="border-t border-[var(--border)] pt-3">
              <div className="text-xs text-[var(--text-3)] mb-2">选择支付方式</div>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setChannel('wechat')}
                  className={`flex flex-col items-center justify-center gap-1 py-3 rounded-xl border-2 cursor-pointer transition-all ${channel === 'wechat' ? 'border-[#07C160] bg-[#07C160]/10' : 'border-[var(--border)] hover:border-[var(--text-3)]'}`}>
                  <span className="text-base">🟢</span>
                  <span className="text-xs font-medium">微信支付</span>
                </button>
                <button disabled
                  className="flex flex-col items-center justify-center gap-1 py-3 rounded-xl border-2 border-[var(--border)] opacity-50 cursor-not-allowed"
                  title="支付宝商户审核中">
                  <span className="text-base">🔵</span>
                  <span className="text-xs font-medium">支付宝</span>
                  <span className="text-[10px] text-[var(--text-3)]">审核中</span>
                </button>
              </div>
            </div>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="mt-0.5 accent-current cursor-pointer"/>
              <span className="text-xs text-[var(--text-2)]">我已阅读并同意 <a href="/terms" target="_blank" className="text-[var(--text)] underline">《会员服务协议》</a></span>
            </label>
            {error && <p className="text-xs text-red-400">{error}</p>}
            <button onClick={handleConfirm} disabled={creating || !agreed}
              className="py-2.5 rounded-xl bg-[var(--text)] text-[var(--bg)] text-sm font-medium hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-all">
              {creating ? <Loader2 size={14} className="animate-spin inline mr-1"/> : null}
              {creating ? '生成订单中...' : `确认支付 ¥${amountYuan}`}
            </button>
          </>
        ) : step === 'qr' && order ? (
          <>
            <div>
              <div className="text-base font-semibold">开通 {planName} · ¥{amountYuan}</div>
            </div>
            <div className="flex flex-col items-center gap-2 py-2">
              <div className="bg-white p-3 rounded-xl">
                {order.code_url.startsWith('MOCK_QR') ? (
                  <div className="w-[200px] h-[200px] flex flex-col items-center justify-center text-xs text-gray-500 bg-gray-100 rounded">
                    <span className="font-semibold">[Mock 二维码]</span>
                    <span className="mt-1">{order.code_url}</span>
                    <span className="mt-2 text-[10px]">15 秒后自动支付</span>
                  </div>
                ) : (
                  <QRCodeCanvas value={order.code_url} size={200} level="M"/>
                )}
              </div>
              <div className="text-sm text-[var(--text)] flex items-center gap-1.5">
                <span className="text-[#07C160]">●</span>
                微信扫码支付
              </div>
              <div className="text-xs text-[var(--text-3)]">
                订单 {Math.floor(secondsLeft / 60)} 分 {String(secondsLeft % 60).padStart(2, '0')} 秒后自动取消
              </div>
            </div>
            <div className="border-t border-[var(--border)] pt-3 flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-[var(--text-2)]">
                <Loader2 size={12} className="animate-spin"/> 等待支付...
              </span>
              <div className="flex gap-2">
                <button onClick={() => order && poll(order.order_id)}
                  className="flex items-center gap-1 text-[var(--text-2)] hover:text-[var(--text)] cursor-pointer">
                  <RefreshCw size={11}/>刷新
                </button>
                <button onClick={handleRetry} className="text-[var(--text-2)] hover:text-[var(--text)] cursor-pointer">换支付方式</button>
              </div>
            </div>
          </>
        ) : step === 'success' ? (
          <div className="flex flex-col items-center text-center py-4 gap-3">
            <CheckCircle2 size={48} className="text-green-500"/>
            <div className="text-lg font-semibold">已开通 {planName}</div>
            <div className="text-xs text-[var(--text-3)]">3 秒后自动关闭...</div>
          </div>
        ) : step === 'failure' ? (
          <div className="flex flex-col items-center text-center py-4 gap-3">
            <XCircle size={48} className="text-red-400"/>
            <div className="text-lg font-semibold">订单已超时, 未付款</div>
            <div className="text-xs text-[var(--text-3)]">钱款未扣, 可以重新发起</div>
            <button onClick={handleRetry}
              className="mt-2 px-4 py-2 rounded-xl bg-[var(--text)] text-[var(--bg)] text-sm hover:opacity-80 cursor-pointer">
              重新支付
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
