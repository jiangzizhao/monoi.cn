const API = import.meta.env.VITE_API_URL || ''

export async function register(username: string, email: string, password: string) {
  const res = await fetch(`${API}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email, password }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || '注册失败')
  return data
}

export async function login(email: string, password: string) {
  const res = await fetch(`${API}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || '登录失败')
  localStorage.setItem('monoi_token', data.token)
  localStorage.setItem('monoi_username', data.username)
  return data
}

export function logout() {
  localStorage.removeItem('monoi_token')
  localStorage.removeItem('monoi_username')
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
