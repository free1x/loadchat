export interface AppConfig {
  port: number
  serverName: string
  storagePath: string
  passwordHash: string
  passwordSalt: string
  adminPasswordHash: string
  adminPasswordSalt: string
  tokenSecret: string
  allowedCidrs: string[]
  retentionDays: number
  maxFileSize: number
  maxStorageSize: number
  minFreeSpace: number
  maxConcurrentUploads: number
  maxDailyUploadBytes: number
  requireDeviceApproval: boolean
  shareMaxDays: number
  backupEnabled: boolean
  backupRetention: number
  logRetentionDays: number
  mdnsEnabled: boolean
}

export interface SessionPayload {
  exp: number
  scope: 'access' | 'admin' | 'share' | 'device' | 'backup'
  fileId?: string
  deviceId?: string
  shareId?: string
  backupName?: string
}
