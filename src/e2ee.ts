import { ref } from 'vue'

const PRIVATE_KEY = 'loadchat:e2ee-private'
const PUBLIC_KEY = 'loadchat:e2ee-public'
const ROOMS_KEY = 'loadchat:e2ee-rooms'
const roomIds = ref<string[]>(JSON.parse(localStorage.getItem(ROOMS_KEY) || '[]'))
let pairPromise: Promise<{ privateKey: CryptoKey | null; publicKey: string }> | null = null
const keyCache = new Map<string, Promise<CryptoKey>>()

export const e2eeSupported = Boolean(window.isSecureContext && globalThis.crypto?.subtle)

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64ToBytes(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

async function loadPair() {
  if (!e2eeSupported) return { privateKey: null, publicKey: '' }
  const savedPrivate = localStorage.getItem(PRIVATE_KEY)
  const savedPublic = localStorage.getItem(PUBLIC_KEY)
  if (savedPrivate && savedPublic) {
    try {
      const privateKey = await crypto.subtle.importKey('jwk', JSON.parse(savedPrivate), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey'])
      return { privateKey, publicKey: savedPublic }
    } catch { localStorage.removeItem(PRIVATE_KEY); localStorage.removeItem(PUBLIC_KEY) }
  }
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey'])
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  const publicKey = JSON.stringify(publicJwk)
  localStorage.setItem(PRIVATE_KEY, JSON.stringify(privateJwk)); localStorage.setItem(PUBLIC_KEY, publicKey)
  return { privateKey: pair.privateKey, publicKey }
}

export function ensureCryptoIdentity() {
  pairPromise ||= loadPair()
  return pairPromise
}

async function sharedKey(peerPublicKey: string) {
  let cached = keyCache.get(peerPublicKey)
  if (!cached) {
    cached = (async () => {
      const pair = await ensureCryptoIdentity()
      if (!pair.privateKey) throw new Error('端到端加密需要 HTTPS 安全连接')
      const publicKey = await crypto.subtle.importKey('jwk', JSON.parse(peerPublicKey), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
      return crypto.subtle.deriveKey({ name: 'ECDH', public: publicKey }, pair.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    })()
    keyCache.set(peerPublicKey, cached)
  }
  return cached
}

export async function encryptText(peerPublicKey: string, text: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await sharedKey(peerPublicKey), new TextEncoder().encode(text))
  return `e2ee:v1:${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(encrypted))}`
}

export async function decryptText(peerPublicKey: string, payload: string) {
  const [prefix, version, iv, cipher] = payload.split(':')
  if (prefix !== 'e2ee' || version !== 'v1' || !iv || !cipher) throw new Error('加密消息格式无效')
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(iv) }, await sharedKey(peerPublicKey), base64ToBytes(cipher))
  return new TextDecoder().decode(decrypted)
}

export function isE2eeRoom(roomId: string) { return roomIds.value.includes(roomId) }
export function setE2eeRoom(roomId: string, enabled: boolean) {
  roomIds.value = enabled ? [...new Set([...roomIds.value, roomId])] : roomIds.value.filter((id) => id !== roomId)
  localStorage.setItem(ROOMS_KEY, JSON.stringify(roomIds.value))
}

export const encryptedRooms = roomIds
