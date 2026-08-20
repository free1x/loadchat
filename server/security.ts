import crypto from 'node:crypto'
import net from 'node:net'
import { config } from './config.js'
import type { SessionPayload } from './types.js'

const b64 = (value: string | Buffer) => Buffer.from(value).toString('base64url')

export function hashPassword(password: string, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return { hash, salt }
}

export function verifyPassword(password: string) {
  if (!config.passwordHash) return true
  const value = crypto.scryptSync(password, config.passwordSalt, 64)
  const expected = Buffer.from(config.passwordHash, 'hex')
  return value.length === expected.length && crypto.timingSafeEqual(value, expected)
}

export function verifyAdminPassword(password: string) {
  if (!config.adminPasswordHash) return false
  const value = crypto.scryptSync(password, config.adminPasswordSalt, 64)
  const expected = Buffer.from(config.adminPasswordHash, 'hex')
  return value.length === expected.length && crypto.timingSafeEqual(value, expected)
}

export function signToken(payload: SessionPayload) {
  const body = b64(JSON.stringify(payload))
  const signature = crypto.createHmac('sha256', config.tokenSecret).update(body).digest('base64url')
  return `${body}.${signature}`
}

export function verifyToken(token: string | undefined, scope: SessionPayload['scope'] = 'access') {
  if (!token) return null
  const [body, signature] = token.split('.')
  if (!body || !signature) return null
  const expected = crypto.createHmac('sha256', config.tokenSecret).update(body).digest()
  const actual = Buffer.from(signature, 'base64url')
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as SessionPayload
    return payload.scope === scope && payload.exp > Date.now() ? payload : null
  } catch { return null }
}

export function cleanIp(value: string | undefined) {
  const first = (value || '').split(',')[0].trim()
  return first.startsWith('::ffff:') ? first.slice(7) : first
}

function ipv4Number(ip: string) {
  return ip.split('.').reduce((n, part) => (n << 8) + Number(part), 0) >>> 0
}

function inCidr(ip: string, cidr: string) {
  if (!net.isIPv4(ip)) return cidr === '::1/128' && ip === '::1'
  const [base, bitsRaw] = cidr.split('/')
  if (!net.isIPv4(base)) return false
  const bits = Number(bitsRaw ?? 32)
  if (bits < 0 || bits > 32) return false
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return (ipv4Number(ip) & mask) === (ipv4Number(base) & mask)
}

export function isAllowedIp(ip: string) {
  if (ip === '::1' || ip === '127.0.0.1') return true
  const privateRanges = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16']
  const ranges = config.allowedCidrs.length ? config.allowedCidrs : privateRanges
  return ranges.some((range) => inCidr(ip, range))
}
