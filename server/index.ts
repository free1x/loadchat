import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import express, { type NextFunction, type Request, type Response } from 'express'
import { ZipArchive } from 'archiver'
import helmet from 'helmet'
import mime from 'mime-types'
import { Server } from 'socket.io'
import { backupFile, createBackup, databaseSize, listBackups, queueRestore } from './backup.js'
import { config, dataPath, publicConfig, saveConfig } from './config.js'
import { db, row, rows, run } from './db.js'
import { cleanupLogs, writeLog } from './logger.js'
import { startMdns, stopMdns } from './mdns.js'
import { lanAddresses } from './network.js'
import { allowSocketAction, rateLimit } from './rate-limit.js'
import { cleanIp, hashPassword, isAllowedIp, signToken, verifyAdminPassword, verifyPassword, verifyToken } from './security.js'
import { APP_VERSION } from './version.js'

type Device = {
  id: string; nickname: string; deviceName: string; avatar: string; ip: string; online: boolean; lastSeen: number; encryptionPublicKey?: string
}
type Message = {
  id: string; roomId: string; senderId: string; senderName: string; type: string; content: string;
  fileId?: string; createdAt: number; file?: FileRecord; replyTo?: string; editedAt?: number; deletedAt?: number;
  reply?: { id: string; senderName: string; content: string }; reactions?: Record<string, string[]>
}
type FileRecord = {
  id: string; originalName: string; storedName: string; mime: string; size: number; senderId: string;
  roomId: string; status: string; createdAt: number; completedAt?: number; uploadedChunks?: number; totalChunks: number; sha256?: string
}

const app = express()
const defaultTlsCert = path.join(dataPath, 'tls', 'cert.pem')
const defaultTlsKey = path.join(dataPath, 'tls', 'key.pem')
const tlsCert = process.env.LOADCHAT_TLS_CERT || defaultTlsCert
const tlsKey = process.env.LOADCHAT_TLS_KEY || defaultTlsKey
const tlsEnabled = Boolean(tlsCert && tlsKey && fs.existsSync(tlsCert) && fs.existsSync(tlsKey))
const httpServer = tlsEnabled
  ? https.createServer({ cert: fs.readFileSync(tlsCert!), key: fs.readFileSync(tlsKey!) }, app)
  : http.createServer(app)
const io = new Server(httpServer, { maxHttpBufferSize: 2 * 1024 * 1024, cors: { origin: false } })
const liveDevices = new Map<string, Device>()

app.set('trust proxy', false)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'], connectSrc: ["'self'", 'ws:', 'wss:'],
      fontSrc: ["'self'", 'data:'], objectSrc: ["'none'"], baseUri: ["'self'"],
      frameAncestors: ["'none'"], formAction: ["'self'"], workerSrc: ["'self'", 'blob:'],
      upgradeInsecureRequests: tlsEnabled ? [] : null
    }
  },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  referrerPolicy: { policy: 'no-referrer' }
}))
app.use((req, res, next) => {
  const ip = cleanIp(req.socket.remoteAddress)
  if (!isAllowedIp(ip)) return res.status(403).json({ error: '该 IP 不在允许的局域网范围内' })
  next()
})
app.use(express.json({ limit: '1mb' }))
app.use('/api', rateLimit('api', 2400, 5 * 60_000))

const asyncRoute = (handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { void handler(req, res, next).catch(next) }

function accessToken(req: Request) {
  const authorization = req.headers.authorization
  return authorization?.startsWith('Bearer ') ? authorization.slice(7) : String(req.query.token || '')
}

function requireAccess(req: Request, res: Response, next: NextFunction) {
  if (!config.passwordHash || verifyToken(accessToken(req), 'access')) return next()
  return res.status(401).json({ error: '需要访问密码' })
}

function isLoopback(req: Request) {
  const ip = cleanIp(req.socket.remoteAddress)
  return ip === '127.0.0.1' || ip === '::1'
}

function adminToken(req: Request) {
  return String(req.headers['x-admin-token'] || '')
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (verifyToken(adminToken(req), 'admin')) return next()
  if (!config.adminPasswordHash && isLoopback(req)) return next()
  return res.status(403).json({ error: config.adminPasswordHash ? '需要管理员验证' : '首次设置管理员密码只能在服务端本机进行' })
}

function audit(req: Request, actorId: string, action: string, target = '', detail: Record<string, unknown> = {}) {
  const ip = cleanIp(req.socket.remoteAddress)
  run('INSERT INTO audit_logs(id,actor_id,action,target,ip,detail,created_at) VALUES(?,?,?,?,?,?,?)',
    crypto.randomUUID(), actorId || 'admin', action, target, ip, JSON.stringify(detail).slice(0, 4000), Date.now())
  writeLog('security', action, { actorId: actorId || 'admin', target, ip, ...detail })
}

function diskStatus() {
  try {
    const stat = fs.statfsSync(config.storagePath)
    return { available: Number(stat.bavail * stat.bsize), total: Number(stat.blocks * stat.bsize) }
  } catch { return { available: 0, total: 0 } }
}

function publicStatus() {
  return {
    uptime: process.uptime(), onlineUsers: liveDevices.size,
    totalMessages: Number(row<{ count: number }>('SELECT COUNT(*) count FROM messages')?.count || 0),
    totalFiles: Number(row<{ count: number }>("SELECT COUNT(*) count FROM files WHERE status='complete'")?.count || 0),
    memory: process.memoryUsage(), disk: diskStatus(), platform: `${os.platform()} ${os.release()}`, node: process.version,
    databaseSize: databaseSize()
  }
}

function fileDto(value: any): FileRecord {
  return {
    id: value.id, originalName: value.original_name, storedName: value.stored_name, mime: value.mime,
    size: Number(value.size), senderId: value.sender_id, roomId: value.room_id, status: value.status,
    createdAt: Number(value.created_at), completedAt: value.completed_at ? Number(value.completed_at) : undefined,
    uploadedChunks: value.uploaded_chunks == null ? undefined : Number(value.uploaded_chunks),
    totalChunks: Number(value.total_chunks), sha256: value.sha256 || undefined
  }
}

function messageDto(value: any): Message {
  const result: Message = {
    id: value.id, roomId: value.room_id, senderId: value.sender_id, senderName: value.sender_name,
    type: value.type, content: value.content, fileId: value.file_id || undefined, createdAt: Number(value.created_at),
    replyTo: value.reply_to || undefined, editedAt: value.edited_at ? Number(value.edited_at) : undefined,
    deletedAt: value.deleted_at ? Number(value.deleted_at) : undefined
  }
  if (value.reply_to && value.reply_content != null) result.reply = {
    id: value.reply_to, senderName: value.reply_sender_name || '局域网用户', content: value.reply_content
  }
  if (value.reactions) {
    result.reactions = {}
    for (const item of String(value.reactions).split('|')) {
      const separator = item.indexOf(':')
      if (separator <= 0) continue
      const emoji = item.slice(0, separator); const deviceId = item.slice(separator + 1)
      ;(result.reactions[emoji] ||= []).push(deviceId)
    }
  }
  if (value.file_id && value.file_original_name) result.file = fileDto({
    id: value.file_id,
    original_name: value.file_original_name,
    stored_name: value.file_stored_name,
    mime: value.file_mime,
    size: value.file_size,
    sender_id: value.file_sender_id,
    room_id: value.file_room_id,
    status: value.file_status,
    created_at: value.file_created_at,
    completed_at: value.file_completed_at,
    total_chunks: value.file_total_chunks,
    sha256: value.file_sha256
  })
  return result
}

function dbDevice(id: string) {
  return row<any>('SELECT * FROM devices WHERE id = ?', id)
}

function emitPresence() {
  io.emit('devices:update', [...liveDevices.values()].sort((a, b) => a.nickname.localeCompare(b.nickname)))
}

function roomRecipients(roomId: string) {
  if (roomId.startsWith('dm:')) return roomId.slice(3).split(':')
  return rows<{ device_id: string }>('SELECT device_id FROM room_members WHERE room_id = ?', roomId).map((r) => r.device_id)
}

function emitToRoom(roomId: string, event: string, payload: unknown) {
  if (roomId.startsWith('dm:')) {
    for (const id of roomRecipients(roomId)) io.to(`device:${id}`).emit(event, payload)
  } else io.to(`room:${roomId}`).emit(event, payload)
}

function normalizeRoomId(roomId: string, senderId: string) {
  if (!roomId) return 'lobby'
  if (roomId.startsWith('dm:')) {
    const ids = roomId.slice(3).split(':').filter(Boolean).sort()
    if (ids.length !== 2 || !ids.includes(senderId)) throw new Error('无权访问此会话')
    return `dm:${ids.join(':')}`
  }
  return roomId
}

function canUseRoom(roomId: string, deviceId: string) {
  if (roomId === 'lobby') return true
  if (roomId.startsWith('dm:')) return roomId.slice(3).split(':').includes(deviceId)
  return Boolean(row('SELECT 1 FROM room_members WHERE room_id = ? AND device_id = ?', roomId, deviceId))
}

function isRoomAdmin(roomId: string, deviceId: string) {
  return Boolean(row('SELECT 1 FROM room_members WHERE room_id=? AND device_id=? AND role=?', roomId, deviceId, 'admin'))
}

function groupRoomDto(roomId: string) {
  const room = row<any>("SELECT * FROM rooms WHERE id=? AND type='group'", roomId)
  if (!room) return null
  const memberships = rows<any>('SELECT device_id,role FROM room_members WHERE room_id=?', roomId)
  return {
    id: roomId, name: room.name || '群聊', type: 'group' as const,
    members: memberships.map((item) => item.device_id),
    admins: memberships.filter((item) => item.role === 'admin').map((item) => item.device_id),
    createdAt: Number(room.created_at || 0)
  }
}

function requestDeviceId(req: Request) {
  const token = String(req.headers['x-device-token'] || req.query.deviceToken || '')
  const payload = verifyToken(token, 'device')
  const claimedId = String(req.query.deviceId || req.body?.deviceId || req.headers['x-device-id'] || '')
  if (!payload?.deviceId || (claimedId && claimedId !== payload.deviceId)) return ''
  return payload.deviceId
}

app.get('/api/bootstrap', (req, res) => {
  const addresses = lanAddresses(config.port, tlsEnabled ? 'https' : 'http')
  const publicUrl = process.env.LOADCHAT_PUBLIC_URL?.replace(/\/$/, '')
  if (publicUrl && !addresses.includes(publicUrl)) addresses.unshift(publicUrl)
  res.json({
    ...publicConfig(), addresses, primaryAddress: addresses[0] || `${tlsEnabled ? 'https' : 'http'}://localhost:${config.port}`,
    authRequired: Boolean(config.passwordHash), adminLocalSetup: !config.adminPasswordHash,
    tlsEnabled, version: APP_VERSION
  })
})

app.post('/api/auth', rateLimit('access-auth', 10, 60_000), (req, res) => {
  const password = String(req.body?.password || '')
  if (!verifyPassword(password)) {
    writeLog('security', 'access.login.failed', { ip: cleanIp(req.socket.remoteAddress) })
    return res.status(401).json({ error: '访问密码不正确' })
  }
  const token = signToken({ scope: 'access', exp: Date.now() + 30 * 24 * 60 * 60 * 1000 })
  res.json({ token })
})

app.use('/api', requireAccess)

app.get('/api/status', (req, res) => res.json(publicStatus()))

app.post('/api/admin/auth', rateLimit('admin-auth', 8, 60_000), (req, res) => {
  if (!config.adminPasswordHash) {
    if (!isLoopback(req)) return res.status(403).json({ error: '请先在服务端本机设置管理员密码' })
  } else if (!verifyAdminPassword(String(req.body?.password || ''))) {
    writeLog('security', 'admin.login.failed', { ip: cleanIp(req.socket.remoteAddress) })
    return res.status(401).json({ error: '管理员密码不正确' })
  }
  const token = signToken({ scope: 'admin', exp: Date.now() + 12 * 60 * 60 * 1000 })
  audit(req, 'admin', 'admin.login')
  res.json({ token, needsSetup: !config.adminPasswordHash })
})

app.post('/api/admin/setup', requireAdmin, (req, res) => {
  const password = String(req.body?.password || '')
  if (password.length < 10) return res.status(400).json({ error: '管理员密码至少需要 10 个字符' })
  const { hash, salt } = hashPassword(password)
  saveConfig({ adminPasswordHash: hash, adminPasswordSalt: salt })
  audit(req, 'admin', 'admin.password.updated')
  const token = signToken({ scope: 'admin', exp: Date.now() + 12 * 60 * 60 * 1000 })
  res.json({ ok: true, token })
})

app.get('/api/rooms', (req, res) => {
  const deviceId = requestDeviceId(req)
  if (!deviceId) return res.status(401).json({ error: '设备身份无效，请刷新页面重试' })
  const groups = rows<any>(`
    SELECT r.*, GROUP_CONCAT(rm.device_id) members,
      GROUP_CONCAT(CASE WHEN rm.role='admin' THEN rm.device_id END) admins
    FROM rooms r JOIN room_members mine ON mine.room_id = r.id AND mine.device_id = ?
    LEFT JOIN room_members rm ON rm.room_id = r.id
    GROUP BY r.id ORDER BY r.created_at DESC`, deviceId)
  res.json([
    { id: 'lobby', name: '局域网大厅', type: 'group', members: [], createdAt: 0 },
    ...groups.map((r) => ({ id: r.id, name: r.name, type: r.type, members: r.members?.split(',') || [],
      admins: r.admins?.split(',').filter(Boolean) || [], createdAt: Number(r.created_at) }))
  ])
})

app.get('/api/messages/:roomId', (req, res) => {
  const roomId = decodeURIComponent(String(req.params.roomId))
  const deviceId = requestDeviceId(req)
  if (!deviceId) return res.status(401).json({ error: '设备身份无效，请刷新页面重试' })
  if (!canUseRoom(roomId, deviceId)) return res.status(403).json({ error: '无权访问此会话' })
  const before = Number(req.query.before) || Date.now() + 1
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50))
  const result = rows<any>(`
    SELECT m.*,
      reply.sender_name AS reply_sender_name, reply.content AS reply_content,
      (SELECT GROUP_CONCAT(mr.emoji || ':' || mr.device_id, '|') FROM message_reactions mr WHERE mr.message_id = m.id) reactions,
      f.original_name AS file_original_name, f.stored_name AS file_stored_name,
      f.mime AS file_mime, f.size AS file_size, f.sender_id AS file_sender_id,
      f.room_id AS file_room_id, f.status AS file_status, f.created_at AS file_created_at,
      f.completed_at AS file_completed_at, f.total_chunks AS file_total_chunks, f.sha256 AS file_sha256
    FROM messages m LEFT JOIN files f ON f.id = m.file_id LEFT JOIN messages reply ON reply.id = m.reply_to
    WHERE m.room_id = ? AND m.created_at < ? ORDER BY m.created_at DESC LIMIT ?`, roomId, before, limit)
  res.json(result.reverse().map(messageDto))
})

app.get('/api/messages/search/all', (req, res) => {
  const deviceId = requestDeviceId(req)
  if (!deviceId) return res.status(401).json({ error: '设备身份无效' })
  const query = String(req.query.q || '').trim().slice(0, 100)
  if (query.length < 2) return res.json([])
  const roomId = String(req.query.roomId || '')
  if (roomId && !canUseRoom(roomId, deviceId)) return res.status(403).json({ error: '无权访问此会话' })
  const matches = rows<any>(`
    SELECT m.* FROM messages m
    WHERE m.deleted_at IS NULL AND m.type='text' AND m.content LIKE ?
      AND (? = '' OR m.room_id = ?)
      AND (m.room_id='lobby' OR (m.room_id LIKE 'dm:%' AND instr(':' || substr(m.room_id,4) || ':', ':' || ? || ':') > 0)
        OR EXISTS (SELECT 1 FROM room_members rm WHERE rm.room_id=m.room_id AND rm.device_id=?))
    ORDER BY m.created_at DESC LIMIT 100`, `%${query}%`, roomId, roomId, deviceId, deviceId)
  res.json(matches.map(messageDto))
})

app.get('/api/files', (req, res) => {
  const deviceId = requestDeviceId(req)
  if (!deviceId) return res.status(400).json({ error: '缺少设备标识' })
  const search = `%${String(req.query.search || '')}%`
  const result = rows<any>(`
    SELECT f.*, (SELECT COUNT(*) FROM file_chunks c WHERE c.file_id = f.id) uploaded_chunks
    FROM files f
    WHERE f.original_name LIKE ? AND (
      f.room_id = 'lobby' OR f.sender_id = ? OR
      (f.room_id LIKE 'dm:%' AND instr(':' || substr(f.room_id, 4) || ':', ':' || ? || ':') > 0) OR
      EXISTS (SELECT 1 FROM room_members rm WHERE rm.room_id = f.room_id AND rm.device_id = ?)
    )
    ORDER BY f.created_at DESC LIMIT 500`, search, deviceId, deviceId, deviceId)
  res.json(result.map(fileDto))
})

function uploadCapacityError(senderId: string, fileSize: number) {
  const active = Number(row<{ count: number }>("SELECT COUNT(*) count FROM files WHERE sender_id=? AND status IN ('uploading','finalizing')", senderId)?.count || 0)
  if (active >= config.maxConcurrentUploads) return `同时上传数量不能超过 ${config.maxConcurrentUploads} 个`
  const used = Number(row<{ size: number }>("SELECT COALESCE(SUM(size),0) size FROM files WHERE status IN ('uploading','finalizing','complete')")?.size || 0)
  if (used + fileSize > config.maxStorageSize) return '服务器存储配额不足'
  const today = Date.now() - 24 * 60 * 60 * 1000
  const daily = Number(row<{ size: number }>('SELECT COALESCE(SUM(size),0) size FROM files WHERE sender_id=? AND created_at>=?', senderId, today)?.size || 0)
  if (daily + fileSize > config.maxDailyUploadBytes) return '该设备已达到 24 小时上传额度'
  const disk = diskStatus()
  if (disk.available && disk.available - fileSize < config.minFreeSpace) return '磁盘剩余空间不足，已停止接收新文件'
  return ''
}

app.post('/api/uploads/init', asyncRoute(async (req, res) => {
  const { name, size, type, chunkSize, totalChunks, senderId, roomId: rawRoomId, uploadKey } = req.body || {}
  const fileSize = Number(size)
  const partSize = Math.min(8 * 1024 * 1024, Math.max(256 * 1024, Number(chunkSize) || 4 * 1024 * 1024))
  if (!name || !senderId || !uploadKey || !Number.isSafeInteger(fileSize) || fileSize < 0 || fileSize > config.maxFileSize) {
    return res.status(400).json({ error: '文件信息无效或超出大小限制' })
  }
  const authorizedDeviceId = requestDeviceId(req)
  if (!authorizedDeviceId || authorizedDeviceId !== String(senderId)) return res.status(403).json({ error: '设备身份与发送者不匹配' })
  const roomId = normalizeRoomId(String(rawRoomId || 'lobby'), String(senderId))
  if (!canUseRoom(roomId, String(senderId))) return res.status(403).json({ error: '无权向此会话发送文件' })
  const existing = row<any>('SELECT *, (SELECT COUNT(*) FROM file_chunks WHERE file_id = files.id) uploaded_chunks FROM files WHERE upload_key = ?', String(uploadKey))
  if (existing) {
    if (existing.sender_id !== authorizedDeviceId) return res.status(403).json({ error: '无权恢复此上传会话' })
    return res.json(fileDto(existing))
  }
  const capacityError = uploadCapacityError(authorizedDeviceId, fileSize)
  if (capacityError) return res.status(507).json({ error: capacityError })

  fs.mkdirSync(config.storagePath, { recursive: true })
  const id = crypto.randomUUID()
  const storedName = `${id}.upload`
  const chunks = Math.max(1, Math.ceil(fileSize / partSize))
  fs.closeSync(fs.openSync(path.join(config.storagePath, storedName), 'w'))
  run(`INSERT INTO files(id, upload_key, original_name, stored_name, mime, size, chunk_size, total_chunks,
    sender_id, room_id, status, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, String(uploadKey), path.basename(String(name)), storedName, String(type || mime.lookup(String(name)) || 'application/octet-stream'),
    fileSize, partSize, chunks, String(senderId), roomId, 'uploading', Date.now())
  res.status(201).json(fileDto({ id, original_name: path.basename(String(name)), stored_name: storedName, mime: type || '',
    size: fileSize, sender_id: senderId, room_id: roomId, status: 'uploading', created_at: Date.now(),
    total_chunks: chunks, uploaded_chunks: 0 }))
}))

app.get('/api/uploads/:id/status', (req, res) => {
  const file = row<any>('SELECT * FROM files WHERE id = ?', String(req.params.id))
  if (!file) return res.status(404).json({ error: '上传会话不存在' })
  const deviceId = requestDeviceId(req)
  if (!deviceId || file.sender_id !== deviceId) return res.status(403).json({ error: '无权查看此上传会话' })
  const chunks = rows<{ chunk_index: number }>('SELECT chunk_index FROM file_chunks WHERE file_id = ? ORDER BY chunk_index', file.id)
  res.json({ ...fileDto(file), uploaded: chunks.map((c) => Number(c.chunk_index)) })
})

app.put('/api/uploads/:id/chunks/:index', express.raw({ type: 'application/octet-stream', limit: '8mb' }), asyncRoute(async (req, res) => {
  const file = row<any>('SELECT * FROM files WHERE id = ?', String(req.params.id))
  const index = Number(req.params.index)
  if (!file || file.status !== 'uploading') return res.status(404).json({ error: '上传会话不可用' })
  const deviceId = requestDeviceId(req)
  if (!deviceId || file.sender_id !== deviceId) return res.status(403).json({ error: '无权写入此上传会话' })
  if (!Number.isInteger(index) || index < 0 || index >= Number(file.total_chunks) || !Buffer.isBuffer(req.body)) {
    return res.status(400).json({ error: '分片无效' })
  }
  const expected = index === Number(file.total_chunks) - 1
    ? Number(file.size) - index * Number(file.chunk_size) : Number(file.chunk_size)
  if (req.body.length !== expected) return res.status(400).json({ error: `分片大小无效，期望 ${expected} 字节` })
  if (!row('SELECT 1 FROM file_chunks WHERE file_id = ? AND chunk_index = ?', file.id, index)) {
    const handle = await fs.promises.open(path.join(config.storagePath, file.stored_name), 'r+')
    try { await handle.write(req.body, 0, req.body.length, index * Number(file.chunk_size)) }
    finally { await handle.close() }
    run('INSERT OR IGNORE INTO file_chunks(file_id, chunk_index, size) VALUES(?,?,?)', file.id, index, req.body.length)
  }
  const count = Number(row<{ count: number }>('SELECT COUNT(*) count FROM file_chunks WHERE file_id = ?', file.id)?.count || 0)
  if (count === Number(file.total_chunks)) await completeUpload(file.id)
  res.json({ ok: true, uploadedChunks: count, complete: count === Number(file.total_chunks) })
}))

function hashFile(filePath: string) {
  return new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

async function completeUpload(fileId: string) {
  const file = row<any>('SELECT * FROM files WHERE id = ?', fileId)
  if (!file || file.status !== 'uploading') return
  const claimed = run("UPDATE files SET status = 'finalizing' WHERE id = ? AND status = 'uploading'", fileId)
  if (!claimed.changes) return
  const extension = path.extname(file.original_name).slice(0, 12).replace(/[^.a-zA-Z0-9_-]/g, '')
  const finalName = `${file.id}${extension}`
  const from = path.join(config.storagePath, file.stored_name)
  const to = path.join(config.storagePath, finalName)
  let sha256 = ''
  try {
    sha256 = await hashFile(from)
    await fs.promises.rename(from, to)
  }
  catch (error) { run("UPDATE files SET status = 'uploading' WHERE id = ? AND status = 'finalizing'", fileId); throw error }
  const completedAt = Date.now()
  run("UPDATE files SET stored_name = ?, status = 'complete', completed_at = ?, sha256 = ? WHERE id = ? AND status = 'finalizing'", finalName, completedAt, sha256, fileId)
  const sender = dbDevice(file.sender_id)
  const message: Message = {
    id: crypto.randomUUID(), roomId: file.room_id, senderId: file.sender_id,
    senderName: sender?.nickname || '局域网用户', type: 'file', content: file.original_name,
    fileId, createdAt: completedAt,
    file: fileDto({ ...file, stored_name: finalName, status: 'complete', completed_at: completedAt, sha256 })
  }
  run('INSERT INTO messages(id, room_id, sender_id, sender_name, type, content, file_id, created_at) VALUES(?,?,?,?,?,?,?,?)',
    message.id, message.roomId, message.senderId, message.senderName, message.type, message.content, fileId, message.createdAt)
  emitToRoom(message.roomId, 'message:new', message)
  emitToRoom(message.roomId, 'file:complete', message.file)
  writeLog('info', 'file.completed', { fileId, senderId: file.sender_id, roomId: file.room_id, size: Number(file.size), sha256 })
}

function downloadFile(req: Request, res: Response, file: any) {
  const filePath = path.join(config.storagePath, file.stored_name)
  if (!fs.existsSync(filePath) || file.status !== 'complete') return res.status(404).json({ error: '文件不存在' })
  const size = fs.statSync(filePath).size
  const range = req.headers.range
  res.setHeader('Content-Type', file.mime || 'application/octet-stream')
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.original_name)}`)
  res.setHeader('Accept-Ranges', 'bytes')
  if (range) {
    const match = /bytes=(\d+)-(\d*)/.exec(range)
    if (!match) return res.status(416).end()
    const start = Number(match[1]); const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
    if (start >= size || end < start) return res.status(416).end()
    res.status(206).set({ 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) })
    return fs.createReadStream(filePath, { start, end }).pipe(res)
  }
  res.setHeader('Content-Length', String(size))
  fs.createReadStream(filePath).pipe(res)
}

app.get('/api/files/download-zip', (req, res) => {
  const deviceId = requestDeviceId(req)
  if (!deviceId) return res.status(403).json({ error: '设备身份无效' })
  const ids = [...new Set(String(req.query.ids || '').split(',').filter(Boolean))].slice(0, 30)
  if (!ids.length) return res.status(400).json({ error: '请选择要下载的文件' })
  const files = ids.map((id) => row<any>('SELECT * FROM files WHERE id=? AND status=?', id, 'complete')).filter(Boolean)
  if (files.length !== ids.length || files.some((file) => !canUseRoom(file.room_id, deviceId))) return res.status(403).json({ error: '文件不存在或无权下载' })
  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', `attachment; filename="LoadChat-files-${new Date().toISOString().slice(0, 10)}.zip"`)
  const archive = new ZipArchive({ zlib: { level: 1 } })
  archive.on('warning', (error: Error) => writeLog('warn', 'zip.warning', { message: error.message }))
  archive.on('error', (error: Error) => { writeLog('error', 'zip.failed', { message: error.message }); res.destroy(error) })
  archive.pipe(res)
  const used = new Map<string, number>()
  for (const file of files) {
    const base = path.basename(file.original_name)
    const count = used.get(base) || 0; used.set(base, count + 1)
    const extension = path.extname(base); const stem = path.basename(base, extension)
    const name = count ? `${stem} (${count + 1})${extension}` : base
    archive.file(path.join(config.storagePath, file.stored_name), { name })
  }
  void archive.finalize()
})

app.get('/api/files/:id/download', (req, res) => {
  const file = row<any>('SELECT * FROM files WHERE id = ?', String(req.params.id))
  if (!file) return res.status(404).json({ error: '文件不存在' })
  const deviceId = requestDeviceId(req)
  if (!deviceId || !canUseRoom(file.room_id, deviceId)) return res.status(403).json({ error: '无权访问此文件' })
  downloadFile(req, res, file)
})

app.post('/api/files/:id/share', (req, res) => {
  const file = row<any>('SELECT * FROM files WHERE id = ? AND status = ?', String(req.params.id), 'complete')
  if (!file) return res.status(404).json({ error: '文件不存在' })
  const deviceId = requestDeviceId(req)
  if (!deviceId || !canUseRoom(file.room_id, deviceId)) return res.status(403).json({ error: '无权分享此文件' })
  const expiresIn = Math.min(config.shareMaxDays * 86400000, Math.max(300000, Number(req.body?.expiresIn) || 86400000))
  const expiresAt = Date.now() + expiresIn
  const maxDownloads = Math.min(10000, Math.max(0, Number(req.body?.maxDownloads) || 0))
  const shareId = crypto.randomUUID()
  run('INSERT INTO file_shares(id,file_id,creator_id,expires_at,max_downloads,created_at) VALUES(?,?,?,?,?,?)',
    shareId, file.id, deviceId, expiresAt, maxDownloads, Date.now())
  const token = signToken({ scope: 'share', fileId: file.id, shareId, exp: expiresAt })
  audit(req, deviceId, 'file.share.created', file.id, { shareId, expiresAt, maxDownloads })
  res.json({ id: shareId, path: `/s/${token}`, expiresAt, maxDownloads })
})

app.get('/api/files/:id/shares', (req, res) => {
  const file = row<any>('SELECT * FROM files WHERE id = ?', String(req.params.id))
  if (!file) return res.status(404).json({ error: '文件不存在' })
  const deviceId = requestDeviceId(req)
  if (!deviceId || !canUseRoom(file.room_id, deviceId)) return res.status(403).json({ error: '无权查看分享记录' })
  const shares = rows<any>('SELECT id,creator_id,expires_at,max_downloads,download_count,revoked_at,created_at FROM file_shares WHERE file_id=? AND creator_id=? ORDER BY created_at DESC', file.id, deviceId)
  res.json(shares.map((share) => ({ id: share.id, creatorId: share.creator_id, expiresAt: Number(share.expires_at),
    maxDownloads: Number(share.max_downloads), downloadCount: Number(share.download_count),
    revokedAt: share.revoked_at ? Number(share.revoked_at) : undefined, createdAt: Number(share.created_at) })))
})

app.delete('/api/files/:fileId/shares/:shareId', (req, res) => {
  const deviceId = requestDeviceId(req)
  const share = row<any>('SELECT s.*,f.sender_id FROM file_shares s JOIN files f ON f.id=s.file_id WHERE s.id=? AND s.file_id=?', String(req.params.shareId), String(req.params.fileId))
  if (!share) return res.status(404).json({ error: '分享记录不存在' })
  if (!deviceId || (share.creator_id !== deviceId && share.sender_id !== deviceId)) return res.status(403).json({ error: '无权撤销此分享' })
  run('UPDATE file_shares SET revoked_at=? WHERE id=? AND revoked_at IS NULL', Date.now(), share.id)
  audit(req, deviceId, 'file.share.revoked', share.file_id, { shareId: share.id })
  res.json({ ok: true })
})

app.get('/s/:token', rateLimit('share-download', 300, 60_000), (req, res) => {
  const payload = verifyToken(String(req.params.token), 'share')
  if (!payload?.fileId || !payload.shareId) return res.status(403).send('分享链接无效或已过期')
  const share = row<any>('SELECT * FROM file_shares WHERE id=? AND file_id=?', payload.shareId, payload.fileId)
  if (!share || share.revoked_at || Number(share.expires_at) <= Date.now()) return res.status(403).send('分享链接已撤销或过期')
  const file = row<any>('SELECT * FROM files WHERE id = ?', payload.fileId)
  if (!file) return res.status(404).send('文件不存在')
  const claimed = run(`UPDATE file_shares SET download_count=download_count+1
    WHERE id=? AND revoked_at IS NULL AND expires_at>? AND (max_downloads=0 OR download_count<max_downloads)`, share.id, Date.now())
  if (!Number(claimed.changes)) return res.status(403).send('分享链接已达到下载次数上限、过期或撤销')
  downloadFile(req, res, file)
})

app.delete('/api/files/:id', asyncRoute(async (req, res) => {
  const file = row<any>('SELECT * FROM files WHERE id = ?', String(req.params.id))
  if (!file) return res.status(404).json({ error: '文件不存在' })
  const deviceId = requestDeviceId(req)
  if (!deviceId || file.sender_id !== deviceId) return res.status(403).json({ error: '只有发送者可以删除此文件' })
  const filePath = path.join(config.storagePath, file.stored_name)
  await fs.promises.rm(filePath, { force: true })
  run('DELETE FROM messages WHERE file_id = ?', file.id)
  run('DELETE FROM files WHERE id = ?', file.id)
  emitToRoom(file.room_id, 'file:deleted', file.id)
  res.json({ ok: true })
}))

app.get('/api/admin/status', requireAdmin, (req, res) => res.json({ ...publicStatus(), backups: listBackups().length }))

app.get('/api/admin/settings', requireAdmin, (req, res) => res.json(publicConfig()))

app.patch('/api/admin/settings', requireAdmin, (req, res) => {
  const previousPort = config.port
  const patch: Record<string, unknown> = {}
  if (typeof req.body.newPassword === 'string' && req.body.newPassword.length > 0 && req.body.newPassword.length < 8) {
    return res.status(400).json({ error: '访问密码至少需要 8 个字符' })
  }
  if (typeof req.body.newAdminPassword === 'string' && req.body.newAdminPassword.length > 0 && req.body.newAdminPassword.length < 10) {
    return res.status(400).json({ error: '管理员密码至少需要 10 个字符' })
  }
  if (typeof req.body.serverName === 'string' && req.body.serverName.trim()) patch.serverName = req.body.serverName.trim().slice(0, 50)
  if (Number.isInteger(req.body.port) && req.body.port >= 1024 && req.body.port <= 65535) patch.port = req.body.port
  if (typeof req.body.storagePath === 'string' && path.isAbsolute(req.body.storagePath)) patch.storagePath = path.resolve(req.body.storagePath)
  if (Array.isArray(req.body.allowedCidrs)) patch.allowedCidrs = req.body.allowedCidrs.map(String).filter(Boolean).slice(0, 50)
  if (Number.isInteger(req.body.retentionDays) && req.body.retentionDays >= 0) patch.retentionDays = Math.min(3650, req.body.retentionDays)
  if (Number.isSafeInteger(req.body.maxFileSize) && req.body.maxFileSize >= 1024 * 1024) patch.maxFileSize = req.body.maxFileSize
  if (Number.isSafeInteger(req.body.maxStorageSize) && req.body.maxStorageSize >= 1024 * 1024) patch.maxStorageSize = req.body.maxStorageSize
  if (Number.isSafeInteger(req.body.minFreeSpace) && req.body.minFreeSpace >= 0) patch.minFreeSpace = req.body.minFreeSpace
  if (Number.isInteger(req.body.maxConcurrentUploads) && req.body.maxConcurrentUploads >= 1) patch.maxConcurrentUploads = Math.min(32, req.body.maxConcurrentUploads)
  if (Number.isSafeInteger(req.body.maxDailyUploadBytes) && req.body.maxDailyUploadBytes >= 1024 * 1024) patch.maxDailyUploadBytes = req.body.maxDailyUploadBytes
  if (typeof req.body.requireDeviceApproval === 'boolean') patch.requireDeviceApproval = req.body.requireDeviceApproval
  if (Number.isInteger(req.body.shareMaxDays) && req.body.shareMaxDays >= 1) patch.shareMaxDays = Math.min(365, req.body.shareMaxDays)
  if (typeof req.body.backupEnabled === 'boolean') patch.backupEnabled = req.body.backupEnabled
  if (Number.isInteger(req.body.backupRetention) && req.body.backupRetention >= 1) patch.backupRetention = Math.min(100, req.body.backupRetention)
  if (Number.isInteger(req.body.logRetentionDays) && req.body.logRetentionDays >= 1) patch.logRetentionDays = Math.min(3650, req.body.logRetentionDays)
  if (typeof req.body.mdnsEnabled === 'boolean') patch.mdnsEnabled = req.body.mdnsEnabled
  if (req.body.clearPassword === true) Object.assign(patch, { passwordHash: '', passwordSalt: '' })
  else if (typeof req.body.newPassword === 'string' && req.body.newPassword.length >= 8) {
    const { hash, salt } = hashPassword(req.body.newPassword)
    Object.assign(patch, { passwordHash: hash, passwordSalt: salt })
  }
  if (typeof req.body.newAdminPassword === 'string' && req.body.newAdminPassword.length >= 10) {
    const { hash, salt } = hashPassword(req.body.newAdminPassword)
    Object.assign(patch, { adminPasswordHash: hash, adminPasswordSalt: salt })
  }
  const updated = saveConfig(patch)
  audit(req, 'admin', 'settings.updated', '', { fields: Object.keys(patch).filter((key) => !key.toLowerCase().includes('password')) })
  res.json({ ...publicConfig(), restartRequired: (patch.port !== undefined && Number(patch.port) !== previousPort) || Boolean(patch.storagePath) || patch.mdnsEnabled !== undefined, saved: Boolean(updated) })
})

app.get('/api/admin/devices', requireAdmin, (req, res) => {
  const devices = rows<any>('SELECT id,nickname,device_name,avatar,last_ip,last_seen,approved,blocked,first_seen,approved_at,approved_by FROM devices ORDER BY last_seen DESC')
  res.json(devices.map((device) => ({ id: device.id, nickname: device.nickname, deviceName: device.device_name,
    avatar: device.avatar, ip: device.last_ip, lastSeen: Number(device.last_seen), online: liveDevices.has(device.id),
    approved: Boolean(device.approved), blocked: Boolean(device.blocked), firstSeen: Number(device.first_seen || 0),
    approvedAt: device.approved_at ? Number(device.approved_at) : undefined, approvedBy: device.approved_by || undefined })))
})

app.patch('/api/admin/devices/:id', requireAdmin, (req, res) => {
  const id = String(req.params.id)
  const device = dbDevice(id)
  if (!device) return res.status(404).json({ error: '设备不存在' })
  if (req.body.action === 'approve') {
    run('UPDATE devices SET approved=1,blocked=0,approved_at=?,approved_by=? WHERE id=?', Date.now(), 'admin', id)
    io.to(`device:${id}`).emit('device:approved')
  } else if (req.body.action === 'block') {
    run('UPDATE devices SET approved=0,blocked=1 WHERE id=?', id)
    liveDevices.delete(id)
    io.to(`device:${id}`).emit('device:blocked')
    for (const socket of io.sockets.sockets.values()) if (socket.rooms.has(`device:${id}`)) socket.disconnect(true)
    emitPresence()
  } else return res.status(400).json({ error: '设备操作无效' })
  audit(req, 'admin', `device.${req.body.action}`, id)
  res.json({ ok: true })
})

app.get('/api/admin/backups', requireAdmin, (req, res) => res.json(listBackups()))

app.post('/api/admin/backups', requireAdmin, (req, res) => {
  const backup = createBackup()
  audit(req, 'admin', 'backup.created', backup.name)
  res.status(201).json(backup)
})

app.post('/api/admin/backups/:name/download-link', requireAdmin, (req, res) => {
  const name = String(req.params.name)
  if (!backupFile(name)) return res.status(404).json({ error: '备份不存在' })
  const token = signToken({ scope: 'backup', backupName: name, exp: Date.now() + 60_000 })
  res.json({ path: `/admin-download/${token}`, expiresAt: Date.now() + 60_000 })
})

app.get('/api/admin/backups/:name/download', requireAdmin, (req, res) => {
  const file = backupFile(String(req.params.name))
  if (!file) return res.status(404).json({ error: '备份不存在' })
  const stat = fs.statSync(file)
  res.setHeader('Content-Type', 'application/vnd.sqlite3')
  res.setHeader('Content-Length', String(stat.size))
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`)
  fs.createReadStream(file).pipe(res)
})

app.get('/admin-download/:token', rateLimit('backup-download', 30, 60_000), (req, res) => {
  const payload = verifyToken(String(req.params.token), 'backup')
  if (!payload?.backupName) return res.status(403).send('备份下载链接无效或已过期')
  const file = backupFile(payload.backupName)
  if (!file) return res.status(404).send('备份不存在')
  const stat = fs.statSync(file)
  res.setHeader('Content-Type', 'application/vnd.sqlite3')
  res.setHeader('Content-Length', String(stat.size))
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`)
  fs.createReadStream(file).pipe(res)
})

app.post('/api/admin/backups/restore', requireAdmin, express.raw({ type: 'application/octet-stream', limit: '512mb' }), (req, res) => {
  if (!Buffer.isBuffer(req.body) || req.body.length < 1024) return res.status(400).json({ error: '备份文件无效' })
  queueRestore(req.body)
  audit(req, 'admin', 'backup.restore.queued', '', { size: req.body.length })
  res.json({ ok: true, restartRequired: true })
})

app.get('/api/admin/audit', requireAdmin, (req, res) => {
  const logs = rows<any>('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 500')
  res.json(logs.map((item) => ({ id: item.id, actorId: item.actor_id, action: item.action, target: item.target,
    ip: item.ip, detail: item.detail, createdAt: Number(item.created_at) })))
})

io.use((socket, next) => {
  const ip = cleanIp(socket.handshake.address)
  if (!isAllowedIp(ip)) return next(new Error('IP 不在允许范围'))
  const token = typeof socket.handshake.auth.token === 'string' ? socket.handshake.auth.token : undefined
  if (config.passwordHash && !verifyToken(token, 'access')) return next(new Error('未授权'))
  next()
})

io.on('connection', (socket) => {
  let currentDeviceId = ''
  socket.on('device:register', (payload: any, ack?: (result: unknown) => void) => {
    const id = String(payload?.id || '').slice(0, 100)
    const deviceKey = String(payload?.deviceKey || '')
    if (!id || deviceKey.length < 32) return ack?.({ error: '设备标识无效' })
    if (!allowSocketAction(cleanIp(socket.handshake.address), 'register', 20, 60_000)) return ack?.({ error: '注册请求过于频繁' })
    const authHash = crypto.createHash('sha256').update(deviceKey).digest('hex')
    const existing = dbDevice(id)
    if (existing?.auth_hash && existing.auth_hash !== authHash) return ack?.({ error: '该设备标识已由另一台设备使用' })
    if (existing?.blocked) return ack?.({ error: '该设备已被管理员阻止' })
    const now = Date.now()
    const approved = existing ? (Boolean(existing.approved) || !config.requireDeviceApproval) : !config.requireDeviceApproval
    const device: Device = {
      id, nickname: String(payload.nickname || '局域网用户').trim().slice(0, 30),
      deviceName: String(payload.deviceName || '浏览器设备').trim().slice(0, 60),
      avatar: String(payload.avatar || '').slice(0, 150000), ip: cleanIp(socket.handshake.address), online: approved, lastSeen: now,
      encryptionPublicKey: String(payload.encryptionPublicKey || '').slice(0, 2000)
    }
    run(`INSERT INTO devices(id,nickname,device_name,avatar,last_ip,last_seen,auth_hash,approved,blocked,first_seen,encryption_public_key) VALUES(?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET nickname=excluded.nickname,device_name=excluded.device_name,
      avatar=excluded.avatar,last_ip=excluded.last_ip,last_seen=excluded.last_seen,
      auth_hash=CASE WHEN devices.auth_hash='' THEN excluded.auth_hash ELSE devices.auth_hash END,
      encryption_public_key=CASE WHEN excluded.encryption_public_key='' THEN devices.encryption_public_key ELSE excluded.encryption_public_key END`,
      id, device.nickname, device.deviceName, device.avatar, device.ip, device.lastSeen, authHash, approved ? 1 : 0, 0, now, device.encryptionPublicKey || '')
    void socket.join(`device:${id}`)
    if (!approved) {
      writeLog('security', 'device.pending', { deviceId: id, ip: device.ip })
      return ack?.({ ok: false, pending: true, device: { ...device, online: false } })
    }
    currentDeviceId = id
    liveDevices.set(id, device)
    void socket.join('room:lobby')
    const memberships = rows<{ room_id: string }>('SELECT room_id FROM room_members WHERE device_id = ?', id)
    for (const membership of memberships) void socket.join(`room:${membership.room_id}`)
    emitPresence()
    const deviceToken = signToken({ scope: 'device', deviceId: id, exp: Date.now() + 24 * 60 * 60 * 1000 })
    ack?.({ ok: true, device, deviceToken })
  })

  socket.on('message:send', (payload: any, ack?: (result: unknown) => void) => {
    try {
      if (!currentDeviceId) throw new Error('设备尚未注册')
      if (!allowSocketAction(currentDeviceId, 'message', 90, 60_000)) throw new Error('消息发送过于频繁')
      const messageType = payload?.type === 'encrypted' ? 'encrypted' : 'text'
      const content = String(payload?.content || '').trim().slice(0, messageType === 'encrypted' ? 30000 : 10000)
      if (!content) throw new Error('消息不能为空')
      const roomId = normalizeRoomId(String(payload.roomId || 'lobby'), currentDeviceId)
      if (!canUseRoom(roomId, currentDeviceId)) throw new Error('无权访问此会话')
      const replyTo = String(payload?.replyTo || '')
      const reply = replyTo ? row<any>('SELECT id,sender_name,content FROM messages WHERE id=? AND room_id=? AND deleted_at IS NULL', replyTo, roomId) : undefined
      if (replyTo && !reply) throw new Error('引用的消息不存在')
      const device = liveDevices.get(currentDeviceId) || dbDevice(currentDeviceId)
      const message: Message = {
        id: crypto.randomUUID(), roomId, senderId: currentDeviceId, senderName: device?.nickname || '局域网用户',
        type: messageType, content, createdAt: Date.now(), replyTo: reply?.id,
        reply: reply ? { id: reply.id, senderName: reply.sender_name, content: reply.content } : undefined
      }
      run('INSERT INTO messages(id,room_id,sender_id,sender_name,type,content,reply_to,created_at) VALUES(?,?,?,?,?,?,?,?)',
        message.id, message.roomId, message.senderId, message.senderName, message.type, message.content, message.replyTo || null, message.createdAt)
      emitToRoom(roomId, 'message:new', message)
      ack?.({ ok: true, message })
    } catch (error) { ack?.({ error: error instanceof Error ? error.message : '发送失败' }) }
  })

  socket.on('message:delete', (payload: any, ack?: (result: unknown) => void) => {
    try {
      if (!currentDeviceId) throw new Error('设备尚未注册')
      const message = row<any>('SELECT * FROM messages WHERE id=?', String(payload?.messageId || ''))
      if (!message || !canUseRoom(message.room_id, currentDeviceId)) throw new Error('消息不存在')
      const ownWindow = message.sender_id === currentDeviceId && Date.now() - Number(message.created_at) <= 10 * 60_000
      if (!ownWindow && !isRoomAdmin(message.room_id, currentDeviceId)) throw new Error('只能在 10 分钟内撤回自己的消息')
      const deletedAt = Date.now()
      run("UPDATE messages SET content='消息已撤回',deleted_at=? WHERE id=? AND deleted_at IS NULL", deletedAt, message.id)
      emitToRoom(message.room_id, 'message:deleted', { roomId: message.room_id, messageId: message.id, deletedAt })
      ack?.({ ok: true })
    } catch (error) { ack?.({ error: error instanceof Error ? error.message : '撤回失败' }) }
  })

  socket.on('reaction:toggle', (payload: any, ack?: (result: unknown) => void) => {
    try {
      if (!currentDeviceId) throw new Error('设备尚未注册')
      const message = row<any>('SELECT id,room_id FROM messages WHERE id=? AND deleted_at IS NULL', String(payload?.messageId || ''))
      const emoji = String(payload?.emoji || '').trim().slice(0, 12)
      if (!message || !emoji || !canUseRoom(message.room_id, currentDeviceId)) throw new Error('回应无效')
      const existing = row('SELECT 1 FROM message_reactions WHERE message_id=? AND device_id=? AND emoji=?', message.id, currentDeviceId, emoji)
      if (existing) run('DELETE FROM message_reactions WHERE message_id=? AND device_id=? AND emoji=?', message.id, currentDeviceId, emoji)
      else run('INSERT INTO message_reactions(message_id,device_id,emoji,created_at) VALUES(?,?,?,?)', message.id, currentDeviceId, emoji, Date.now())
      emitToRoom(message.room_id, 'message:reaction', { roomId: message.room_id, messageId: message.id, emoji, deviceId: currentDeviceId, active: !existing })
      ack?.({ ok: true, active: !existing })
    } catch (error) { ack?.({ error: error instanceof Error ? error.message : '回应失败' }) }
  })

  socket.on('read:update', (payload: any) => {
    if (!currentDeviceId) return
    try {
      const roomId = normalizeRoomId(String(payload?.roomId || ''), currentDeviceId)
      if (!canUseRoom(roomId, currentDeviceId)) return
      const lastReadAt = Math.min(Date.now(), Math.max(0, Number(payload?.lastReadAt) || Date.now()))
      run(`INSERT INTO read_receipts(room_id,device_id,last_read_at) VALUES(?,?,?)
        ON CONFLICT(room_id,device_id) DO UPDATE SET last_read_at=MAX(read_receipts.last_read_at,excluded.last_read_at)`, roomId, currentDeviceId, lastReadAt)
      emitToRoom(roomId, 'message:read', { roomId, deviceId: currentDeviceId, lastReadAt })
    } catch { /* invalid room */ }
  })

  socket.on('typing', (payload: any) => {
    if (!currentDeviceId) return
    try {
      const roomId = normalizeRoomId(String(payload?.roomId || ''), currentDeviceId)
      if (!canUseRoom(roomId, currentDeviceId)) return
      const device = liveDevices.get(currentDeviceId)
      emitToRoom(roomId, 'typing', { roomId, deviceId: currentDeviceId, nickname: device?.nickname, typing: Boolean(payload.typing) })
    } catch { /* invalid room */ }
  })

  socket.on('room:create', (payload: any, ack?: (result: any) => void) => {
    if (!currentDeviceId) return ack?.({ error: '设备尚未注册' })
    const name = String(payload?.name || '').trim().slice(0, 40)
    const members = [...new Set([currentDeviceId, ...(Array.isArray(payload?.members) ? payload.members.map(String) : [])])]
    if (!name || members.length < 2) return ack?.({ error: '群聊名称和成员不能为空' })
    const id = `group:${crypto.randomUUID()}`; const createdAt = Date.now()
    db.exec('BEGIN')
    try {
      run("INSERT INTO rooms(id,name,type,creator_id,created_at) VALUES(?,?,'group',?,?)", id, name, currentDeviceId, createdAt)
      for (const member of members) run('INSERT INTO room_members(room_id,device_id,role) VALUES(?,?,?)', id, member, member === currentDeviceId ? 'admin' : 'member')
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); return ack?.({ error: error instanceof Error ? error.message : '创建失败' }) }
    for (const member of members) for (const memberSocket of io.sockets.sockets.values()) {
      if (memberSocket.rooms.has(`device:${member}`)) void memberSocket.join(`room:${id}`)
    }
    const room = { id, name, type: 'group', members, admins: [currentDeviceId], createdAt }
    for (const member of members) io.to(`device:${member}`).emit('room:new', room)
    ack?.({ ok: true, room })
  })

  socket.on('room:update', (payload: any, ack?: (result: unknown) => void) => {
    try {
      if (!currentDeviceId) throw new Error('设备尚未注册')
      const roomId = String(payload?.roomId || '')
      if (!roomId.startsWith('group:') || !isRoomAdmin(roomId, currentDeviceId)) throw new Error('需要群管理员权限')
      const action = String(payload?.action || '')
      if (action === 'rename') {
        const name = String(payload?.name || '').trim().slice(0, 40)
        if (!name) throw new Error('群名称不能为空')
        run('UPDATE rooms SET name=? WHERE id=?', name, roomId)
      } else if (action === 'add') {
        const deviceId = String(payload?.deviceId || '')
        const device = dbDevice(deviceId)
        if (!device || device.blocked) throw new Error('设备不存在或已被阻止')
        run("INSERT OR IGNORE INTO room_members(room_id,device_id,role) VALUES(?,?,'member')", roomId, deviceId)
        for (const memberSocket of io.sockets.sockets.values()) if (memberSocket.rooms.has(`device:${deviceId}`)) void memberSocket.join(`room:${roomId}`)
      } else if (action === 'remove') {
        const deviceId = String(payload?.deviceId || '')
        if (deviceId === currentDeviceId) throw new Error('请使用退出群聊功能')
        run('DELETE FROM room_members WHERE room_id=? AND device_id=?', roomId, deviceId)
        for (const memberSocket of io.sockets.sockets.values()) if (memberSocket.rooms.has(`device:${deviceId}`)) void memberSocket.leave(`room:${roomId}`)
        io.to(`device:${deviceId}`).emit('room:removed', roomId)
      } else if (action === 'promote') {
        run("UPDATE room_members SET role='admin' WHERE room_id=? AND device_id=?", roomId, String(payload?.deviceId || ''))
      } else throw new Error('群操作无效')
      const dto = groupRoomDto(roomId)
      if (!dto) throw new Error('群聊不存在')
      emitToRoom(roomId, 'room:updated', dto)
      audit({ socket: { remoteAddress: socket.handshake.address } } as Request, currentDeviceId, `room.${action}`, roomId)
      ack?.({ ok: true, room: dto })
    } catch (error) { ack?.({ error: error instanceof Error ? error.message : '群聊更新失败' }) }
  })

  socket.on('room:leave', (payload: any, ack?: (result: unknown) => void) => {
    try {
      if (!currentDeviceId) throw new Error('设备尚未注册')
      const roomId = String(payload?.roomId || '')
      if (!roomId.startsWith('group:')) throw new Error('只能退出群聊')
      const membership = row<any>('SELECT role FROM room_members WHERE room_id=? AND device_id=?', roomId, currentDeviceId)
      if (!membership) throw new Error('你不在该群聊中')
      const transferTo = String(payload?.transferTo || '')
      db.exec('BEGIN')
      try {
        if (membership.role === 'admin') {
          const admins = Number(row<{ count: number }>("SELECT COUNT(*) count FROM room_members WHERE room_id=? AND role='admin'", roomId)?.count || 0)
          if (admins <= 1) {
            if (!transferTo) throw new Error('请选择一位群成员接任管理员，或解散群聊')
            if (transferTo === currentDeviceId) throw new Error('不能将管理员移交给自己')
            const successor = row('SELECT 1 FROM room_members WHERE room_id=? AND device_id=?', roomId, transferTo)
            if (!successor) throw new Error('接任管理员不在该群聊中')
            run("UPDATE room_members SET role='admin' WHERE room_id=? AND device_id=?", roomId, transferTo)
          }
        }
        run('DELETE FROM room_members WHERE room_id=? AND device_id=?', roomId, currentDeviceId)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      const dto = groupRoomDto(roomId)
      for (const memberSocket of io.sockets.sockets.values()) {
        if (memberSocket.rooms.has(`device:${currentDeviceId}`)) void memberSocket.leave(`room:${roomId}`)
      }
      io.to(`device:${currentDeviceId}`).emit('room:removed', roomId)
      for (const memberId of dto?.members || []) {
        io.to(`device:${memberId}`).emit('room:updated', dto)
        io.to(`device:${memberId}`).emit('room:member-left', { roomId, deviceId: currentDeviceId })
      }
      audit({ socket: { remoteAddress: socket.handshake.address } } as Request, currentDeviceId, 'room.leave', roomId,
        transferTo ? { transferredAdminTo: transferTo } : {})
      ack?.({ ok: true, room: dto })
    } catch (error) { ack?.({ error: error instanceof Error ? error.message : '退出失败' }) }
  })

  socket.on('room:delete', (payload: any, ack?: (result: unknown) => void) => {
    try {
      if (!currentDeviceId) throw new Error('设备尚未注册')
      const roomId = String(payload?.roomId || '')
      if (!roomId.startsWith('group:') || !isRoomAdmin(roomId, currentDeviceId)) throw new Error('只有群管理员可以解散群聊')
      const memberIds = roomRecipients(roomId)
      const deletedMessages = Number(row<{ count: number }>('SELECT COUNT(*) count FROM messages WHERE room_id=?', roomId)?.count || 0)
      db.exec('BEGIN')
      try {
        run('DELETE FROM read_receipts WHERE room_id=?', roomId)
        run('DELETE FROM messages WHERE room_id=?', roomId)
        run('DELETE FROM rooms WHERE id=?', roomId)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      for (const memberId of memberIds) io.to(`device:${memberId}`).emit('room:removed', roomId)
      for (const memberSocket of io.sockets.sockets.values()) void memberSocket.leave(`room:${roomId}`)
      audit({ socket: { remoteAddress: socket.handshake.address } } as Request, currentDeviceId, 'room.delete', roomId,
        { memberCount: memberIds.length, deletedMessages })
      ack?.({ ok: true, deletedMessages })
    } catch (error) { ack?.({ error: error instanceof Error ? error.message : '解散失败' }) }
  })

  socket.on('rtc:signal', (payload: any) => {
    if (!currentDeviceId || !allowSocketAction(currentDeviceId, 'rtc', 300, 60_000)) return
    const targetId = String(payload?.targetId || '')
    if (!targetId || targetId === currentDeviceId || !liveDevices.has(targetId)) return
    io.to(`device:${targetId}`).emit('rtc:signal', { sourceId: currentDeviceId, data: payload?.data })
  })

  socket.on('disconnect', () => {
    if (!currentDeviceId) return
    const hasOtherSocket = [...io.sockets.sockets.values()].some((item) => item.rooms.has(`device:${currentDeviceId}`))
    if (!hasOtherSocket) liveDevices.delete(currentDeviceId)
    emitPresence()
  })
})

function cleanupHistory() {
  const now = Date.now()
  const historyCutoff = config.retentionDays > 0 ? now - config.retentionDays * 86400000 : 0
  const uploadCutoff = now - 24 * 60 * 60 * 1000
  const expired = rows<any>(`SELECT * FROM files WHERE
    (status IN ('uploading','finalizing') AND created_at < ?) OR (? > 0 AND created_at < ?)`, uploadCutoff, historyCutoff, historyCutoff)
  for (const file of expired) {
    try { fs.rmSync(path.join(config.storagePath, file.stored_name), { force: true }) } catch { /* retry next cycle */ }
  }
  if (historyCutoff) run('DELETE FROM messages WHERE created_at < ?', historyCutoff)
  run(`DELETE FROM files WHERE (status IN ('uploading','finalizing') AND created_at < ?) OR (? > 0 AND created_at < ?)`, uploadCutoff, historyCutoff, historyCutoff)
  run('DELETE FROM file_shares WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)', now, now - 30 * 86400000)
  cleanupLogs(config.logRetentionDays)
}
cleanupHistory()
setInterval(cleanupHistory, 6 * 60 * 60 * 1000).unref()
setInterval(() => {
  if (!config.backupEnabled) return
  try { createBackup(); writeLog('info', 'backup.automatic.created') }
  catch (error) { writeLog('error', 'backup.automatic.failed', { message: error instanceof Error ? error.message : String(error) }) }
}, 24 * 60 * 60 * 1000).unref()

const distPath = path.resolve(process.cwd(), 'dist')
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath, { maxAge: '1h', index: false }))
  app.get('/{*path}', (req, res) => res.sendFile(path.join(distPath, 'index.html')))
}

app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(error)
  writeLog('error', 'request.failed', { method: req.method, path: req.path, ip: cleanIp(req.socket.remoteAddress), message: error.message })
  if (res.headersSent) return next(error)
  res.status(500).json({ error: error.message || '服务器内部错误' })
})

async function availablePort(preferred: number) {
  for (let port = preferred; port < preferred + 20 && port <= 65535; port++) {
    const free = await new Promise<boolean>((resolve) => {
      const tester = net.createServer().once('error', () => resolve(false)).once('listening', () => tester.close(() => resolve(true))).listen(port, '0.0.0.0')
    })
    if (free) return port
  }
  throw new Error(`端口 ${preferred}-${preferred + 19} 均不可用`)
}

const selectedPort = await availablePort(config.port)
if (selectedPort !== config.port) saveConfig({ port: selectedPort })
fs.mkdirSync(config.storagePath, { recursive: true })
httpServer.listen(selectedPort, '0.0.0.0', () => {
  console.log(`\nLoadChat 已启动：`)
  console.log(`  本机：${tlsEnabled ? 'https' : 'http'}://localhost:${selectedPort}`)
  for (const address of lanAddresses(selectedPort, tlsEnabled ? 'https' : 'http')) console.log(`  局域网：${address}`)
  console.log(`  数据目录：${config.storagePath}\n`)
  startMdns(config.serverName, selectedPort, config.mdnsEnabled)
  writeLog('info', 'server.started', { version: APP_VERSION, port: selectedPort, tlsEnabled, storagePath: config.storagePath })
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
  stopMdns()
  httpServer.close(() => process.exit(0))
})
