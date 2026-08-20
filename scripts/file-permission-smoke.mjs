import fs from 'node:fs'
import { io } from 'socket.io-client'

const base = process.argv[2] || 'http://127.0.0.1:3210'
const source = fs.readFileSync(new URL('../README.md', import.meta.url))
const runId = Date.now().toString(36)
const directName = `permission-direct-${runId}.md`
const groupFileName = `permission-group-${runId}.md`
const clients = ['permission-a', 'permission-b', 'permission-c'].map((id) => io(base, { transports: ['websocket'] }))
const [clientA, clientB, clientC] = clients
const deviceTokens = {}

const waitForConnect = (socket) => new Promise((resolve, reject) => {
  socket.once('connect', resolve)
  socket.once('connect_error', reject)
})
const emit = (socket, event, payload) => new Promise((resolve, reject) => {
  socket.emit(event, payload, (result) => result?.error ? reject(new Error(result.error)) : resolve(result))
})
const json = (response) => response.json().then((body) => ({ response, body }))

async function upload(roomId, name) {
  const initialized = await fetch(`${base}/api/uploads/init`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Token': deviceTokens['permission-a'] },
    body: JSON.stringify({ name, size: source.length, type: 'text/markdown', chunkSize: 4 * 1024 * 1024,
      totalChunks: 1, senderId: 'permission-a', roomId, uploadKey: `${name}-${Date.now()}` })
  }).then(json)
  if (!initialized.response.ok) throw new Error(`init failed: ${JSON.stringify(initialized.body)}`)
  const result = await fetch(`${base}/api/uploads/${initialized.body.id}/chunks/0`, {
    method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'X-Device-Token': deviceTokens['permission-a'] }, body: source
  }).then(json)
  if (!result.response.ok || !result.body.complete) throw new Error(`upload failed: ${JSON.stringify(result.body)}`)
  return initialized.body.id
}

async function list(deviceId, search) {
  const response = await fetch(`${base}/api/files?deviceId=${deviceId}&search=${encodeURIComponent(search)}`, { headers: { 'X-Device-Token': deviceTokens[deviceId] } })
  if (!response.ok) throw new Error(`list ${deviceId} failed: ${response.status}`)
  return response.json()
}

async function download(fileId, deviceId) {
  const response = await fetch(`${base}/api/files/${fileId}/download?deviceId=${deviceId}&deviceToken=${encodeURIComponent(deviceTokens[deviceId])}`)
  await response.arrayBuffer()
  return response.status
}

async function downloadWithToken(fileId, claimedDeviceId, tokenDeviceId) {
  const response = await fetch(`${base}/api/files/${fileId}/download?deviceId=${claimedDeviceId}&deviceToken=${encodeURIComponent(deviceTokens[tokenDeviceId])}`)
  await response.arrayBuffer()
  return response.status
}

async function remove(fileId, deviceId) {
  return fetch(`${base}/api/files/${fileId}?deviceId=${deviceId}`, { method: 'DELETE', headers: { 'X-Device-Token': deviceTokens[deviceId] } }).then((response) => response.status)
}

const seenByB = []
const seenByC = []
clientB.on('file:complete', (file) => seenByB.push(file.id))
clientC.on('file:complete', (file) => seenByC.push(file.id))

let groupId = ''
const createdFiles = []
try {
  await Promise.all(clients.map(waitForConnect))
  const registrations = await Promise.all([
    emit(clientA, 'device:register', { id: 'permission-a', deviceKey: 'permission-a-secret-key-for-smoke-test', nickname: '权限甲', deviceName: 'Test A' }),
    emit(clientB, 'device:register', { id: 'permission-b', deviceKey: 'permission-b-secret-key-for-smoke-test', nickname: '权限乙', deviceName: 'Test B' }),
    emit(clientC, 'device:register', { id: 'permission-c', deviceKey: 'permission-c-secret-key-for-smoke-test', nickname: '权限丙', deviceName: 'Test C' })
  ])
  deviceTokens['permission-a'] = registrations[0].deviceToken
  deviceTokens['permission-b'] = registrations[1].deviceToken
  deviceTokens['permission-c'] = registrations[2].deviceToken

  const directFile = await upload('dm:permission-a:permission-b', directName)
  createdFiles.push(directFile)
  await new Promise((resolve) => setTimeout(resolve, 150))
  const [directA, directB, directC] = await Promise.all([
    list('permission-a', directName), list('permission-b', directName), list('permission-c', directName)
  ])
  const directDownloads = await Promise.all([
    download(directFile, 'permission-a'), download(directFile, 'permission-b'), download(directFile, 'permission-c')
  ])
  const spoofedDownload = await downloadWithToken(directFile, 'permission-a', 'permission-c')
  const shareB = await fetch(`${base}/api/files/${directFile}/share`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Token': deviceTokens['permission-b'] }, body: JSON.stringify({ deviceId: 'permission-b' }) })
  const shareC = await fetch(`${base}/api/files/${directFile}/share`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Token': deviceTokens['permission-c'] }, body: JSON.stringify({ deviceId: 'permission-c' }) })
  const deleteByB = await remove(directFile, 'permission-b')
  const deleteByA = await remove(directFile, 'permission-a')
  createdFiles.splice(createdFiles.indexOf(directFile), 1)

  const group = await emit(clientA, 'room:create', { name: '权限测试群', members: ['permission-b'] })
  groupId = group.room.id
  const groupFile = await upload(groupId, groupFileName)
  createdFiles.push(groupFile)
  await new Promise((resolve) => setTimeout(resolve, 150))
  const [groupA, groupB, groupC] = await Promise.all([
    list('permission-a', groupFileName), list('permission-b', groupFileName), list('permission-c', groupFileName)
  ])
  const groupDownloads = await Promise.all([
    download(groupFile, 'permission-a'), download(groupFile, 'permission-b'), download(groupFile, 'permission-c')
  ])
  const groupDelete = await remove(groupFile, 'permission-a')
  createdFiles.splice(createdFiles.indexOf(groupFile), 1)

  const result = {
    groupId,
    direct: {
      listCounts: [directA.length, directB.length, directC.length], downloads: directDownloads,
      spoofedDownload,
      shareStatuses: [shareB.status, shareC.status], deleteStatuses: [deleteByB, deleteByA],
      eventVisibleToB: seenByB.includes(directFile), eventHiddenFromC: !seenByC.includes(directFile)
    },
    group: {
      listCounts: [groupA.length, groupB.length, groupC.length], downloads: groupDownloads,
      deleteStatus: groupDelete, eventVisibleToB: seenByB.includes(groupFile), eventHiddenFromC: !seenByC.includes(groupFile)
    }
  }
  const expected = JSON.stringify(result.direct.listCounts) === '[1,1,0]' && JSON.stringify(result.direct.downloads) === '[200,200,403]' &&
    result.direct.spoofedDownload === 403 &&
    JSON.stringify(result.direct.shareStatuses) === '[200,403]' && JSON.stringify(result.direct.deleteStatuses) === '[403,200]' &&
    result.direct.eventVisibleToB && result.direct.eventHiddenFromC && JSON.stringify(result.group.listCounts) === '[1,1,0]' &&
    JSON.stringify(result.group.downloads) === '[200,200,403]' && result.group.deleteStatus === 200 &&
    result.group.eventVisibleToB && result.group.eventHiddenFromC
  if (!expected) throw new Error(`permission assertion failed: ${JSON.stringify(result)}`)
  console.log(JSON.stringify(result))
} finally {
  for (const fileId of createdFiles) await remove(fileId, 'permission-a').catch(() => {})
  clients.forEach((client) => client.disconnect())
}
