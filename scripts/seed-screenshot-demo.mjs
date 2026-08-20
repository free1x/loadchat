import fs from 'node:fs'
import { io } from 'socket.io-client'

const base = process.argv[2] || 'http://127.0.0.1:3218'
const demoIds = ['demo-design-mac', 'demo-meeting-ipad']
const peers = [
  { id: demoIds[0], nickname: '林夕的 MacBook', deviceName: '电脑 · macOS', key: 'loadchat-screenshot-design-device-key-2026' },
  { id: demoIds[1], nickname: '会议室 iPad', deviceName: '移动设备 · iPad', key: 'loadchat-screenshot-meeting-device-key-2026' }
]

const connect = (socket) => new Promise((resolve, reject) => {
  socket.once('connect', resolve)
  socket.once('connect_error', reject)
})
const emit = (socket, event, payload) => new Promise((resolve, reject) => {
  socket.emit(event, payload, (result) => result?.error ? reject(new Error(result.error)) : resolve(result))
})
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function upload(socket, token, senderId, roomId, name, mime, content) {
  const uploadKey = `screenshot-${senderId}-${name}`
  const initialized = await fetch(`${base}/api/uploads/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Token': token },
    body: JSON.stringify({ name, size: content.length, type: mime, chunkSize: 4 * 1024 * 1024, totalChunks: 1, senderId, roomId, uploadKey })
  })
  if (!initialized.ok) throw new Error(`upload init failed: ${await initialized.text()}`)
  const file = await initialized.json()
  const chunk = await fetch(`${base}/api/uploads/${file.id}/chunks/0`, {
    method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'X-Device-Token': token }, body: content
  })
  if (!chunk.ok) throw new Error(`upload chunk failed: ${await chunk.text()}`)
  await wait(120)
  return file
}

const sockets = peers.map(() => io(base, { transports: ['websocket'] }))
try {
  await Promise.all(sockets.map(connect))
  let devices = []
  sockets[0].on('devices:update', (value) => { devices = value })
  const registrations = []
  for (let index = 0; index < peers.length; index += 1) {
    registrations.push(await emit(sockets[index], 'device:register', { ...peers[index], deviceKey: peers[index].key, avatar: '' }))
  }

  let browserDevice
  for (let attempt = 0; attempt < 40; attempt += 1) {
    browserDevice = devices.find((device) => !demoIds.includes(device.id))
    if (browserDevice) break
    await wait(250)
  }
  if (!browserDevice) throw new Error('Open the demo URL in a browser before running this script.')

  const directRoom = `dm:${[peers[0].id, browserDevice.id].sort().join(':')}`
  await emit(sockets[0], 'message:send', { roomId: directRoom, content: '嗨，我把新版界面稿发过来了，点击图片可以直接查看大图。' })
  const svg = fs.readFileSync(new URL('../public/icon.svg', import.meta.url))
  await upload(sockets[0], registrations[0].deviceToken, peers[0].id, directRoom, 'LoadChat-界面预览.svg', 'image/svg+xml', svg)
  await emit(sockets[0], 'message:send', { roomId: directRoom, content: '文件已经通过 SHA-256 校验，分享链接只在局域网内有效。' })
  await emit(sockets[1], 'message:send', { roomId: 'lobby', content: '会议室设备已连接，下午评审可以开始啦 🎉' })

  const roomResult = await emit(sockets[0], 'room:create', { name: '产品设计小组', members: [browserDevice.id, peers[1].id] })
  await emit(sockets[0], 'message:send', { roomId: roomResult.room.id, content: '欢迎加入产品设计小组，这里集中同步设计稿和发布清单。' })
  await upload(sockets[0], registrations[0].deviceToken, peers[0].id, roomResult.room.id, '产品需求说明.md', 'text/markdown', Buffer.from('# LoadChat 1.1\n\n- 图片大图预览\n- 断点续传\n- 设备审批\n'))
  await upload(sockets[1], registrations[1].deviceToken, peers[1].id, 'lobby', 'v1.1.0-发布清单.txt', 'text/plain', Buffer.from('Build\nTypecheck\nSecurity scan\nPortable package\n'))
  console.log(JSON.stringify({ browserDevice: browserDevice.id, directRoom, group: roomResult.room.id }))
  if (process.argv.includes('--hold')) await new Promise((resolve) => process.once('SIGINT', resolve))
} finally {
  for (const socket of sockets) socket.disconnect()
}
