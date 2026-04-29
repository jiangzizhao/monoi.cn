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

export async function register(username: string, email: string, password: string) {
  return proxyRequest('/api/register', { username, email, password })
}

export async function login(email: string, password: string) {
  const data = await proxyRequest('/api/login', { email, password })
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
