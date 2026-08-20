import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { config, dataPath } from './config.js'
import { databasePath, db } from './db.js'

const backupsPath = path.join(dataPath, 'backups')

export type BackupInfo = { name: string; size: number; createdAt: number }

export function createBackup() {
  fs.mkdirSync(backupsPath, { recursive: true })
  db.exec('PRAGMA wal_checkpoint(PASSIVE)')
  const name = `loadchat-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`
  const target = path.join(backupsPath, name)
  const escaped = target.replace(/'/g, "''")
  db.exec(`VACUUM INTO '${escaped}'`)
  cleanupBackups()
  return backupInfo(name)
}

function backupInfo(name: string): BackupInfo {
  const stat = fs.statSync(path.join(backupsPath, name))
  return { name, size: stat.size, createdAt: stat.mtimeMs }
}

export function listBackups() {
  if (!fs.existsSync(backupsPath)) return []
  return fs.readdirSync(backupsPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^(loadchat-|pre-restore-).+\.sqlite$/.test(entry.name))
    .map((entry) => backupInfo(entry.name)).sort((a, b) => b.createdAt - a.createdAt)
}

export function backupFile(name: string) {
  if (!/^(loadchat-|pre-restore-)[a-zA-Z0-9._-]+\.sqlite$/.test(name)) return ''
  const target = path.join(backupsPath, name)
  return fs.existsSync(target) ? target : ''
}

export function queueRestore(buffer: Buffer) {
  fs.mkdirSync(dataPath, { recursive: true })
  const temporary = path.join(dataPath, `restore-${Date.now()}.tmp`)
  fs.writeFileSync(temporary, buffer, { flag: 'wx' })
  try {
    const candidate = new DatabaseSync(temporary, { readOnly: true })
    const integrity = candidate.prepare('PRAGMA integrity_check').get() as { integrity_check?: string }
    candidate.close()
    if (integrity?.integrity_check !== 'ok') throw new Error('数据库完整性检查失败')
    fs.copyFileSync(temporary, path.join(dataPath, 'restore-pending.sqlite'))
  } finally { fs.rmSync(temporary, { force: true }) }
}

export function cleanupBackups() {
  const keep = Math.max(1, config.backupRetention)
  for (const backup of listBackups().filter((item) => item.name.startsWith('loadchat-')).slice(keep)) {
    fs.rmSync(path.join(backupsPath, backup.name), { force: true })
  }
}

export function databaseSize() {
  try { return fs.statSync(databasePath).size } catch { return 0 }
}
