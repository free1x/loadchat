import { api, getDeviceToken, getToken } from './api'
import { identity, loadFiles, state } from './state'
import type { FileInfo, TransferItem } from './types'

const CHUNK_SIZE = 4 * 1024 * 1024
const PARALLEL_CHUNKS = 3

function transferKey(file: File, roomId: string) {
  return `${identity.id}:${roomId}:${file.name}:${file.size}:${file.lastModified}`
}

export function enqueueFiles(fileList: FileList | File[]) {
  const files = Array.from(fileList)
  for (const file of files) {
    const key = transferKey(file, state.activeRoomId)
    let transfer = state.transfers[key]
    if (!transfer) {
      state.transfers[key] = {
        key, name: file.name, size: file.size, uploaded: 0, progress: 0, speed: 0,
        status: 'queued', direction: 'upload', file, roomId: state.activeRoomId, startedAt: Date.now(), paused: false
      }
      // Read it back from the reactive map so subsequent progress mutations
      // go through Vue's proxy and immediately update the transfer UI.
      transfer = state.transfers[key]
    } else { transfer.file = file; transfer.paused = false }
    void runUpload(transfer)
  }
}

export function pauseTransfer(key: string) {
  const transfer = state.transfers[key]
  if (transfer && transfer.status === 'uploading') { transfer.paused = true; transfer.status = 'paused' }
}

export function resumeTransfer(key: string) {
  const transfer = state.transfers[key]
  if (!transfer?.file) return
  transfer.paused = false
  void runUpload(transfer)
}

export function removeTransfer(key: string) {
  delete state.transfers[key]
}

async function runUpload(transfer: TransferItem) {
  if (!transfer.file || transfer.status === 'uploading' || transfer.status === 'complete') return
  const file = transfer.file
  transfer.status = 'uploading'; transfer.error = undefined; transfer.startedAt = Date.now()
  try {
    const session = await api<FileInfo>('/api/uploads/init', {
      method: 'POST', body: JSON.stringify({
        name: file.name, size: file.size, type: file.type, chunkSize: CHUNK_SIZE,
        totalChunks: Math.max(1, Math.ceil(file.size / CHUNK_SIZE)), senderId: identity.id,
        roomId: transfer.roomId, uploadKey: transfer.key
      })
    })
    transfer.uploadId = session.id
    if (session.status === 'complete') {
      Object.assign(transfer, { status: 'complete', progress: 100, uploaded: file.size, speed: 0 }); return
    }
    const status = await api<FileInfo & { uploaded: number[] }>(`/api/uploads/${session.id}/status`)
    const completed = new Set(status.uploaded)
    let uploadedBytes = [...completed].reduce((sum, index) => sum + Math.min(CHUNK_SIZE, file.size - index * CHUNK_SIZE), 0)
    transfer.uploaded = uploadedBytes; transfer.progress = file.size ? uploadedBytes / file.size * 100 : 100
    const queue = Array.from({ length: Math.max(1, Math.ceil(file.size / CHUNK_SIZE)) }, (_, i) => i).filter((index) => !completed.has(index))
    const started = performance.now(); let cursor = 0
    const worker = async () => {
      while (cursor < queue.length && !transfer.paused) {
        const index = queue[cursor++]
        const start = index * CHUNK_SIZE
        const blob = file.slice(start, Math.min(file.size, start + CHUNK_SIZE))
        const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' }
        const token = getToken(); if (token) headers.Authorization = `Bearer ${token}`
        const deviceToken = getDeviceToken(); if (deviceToken) headers['X-Device-Token'] = deviceToken
        const response = await fetch(`/api/uploads/${session.id}/chunks/${index}`, { method: 'PUT', headers, body: blob })
        if (!response.ok) {
          let error = `分片 ${index + 1} 上传失败`
          try { error = (await response.json()).error || error } catch { /* not JSON */ }
          throw new Error(error)
        }
        uploadedBytes += blob.size
        transfer.uploaded = uploadedBytes
        transfer.progress = file.size ? Math.min(100, uploadedBytes / file.size * 100) : 100
        transfer.speed = uploadedBytes / Math.max(0.1, (performance.now() - started) / 1000)
      }
    }
    await Promise.all(Array.from({ length: Math.min(PARALLEL_CHUNKS, queue.length || 1) }, worker))
    if (transfer.paused) { transfer.status = 'paused'; return }
    transfer.status = 'complete'; transfer.progress = 100; transfer.uploaded = file.size; transfer.speed = 0
    await loadFiles()
  } catch (error) {
    transfer.status = transfer.paused ? 'paused' : 'error'
    transfer.error = error instanceof Error ? error.message : '上传失败'
  }
}
