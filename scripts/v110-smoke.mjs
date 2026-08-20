import fs from 'node:fs'
import { io } from 'socket.io-client'

const base = process.argv[2] || 'http://127.0.0.1:3214'
const password = 'LoadChat-admin-test-2026' // publication-allow: fixed local integration-test credential
const source = fs.readFileSync(new URL('../README.md', import.meta.url))
const suffix = Date.now().toString(36)

const json = async (response) => ({ response, body: await response.json().catch(() => ({})) })
const request = (path, init = {}) => fetch(`${base}${path}`, init).then(json)
const emit = (socket, event, payload) => new Promise((resolve, reject) => socket.emit(event, payload, (result) => result?.error ? reject(new Error(result.error)) : resolve(result)))
const connect = (socket) => new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject) })

const clients = ['a', 'b', 'c'].map((name) => io(base, { transports: ['websocket'], autoConnect: name !== 'c' }))
const [clientA, clientB, clientC] = clients
const ids = { a: `v110-a-${suffix}`, b: `v110-b-${suffix}`, c: `v110-c-${suffix}` }
const keys = { a: `${ids.a}-device-key-${crypto.randomUUID()}`, b: `${ids.b}-device-key-${crypto.randomUUID()}`, c: `${ids.c}-device-key-${crypto.randomUUID()}` }
const tokens = {}
let fileId = ''

try {
  await Promise.all([connect(clientA), connect(clientB)])
  for (const [name, socket] of [['a', clientA], ['b', clientB]]) {
    const result = await emit(socket, 'device:register', { id: ids[name], deviceKey: keys[name], nickname: `V110 ${name.toUpperCase()}`, deviceName: 'Smoke browser' })
    tokens[name] = result.deviceToken
  }

  const setup = await request('/api/admin/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
  if (!setup.response.ok) {
    const login = await request('/api/admin/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
    if (!login.response.ok) throw new Error(`admin setup/login failed: ${JSON.stringify(login.body)}`)
    setup.body = login.body
  }
  const adminHeaders = { 'Content-Type': 'application/json', 'X-Admin-Token': setup.body.token }
  const wrongAdmin = await request('/api/admin/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'definitely-wrong' }) })
  const approvalSetting = await request('/api/admin/settings', { method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ requireDeviceApproval: true }) })
  if (!approvalSetting.response.ok) throw new Error(`approval setting failed: ${JSON.stringify(approvalSetting.body)}`)

  clientC.connect(); await connect(clientC)
  const pending = await emit(clientC, 'device:register', { id: ids.c, deviceKey: keys.c, nickname: 'V110 C', deviceName: 'Pending browser' })
  const devices = await request('/api/admin/devices', { headers: { 'X-Admin-Token': setup.body.token } })
  const approve = await request(`/api/admin/devices/${encodeURIComponent(ids.c)}`, { method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ action: 'approve' }) })
  if (!approve.response.ok) throw new Error(`approve failed: ${JSON.stringify(approve.body)}`)
  const registeredC = await emit(clientC, 'device:register', { id: ids.c, deviceKey: keys.c, nickname: 'V110 C', deviceName: 'Approved browser' })
  tokens.c = registeredC.deviceToken

  const roomId = `dm:${[ids.a, ids.b].sort().join(':')}`
  const init = await request('/api/uploads/init', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Token': tokens.a },
    body: JSON.stringify({ name: `v110-${suffix}.md`, size: source.length, type: 'text/markdown', chunkSize: 4 * 1024 * 1024,
      totalChunks: 1, senderId: ids.a, roomId, uploadKey: `v110-${suffix}` })
  })
  if (!init.response.ok) throw new Error(`upload init failed: ${JSON.stringify(init.body)}`)
  fileId = init.body.id
  const wrongChunk = await request(`/api/uploads/${fileId}/chunks/0`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'X-Device-Token': tokens.b }, body: source })
  const rightChunk = await request(`/api/uploads/${fileId}/chunks/0`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'X-Device-Token': tokens.a }, body: source })
  const files = await request(`/api/files?deviceId=${encodeURIComponent(ids.a)}&search=${encodeURIComponent(`v110-${suffix}`)}`, { headers: { 'X-Device-Token': tokens.a } })
  const completed = files.body[0]

  const shareOne = await request(`/api/files/${fileId}/share`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Token': tokens.a }, body: JSON.stringify({ deviceId: ids.a, maxDownloads: 1, expiresIn: 3600000 }) })
  const firstShare = await fetch(`${base}${shareOne.body.path}`); await firstShare.arrayBuffer()
  const secondShare = await fetch(`${base}${shareOne.body.path}`); await secondShare.arrayBuffer()
  const shareRevoked = await request(`/api/files/${fileId}/share`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Token': tokens.a }, body: JSON.stringify({ deviceId: ids.a, expiresIn: 3600000 }) })
  await request(`/api/files/${fileId}/shares/${shareRevoked.body.id}?deviceId=${encodeURIComponent(ids.a)}`, { method: 'DELETE', headers: { 'X-Device-Token': tokens.a } })
  const revokedShare = await fetch(`${base}${shareRevoked.body.path}`); await revokedShare.arrayBuffer()

  const zipQuery = new URLSearchParams({ ids: fileId, deviceId: ids.a, deviceToken: tokens.a })
  const zipResponse = await fetch(`${base}/api/files/download-zip?${zipQuery}`)
  const zipBytes = new Uint8Array(await zipResponse.arrayBuffer())

  const firstMessage = await emit(clientA, 'message:send', { roomId, content: 'Smoke root message' })
  const replyMessage = await emit(clientB, 'message:send', { roomId, content: 'Smoke reply', replyTo: firstMessage.message.id })
  const reaction = await emit(clientA, 'reaction:toggle', { messageId: replyMessage.message.id, emoji: '👍' })
  const deletion = await emit(clientA, 'message:delete', { messageId: firstMessage.message.id })

  const backup = await request('/api/admin/backups', { method: 'POST', headers: { 'X-Admin-Token': setup.body.token } })
  const backupList = await request('/api/admin/backups', { headers: { 'X-Admin-Token': setup.body.token } })
  const backupLink = await request(`/api/admin/backups/${encodeURIComponent(backup.body.name)}/download-link`, { method: 'POST', headers: adminHeaders })
  const backupDownload = await fetch(`${base}${backupLink.body.path}`)
  await backupDownload.arrayBuffer()

  const result = {
    admin: { wrongPassword: wrongAdmin.response.status, setup: setup.response.status, auditProtected: approvalSetting.response.status },
    approval: { pending: Boolean(pending.pending), listed: devices.body.some((device) => device.id === ids.c && !device.approved), approved: Boolean(tokens.c) },
    upload: { wrongChunk: wrongChunk.response.status, rightChunk: rightChunk.response.status, sha256: completed?.sha256?.length || 0 },
    share: { first: firstShare.status, second: secondShare.status, revoked: revokedShare.status },
    zip: { status: zipResponse.status, magic: String.fromCharCode(...zipBytes.slice(0, 2)) },
    messages: { reply: replyMessage.message.reply?.content, reaction: reaction.active, deleted: deletion.ok },
    backup: { created: backup.response.status, listed: backupList.body.some((item) => item.name === backup.body.name), downloaded: backupDownload.status }
  }
  const valid = result.admin.wrongPassword === 401 && [200, 201].includes(result.admin.setup) && result.admin.auditProtected === 200 &&
    result.approval.pending && result.approval.listed && result.approval.approved && result.upload.wrongChunk === 403 &&
    result.upload.rightChunk === 200 && result.upload.sha256 === 64 && result.share.first === 200 && result.share.second === 403 &&
    result.share.revoked === 403 && result.zip.status === 200 && result.zip.magic === 'PK' && result.messages.reply === 'Smoke root message' &&
    result.messages.reaction && result.messages.deleted && result.backup.created === 201 && result.backup.listed && result.backup.downloaded === 200
  if (!valid) throw new Error(`v1.1 assertion failed: ${JSON.stringify(result)}`)
  console.log(JSON.stringify(result))
} finally {
  if (fileId && tokens.a) await fetch(`${base}/api/files/${fileId}?deviceId=${encodeURIComponent(ids.a)}`, { method: 'DELETE', headers: { 'X-Device-Token': tokens.a } }).catch(() => {})
  clients.forEach((client) => client.disconnect())
}
