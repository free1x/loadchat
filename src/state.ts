import { computed, reactive } from 'vue'
import { io, type Socket } from 'socket.io-client'
import { api, getToken, setDeviceToken, setToken } from './api'
import { decryptText, encryptText, ensureCryptoIdentity, isE2eeRoom } from './e2ee'
import type { AppNotice, Bootstrap, ChatMessage, Device, FileInfo, Room, ServerStatus, TransferItem } from './types'
import { createUuid } from './utils'

const ID_KEY = 'loadchat:device-id'
const PROFILE_KEY = 'loadchat:profile'
const DEVICE_KEY = 'loadchat:device-key'
const savedId = localStorage.getItem(ID_KEY) || createUuid()
localStorage.setItem(ID_KEY, savedId)
const savedDeviceKey = localStorage.getItem(DEVICE_KEY) || `${createUuid()}${createUuid()}`
localStorage.setItem(DEVICE_KEY, savedDeviceKey)
let savedProfile: { nickname?: string; avatar?: string } = {}
try { savedProfile = JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}') } catch { /* ignore */ }

function detectDevice() {
  const mobile = /Android|iPhone|iPad/i.test(navigator.userAgent)
  const platform = navigator.userAgent.match(/Windows|Macintosh|Android|iPhone|iPad|Linux/i)?.[0] || '浏览器'
  return `${mobile ? '移动设备' : '电脑'} · ${platform}`
}

export const identity = reactive({
  id: savedId,
  deviceKey: savedDeviceKey,
  nickname: savedProfile.nickname || `访客-${savedId.slice(0, 4)}`,
  avatar: savedProfile.avatar || '',
  deviceName: detectDevice()
})

export const state = reactive({
  ready: false,
  loading: true,
  authenticated: false,
  authError: '',
  connected: false,
  connectionState: 'connecting' as 'connecting' | 'online' | 'offline',
  pendingApproval: false,
  currentPage: 'home',
  bootstrap: null as Bootstrap | null,
  devices: [] as Device[],
  rooms: [] as Room[],
  messages: {} as Record<string, ChatMessage[]>,
  files: [] as FileInfo[],
  transfers: {} as Record<string, TransferItem>,
  unread: {} as Record<string, number>,
  readReceipts: {} as Record<string, Record<string, number>>,
  activeRoomId: 'lobby',
  typing: {} as Record<string, string>,
  status: null as ServerStatus | null,
  notices: [] as AppNotice[],
  error: ''
})

let socket: Socket | null = null
const loadingRooms = new Set<string>()

export const onlinePeers = computed(() => state.devices.filter((item) => item.id !== identity.id))

export function dmRoomId(otherId: string) {
  return `dm:${[identity.id, otherId].sort().join(':')}`
}

export function saveProfile() {
  localStorage.setItem(PROFILE_KEY, JSON.stringify({ nickname: identity.nickname, avatar: identity.avatar }))
  void ensureCryptoIdentity().then(({ publicKey }) => socket?.emit('device:register', { ...identity, encryptionPublicKey: publicKey }))
}

export async function bootstrap() {
  state.loading = true
  try {
    state.bootstrap = await api<Bootstrap>('/api/bootstrap')
    state.authenticated = !state.bootstrap.authRequired || Boolean(getToken())
    if (state.authenticated) await startSession()
  } catch (error) {
    state.error = error instanceof Error ? error.message : '无法连接到服务器'
  } finally {
    state.loading = false
    state.ready = true
  }
}

export async function login(password: string) {
  state.authError = ''
  try {
    const result = await api<{ token: string }>('/api/auth', { method: 'POST', body: JSON.stringify({ password }) })
    setToken(result.token)
    state.authenticated = true
    await startSession()
  } catch (error) {
    state.authError = error instanceof Error ? error.message : '验证失败'
    throw error
  }
}

export async function startSession() {
  try {
    await connectSocket()
    if (state.pendingApproval) return
    await Promise.all([loadRooms(), loadFiles(), loadStatus()])
    await loadMessages(state.activeRoomId)
  } catch (error: any) {
    if (String(error?.message).includes('访问密码')) {
      setToken(''); state.authenticated = false
    } else state.error = error?.message || '初始化失败'
  }
}

async function connectSocket() {
  socket?.disconnect()
  state.connectionState = 'connecting'
  const { publicKey: encryptionPublicKey } = await ensureCryptoIdentity()
  socket = io({ auth: { token: getToken() }, transports: ['websocket', 'polling'] })
  const registered = new Promise<void>((resolve, reject) => {
    let settled = false
    socket?.on('connect', () => {
      socket?.emit('device:register', { ...identity, encryptionPublicKey }, (result: any) => {
        if (result?.error) {
          state.connected = false; state.connectionState = 'offline'
          if (!settled) { settled = true; reject(new Error(result.error)) }
          return
        }
        if (result?.pending) {
          state.pendingApproval = true
          state.connected = true; state.connectionState = 'online'
          if (!settled) { settled = true; resolve() }
          return
        }
        state.pendingApproval = false
        setDeviceToken(String(result?.deviceToken || ''))
        state.connected = true
        state.connectionState = 'online'
        if (!settled) { settled = true; resolve() }
      })
    })
  })
  socket.on('disconnect', () => { state.connected = false; state.connectionState = socket?.active ? 'connecting' : 'offline' })
  socket.on('connect_error', (error) => { state.connected = false; state.connectionState = socket?.active ? 'connecting' : 'offline'; state.error = error.message })
  socket.io.on('reconnect_attempt', () => { state.connectionState = 'connecting' })
  socket.io.on('reconnect_failed', () => { state.connectionState = 'offline' })
  socket.on('devices:update', (devices: Device[]) => { state.devices = devices })
  socket.on('room:new', (room: Room) => {
    if (!state.rooms.some((item) => item.id === room.id)) state.rooms.push(room)
  })
  socket.on('room:updated', (room: Room) => {
    const index = state.rooms.findIndex((item) => item.id === room.id)
    if (index >= 0) state.rooms[index] = room; else state.rooms.push(room)
  })
  socket.on('room:removed', (roomId: string) => {
    state.rooms = state.rooms.filter((room) => room.id !== roomId)
    state.files = state.files.filter((file) => file.roomId !== roomId || file.senderId === identity.id)
    state.notices = state.notices.filter((notice) => notice.roomId !== roomId)
    delete state.messages[roomId]
    delete state.unread[roomId]
    delete state.typing[roomId]
    delete state.readReceipts[roomId]
    if (state.activeRoomId === roomId) state.activeRoomId = 'lobby'
    updateDocumentTitle()
  })
  socket.on('message:new', (message: ChatMessage) => { void handleIncomingMessage(message) })
  async function handleIncomingMessage(message: ChatMessage) {
    message = await decodeMessage(message)
    const list = state.messages[message.roomId] ||= []
    if (!list.some((item) => item.id === message.id)) list.push(message)
    const needsAttention = message.senderId !== identity.id && (message.roomId !== state.activeRoomId || state.currentPage !== 'chat' || document.hidden)
    if (needsAttention) {
      state.unread[message.roomId] = (state.unread[message.roomId] || 0) + 1
      pushMessageNotice(message)
      updateDocumentTitle()
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        new Notification(message.senderName, { body: message.type === 'file' ? `发送了文件：${message.content}` : message.content, icon: '/icon.svg' })
      }
    }
    if (message.file && !state.files.some((file) => file.id === message.file?.id)) state.files.unshift(message.file)
  }
  socket.on('file:complete', (file: FileInfo) => {
    const index = state.files.findIndex((item) => item.id === file.id)
    if (index >= 0) state.files[index] = file; else state.files.unshift(file)
  })
  socket.on('file:deleted', (id: string) => { state.files = state.files.filter((file) => file.id !== id) })
  socket.on('message:deleted', (payload: { roomId: string; messageId: string; deletedAt: number }) => {
    const message = state.messages[payload.roomId]?.find((item) => item.id === payload.messageId)
    if (message) { message.content = '消息已撤回'; message.deletedAt = payload.deletedAt }
  })
  socket.on('message:reaction', (payload: { roomId: string; messageId: string; emoji: string; deviceId: string; active: boolean }) => {
    const message = state.messages[payload.roomId]?.find((item) => item.id === payload.messageId)
    if (!message) return
    const reactions = message.reactions ||= {}
    const devices = reactions[payload.emoji] ||= []
    if (payload.active && !devices.includes(payload.deviceId)) devices.push(payload.deviceId)
    if (!payload.active) reactions[payload.emoji] = devices.filter((id) => id !== payload.deviceId)
    if (!reactions[payload.emoji].length) delete reactions[payload.emoji]
  })
  socket.on('message:read', (payload: { roomId: string; deviceId: string; lastReadAt: number }) => {
    ;(state.readReceipts[payload.roomId] ||= {})[payload.deviceId] = payload.lastReadAt
  })
  socket.on('device:approved', () => { state.pendingApproval = false; void startSession() })
  socket.on('device:blocked', () => { state.error = '此设备已被管理员阻止'; state.connected = false; state.connectionState = 'offline' })
  socket.on('typing', (payload: { roomId: string; deviceId: string; nickname: string; typing: boolean }) => {
    if (payload.deviceId === identity.id) return
    if (payload.typing) state.typing[payload.roomId] = payload.nickname
    else delete state.typing[payload.roomId]
  })
  return registered
}

export async function loadRooms() {
  state.rooms = await api<Room[]>(`/api/rooms?deviceId=${encodeURIComponent(identity.id)}`)
}

export async function loadMessages(roomId: string, force = false) {
  if ((!force && state.messages[roomId]) || loadingRooms.has(roomId)) return
  loadingRooms.add(roomId)
  try {
    const messages = await api<ChatMessage[]>(`/api/messages/${encodeURIComponent(roomId)}?deviceId=${encodeURIComponent(identity.id)}`)
    state.messages[roomId] = await Promise.all(messages.map(decodeMessage))
  } finally { loadingRooms.delete(roomId) }
}

export async function selectRoom(roomId: string) {
  state.activeRoomId = roomId
  state.unread[roomId] = 0
  updateDocumentTitle()
  await loadMessages(roomId)
  markRoomRead(roomId)
}

function pushMessageNotice(message: ChatMessage) {
  const notice: AppNotice = {
    id: createUuid(), roomId: message.roomId, senderName: message.senderName,
    preview: message.type === 'file' ? `发送了文件：${message.content}` : message.content,
    createdAt: Date.now()
  }
  state.notices.unshift(notice)
  if (state.notices.length > 4) state.notices.length = 4
  window.setTimeout(() => dismissNotice(notice.id), 6000)
}

export function dismissNotice(id: string) {
  state.notices = state.notices.filter((notice) => notice.id !== id)
}

export function setCurrentPage(page: string) {
  state.currentPage = page
  if (page === 'chat' && !document.hidden) {
    state.unread[state.activeRoomId] = 0
    updateDocumentTitle()
  }
}

function updateDocumentTitle() {
  const count = Object.values(state.unread).reduce((sum, value) => sum + value, 0)
  document.title = count ? `(${Math.min(99, count)}) LoadChat` : 'LoadChat'
}

function directPeer(roomId: string) {
  if (!roomId.startsWith('dm:')) return null
  const peerId = roomId.slice(3).split(':').find((id) => id !== identity.id)
  return state.devices.find((device) => device.id === peerId) || null
}

async function decodeMessage(message: ChatMessage) {
  const peer = directPeer(message.roomId)
  if (message.reply?.content.startsWith('e2ee:v1:')) {
    try {
      message.reply.content = peer?.encryptionPublicKey
        ? await decryptText(peer.encryptionPublicKey, message.reply.content)
        : '🔒 加密引用消息'
    } catch { message.reply.content = '🔒 无法解密引用消息' }
  }
  if (message.type !== 'encrypted') return message
  message.encrypted = true
  if (!peer?.encryptionPublicKey) {
    message.type = 'text'; message.content = '🔒 无法解密：对方的加密密钥当前不可用'
    return message
  }
  try {
    message.content = await decryptText(peer.encryptionPublicKey, message.content)
  } catch {
    message.content = '🔒 无法解密：密钥已更换或本机浏览器数据已清除'
  }
  message.type = 'text'
  return message
}

export async function sendMessage(content: string, replyTo?: string) {
  let type: 'text' | 'encrypted' = 'text'
  if (isE2eeRoom(state.activeRoomId)) {
    const peer = directPeer(state.activeRoomId)
    if (!peer?.encryptionPublicKey) throw new Error('对方浏览器暂不支持端到端加密')
    content = await encryptText(peer.encryptionPublicKey, content)
    type = 'encrypted'
  }
  return new Promise<void>((resolve, reject) => {
    socket?.emit('message:send', { roomId: state.activeRoomId, content, type, replyTo }, (result: any) => {
      if (result?.error) reject(new Error(result.error)); else resolve()
    })
  })
}

export function retractMessage(messageId: string) {
  return new Promise<void>((resolve, reject) => socket?.emit('message:delete', { messageId }, (result: any) => {
    if (result?.error) reject(new Error(result.error)); else resolve()
  }))
}

export function toggleReaction(messageId: string, emoji: string) {
  return new Promise<void>((resolve, reject) => socket?.emit('reaction:toggle', { messageId, emoji }, (result: any) => {
    if (result?.error) reject(new Error(result.error)); else resolve()
  }))
}

export function markRoomRead(roomId = state.activeRoomId) {
  const messages = state.messages[roomId] || []
  const lastReadAt = messages.at(-1)?.createdAt || Date.now()
  socket?.emit('read:update', { roomId, lastReadAt })
}

export function searchMessages(query: string, roomId = '') {
  return api<ChatMessage[]>(`/api/messages/search/all?q=${encodeURIComponent(query)}&roomId=${encodeURIComponent(roomId)}&deviceId=${encodeURIComponent(identity.id)}`)
}

let typingTimer: number | undefined
export function sendTyping() {
  socket?.emit('typing', { roomId: state.activeRoomId, typing: true })
  window.clearTimeout(typingTimer)
  typingTimer = window.setTimeout(() => socket?.emit('typing', { roomId: state.activeRoomId, typing: false }), 1200)
}

export function createGroup(name: string, members: string[]) {
  return new Promise<Room>((resolve, reject) => {
    socket?.emit('room:create', { name, members }, (result: any) => {
      if (result?.error) reject(new Error(result.error)); else resolve(result.room)
    })
  })
}

export function updateGroup(roomId: string, action: 'rename' | 'add' | 'remove' | 'promote', value: { name?: string; deviceId?: string }) {
  return new Promise<Room>((resolve, reject) => socket?.emit('room:update', { roomId, action, ...value }, (result: any) => {
    if (result?.error) reject(new Error(result.error)); else resolve(result.room)
  }))
}

export function leaveGroup(roomId: string, transferTo?: string) {
  return new Promise<void>((resolve, reject) => socket?.emit('room:leave', { roomId, transferTo }, (result: any) => {
    if (result?.error) reject(new Error(result.error)); else resolve()
  }))
}

export function deleteGroup(roomId: string) {
  return new Promise<void>((resolve, reject) => socket?.emit('room:delete', { roomId }, (result: any) => {
    if (result?.error) reject(new Error(result.error)); else resolve()
  }))
}

export async function loadFiles(search = '') {
  state.files = await api<FileInfo[]>(`/api/files?search=${encodeURIComponent(search)}&deviceId=${encodeURIComponent(identity.id)}`)
}

export async function loadStatus() {
  state.status = await api<ServerStatus>('/api/status')
}

export async function removeFile(id: string) {
  await api(`/api/files/${encodeURIComponent(id)}?deviceId=${encodeURIComponent(identity.id)}`, { method: 'DELETE' })
  state.files = state.files.filter((file) => file.id !== id)
}

export async function shareFile(id: string, expiresIn = 86400000, maxDownloads = 0) {
  return api<{ id: string; path: string; expiresAt: number; maxDownloads: number }>(`/api/files/${encodeURIComponent(id)}/share`, {
    method: 'POST', body: JSON.stringify({ expiresIn, maxDownloads, deviceId: identity.id })
  })
}

export function requestNotifications() {
  if ('Notification' in window && Notification.permission === 'default') return Notification.requestPermission()
}

export function activeRoomName() {
  if (state.activeRoomId.startsWith('dm:')) {
    const peerId = state.activeRoomId.slice(3).split(':').find((id) => id !== identity.id)
    return state.devices.find((device) => device.id === peerId)?.nickname || '私聊'
  }
  return state.rooms.find((room) => room.id === state.activeRoomId)?.name || '局域网大厅'
}

export { socket }
