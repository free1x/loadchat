const TOKEN_KEY = 'loadchat:token'
const ADMIN_TOKEN_KEY = 'loadchat:admin-token'
let deviceToken = ''

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || ''
}

export function setToken(token: string) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

export function setDeviceToken(token: string) {
  deviceToken = token
}

export function getAdminToken() {
  return sessionStorage.getItem(ADMIN_TOKEN_KEY) || ''
}

export function setAdminToken(token: string) {
  if (token) sessionStorage.setItem(ADMIN_TOKEN_KEY, token)
  else sessionStorage.removeItem(ADMIN_TOKEN_KEY)
}

export function getDeviceToken() {
  return deviceToken
}

export async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const adminToken = getAdminToken()
  if (adminToken) headers.set('X-Admin-Token', adminToken)
  if (deviceToken) headers.set('X-Device-Token', deviceToken)
  if (init.body && !(init.body instanceof Blob) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const response = await fetch(url, { ...init, headers })
  if (!response.ok) {
    let message = `请求失败 (${response.status})`
    try { message = (await response.json()).error || message } catch { /* not JSON */ }
    throw new Error(message)
  }
  return response.json() as Promise<T>
}

export function downloadUrl(fileId: string, deviceId: string) {
  const token = getToken()
  const query = new URLSearchParams({ deviceId })
  if (token) query.set('token', token)
  if (deviceToken) query.set('deviceToken', deviceToken)
  return `/api/files/${encodeURIComponent(fileId)}/download?${query.toString()}`
}

export function downloadZipUrl(fileIds: string[], deviceId: string) {
  const query = new URLSearchParams({ ids: fileIds.slice(0, 30).join(','), deviceId })
  const token = getToken(); if (token) query.set('token', token)
  if (deviceToken) query.set('deviceToken', deviceToken)
  return `/api/files/download-zip?${query.toString()}`
}
