import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AppConfig } from './types.js'

const appDataPath = path.resolve(process.env.LOADCHAT_DATA_DIR || path.join(process.cwd(), 'data'))
const configFile = path.join(appDataPath, 'config.json')

function defaults(): AppConfig {
  return {
    port: Number(process.env.PORT) || 3210,
    serverName: process.env.LOADCHAT_NAME || os.hostname(),
    storagePath: path.join(appDataPath, 'files'),
    passwordHash: '',
    passwordSalt: '',
    adminPasswordHash: '',
    adminPasswordSalt: '',
    tokenSecret: crypto.randomBytes(32).toString('hex'),
    allowedCidrs: [],
    retentionDays: 30,
    maxFileSize: 50 * 1024 * 1024 * 1024,
    maxStorageSize: 200 * 1024 * 1024 * 1024,
    minFreeSpace: 1024 * 1024 * 1024,
    maxConcurrentUploads: 4,
    maxDailyUploadBytes: 100 * 1024 * 1024 * 1024,
    requireDeviceApproval: false,
    shareMaxDays: 7,
    backupEnabled: true,
    backupRetention: 7,
    logRetentionDays: 14,
    mdnsEnabled: true
  }
}

function load(): AppConfig {
  fs.mkdirSync(appDataPath, { recursive: true, mode: 0o700 })
  const base = defaults()
  if (!fs.existsSync(configFile)) {
    fs.writeFileSync(configFile, JSON.stringify(base, null, 2), { mode: 0o600 })
    return base
  }
  try { fs.chmodSync(configFile, 0o600) } catch { /* Windows or restricted filesystem */ }
  try {
    const saved = JSON.parse(fs.readFileSync(configFile, 'utf8')) as Partial<AppConfig>
    return { ...base, ...saved, port: Number(process.env.PORT) || saved.port || base.port }
  } catch {
    return base
  }
}

export const dataPath = appDataPath
export let config = load()

export function saveConfig(patch: Partial<AppConfig>) {
  config = { ...config, ...patch }
  fs.mkdirSync(config.storagePath, { recursive: true })
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2))
  try { fs.chmodSync(configFile, 0o600) } catch { /* Windows or restricted filesystem */ }
  return config
}

export function publicConfig() {
  return {
    port: config.port,
    serverName: config.serverName,
    storagePath: config.storagePath,
    passwordEnabled: Boolean(config.passwordHash),
    adminPasswordEnabled: Boolean(config.adminPasswordHash),
    allowedCidrs: config.allowedCidrs,
    retentionDays: config.retentionDays,
    maxFileSize: config.maxFileSize,
    maxStorageSize: config.maxStorageSize,
    minFreeSpace: config.minFreeSpace,
    maxConcurrentUploads: config.maxConcurrentUploads,
    maxDailyUploadBytes: config.maxDailyUploadBytes,
    requireDeviceApproval: config.requireDeviceApproval,
    shareMaxDays: config.shareMaxDays,
    backupEnabled: config.backupEnabled,
    backupRetention: config.backupRetention,
    logRetentionDays: config.logRetentionDays,
    mdnsEnabled: config.mdnsEnabled
  }
}
