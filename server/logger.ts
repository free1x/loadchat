import fs from 'node:fs'
import path from 'node:path'
import { dataPath } from './config.js'

const logsPath = path.join(dataPath, 'logs')

export function writeLog(level: 'info' | 'warn' | 'error' | 'security', event: string, details: Record<string, unknown> = {}) {
  try {
    fs.mkdirSync(logsPath, { recursive: true })
    const day = new Date().toISOString().slice(0, 10)
    const entry = JSON.stringify({ time: new Date().toISOString(), level, event, ...details })
    fs.appendFileSync(path.join(logsPath, `loadchat-${day}.log`), `${entry}\n`, 'utf8')
  } catch { /* logging must never stop the server */ }
}

export function cleanupLogs(retentionDays: number) {
  if (!fs.existsSync(logsPath)) return
  const cutoff = Date.now() - Math.max(1, retentionDays) * 86400000
  for (const entry of fs.readdirSync(logsPath, { withFileTypes: true })) {
    if (!entry.isFile() || !/^loadchat-\d{4}-\d{2}-\d{2}\.log$/.test(entry.name)) continue
    const file = path.join(logsPath, entry.name)
    try { if (fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file, { force: true }) } catch { /* retry later */ }
  }
}
