import { useEffect, useRef, useState } from 'react'
import { X, Loader2, CheckCircle2, XCircle, RefreshCw } from 'lucide-react'
import { QRCodeCanvas } from 'qrcode.react'
import { createOrder, queryOrder, type CreateOrderResp } from '../services/pay'

// 品牌 SVG (Simple Icons), 用 currentColor 跟着外层 className text-color 走
function WeChatIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.047c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.582.582 0 0 1-.023-.156.49.49 0 0 1 .201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89c-.135-.01-.27-.027-.407-.032zm-2.53 3.21c.532 0 .96.448.96.992v.002c0 .544-.428.988-.96.988a.997.997 0 0 1-.96-.988.997.997 0 0 1 .96-.994zm4.844 0c.532 0 .96.448.96.992v.002c0 .544-.428.988-.96.988a.997.997 0 0 1-.96-.988.997.997 0 0 1 .96-.994z"/>
    </svg>
  )
}

function AlipayIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.84 17.012s-3.97-1.227-6.005-1.872c1.225-2.127 2.193-4.69 2.83-7.487h-5.788V5.572h7.083V4.477h-7.083V.992h-2.889c-.508 0-.508.502-.508.502v2.983H3.314v1.095h7.166v1.98H4.557v1.097h11.61c-.51 1.84-1.196 3.535-2.014 5.064-4.564-1.51-9.434-2.682-12.493-1.965C-.405 12.247-.96 13.788.55 15.59c1.412 1.69 4.62 2.722 6.93 2.722 3.864 0 6.83-1.508 9.119-3.916 3.435 1.66 10.464 4.598 10.464 4.598V4.834C27.063 1.794 23.794 0 19.78 0H4.22C1.93 0 0 1.927 0 4.221v15.558C0 22.073 1.93 24 4.22 24h15.56C23.792 24 24 22.073 24 19.78v-4.85c-.336.124-.7.234-1.16.082z"/>
    </svg>
  )
}

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
                  className={`flex flex-col items-center justify-center gap-1.5 py-3.5 rounded-xl border-2 cursor-pointer transition-all ${channel === 'wechat' ? 'border-[#07C160] bg-[#07C160]/10' : 'border-[var(--border)] hover:border-[var(--text-3)]'}`}>
                  <span className="text-[#07C160]"><WeChatIcon size={26}/></span>
                  <span className="text-xs font-medium">微信支付</span>
                </button>
                <button disabled
                  className="flex flex-col items-center justify-center gap-1.5 py-3.5 rounded-xl border-2 border-[var(--border)] opacity-50 cursor-not-allowed"
                  title="支付宝商户审核中">
                  <span className="text-[#1677FF]"><AlipayIcon size={26}/></span>
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
                <span className="text-[#07C160]"><WeChatIcon size={16}/></span>
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
