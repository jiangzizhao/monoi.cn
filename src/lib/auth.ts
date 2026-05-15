async function proxyRequest(path: string, body: object) {
  const res = await fetch(`/api/proxy?path=${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || data.error || '请求失败')
  return data
}

export async function register(
  username: string, email: string, password: string,
  phone: string, sms_code: string, referral_code?: string,
) {
  return proxyRequest('/api/register', { username, email, password, phone, sms_code, referral_code })
}

export async function sendSmsCode(
  phone: string,
  purpose: 'register' | 'reset_password' | 'rebind_phone' | 'login',
  captchaVerifyParam?: string,
) {
  return proxyRequest('/api/send-sms', { phone, purpose, captcha_verify_param: captchaVerifyParam || null })
}

export async function login(email: string, password: string) {
  const data = await proxyRequest('/api/login', { email, password })
  localStorage.setItem('monoi_token', data.token)
  localStorage.setItem('monoi_username', data.username)
  return data
}

export async function loginSms(phone: string, sms_code: string) {
  const data = await proxyRequest('/api/login-sms', { phone, sms_code })
  localStorage.setItem('monoi_token', data.token)
  localStorage.setItem('monoi_username', data.username)
  return data
}

export function logout() {
  localStorage.removeItem('monoi_token')
  localStorage.removeItem('monoi_username')
  // 不主动清 vm-chat-store-{user_id} 的 localStorage 数据 — 留着这个用户下次登回来恢复
  // 但是要 force 整页 reload, 否则 zustand 内存里还有上一个用户的 conversations
  window.location.href = '/login'
}

export function getToken() {
  return localStorage.getItem('monoi_token')
}

export function getUsername() {
  return localStorage.getItem('monoi_username')
}

export function isLoggedIn() {
  return !!localStorage.getItem('monoi_token')
}
